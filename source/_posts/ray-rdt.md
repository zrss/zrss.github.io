---
title: Ray Direct Transport (RDT)
tags: ray
categories: 笔记
abbrlink: 82259066
date: 2026-05-23 20:00:00
---

Ray 默认把 object 放进 **Plasma object store**——每个节点上一个基于 **共享内存** 的本地 store 进程，worker 通过它读写 object。`ray.put()`、task / actor 返回值等先落本机 Plasma；跨节点时再由 Ray 的 ownership / scheduling 层协调 fetch，但 **各节点本地内存层仍是 Plasma**。内存不够时会 **spill** 到磁盘（默认在 session 临时目录下），需要时再 restore 回 Plasma；`ray memory` 里的 `Plasma memory usage` 就是这一层。

task / actor 消费 object 时要反序列化。对 CUDA `torch.Tensor` 来说，默认路径意味着 **GPU → CPU（进 Plasma）→ GPU** 的来回拷贝，在 actor 间频繁传 tensor 时开销很大。

{% mermaid graph LR %}
subgraph N1["节点 1"]
  A1["Producer Actor<br/>GPU tensor"]
  B1["Plasma Store"]
end
subgraph N2["节点 2"]
  A2["Consumer Actor"]
  B2["Plasma Store"]
end
A1 -->|"GPU to CPU, 入 Plasma"| B1
B1 -->|"跨节点 fetch"| B2
B2 -->|"拷贝到 GPU"| A2
A1 -->|"RDT 使用 Gloo/NCCL/NIXL<br/>在 actor 间 send/recv"| A2
style B1 fill:#eee,stroke:#ccc,color:#999
style B2 fill:#eee,stroke:#ccc,color:#999
style A1 fill:#ddeeff,stroke:#338
style A2 fill:#ddeeff,stroke:#338
{% endmermaid %}

> 上：传统 Plasma 路径需多次 CPU/GPU/内存拷贝；下：RDT 经 Gloo/NCCL/NIXL 在 actor 间 send/recv，绕开 Plasma。

[Ray Direct Transport (RDT)](https://docs.ray.io/en/latest/ray-core/direct-transport.html) 是在 `ObjectRef` 语义上做的增强：tensor 留在 producer actor 侧（GPU 上），consumer 需要时由 Ray 协调两端做 **send/recv**，绕开 Plasma object store 的序列化与拷贝。底层可选 **Gloo / NCCL / NIXL**——Gloo、NCCL 是 collective 库，需先建 collective group，再在 group 内走 p2p 传输；NIXL 则是基于 UCX 的 p2p RDMA，无需预建 group，且 `ray.get` 可走 one-sided 取回。

> RDT 目前仍是 **alpha**，API 和限制都可能变；下文基于 Ray 2.55 文档整理。

# 基本用法

在返回 `torch.Tensor` 的 actor method 上加 `@ray.method(tensor_transport=...)`：

```python
import torch
import ray
from ray.experimental.collective import create_collective_group

@ray.remote
class MyActor:
    @ray.method(tensor_transport="gloo")
    def random_tensor(self):
        return torch.randn(1000, 1000)

    def sum(self, tensor: torch.Tensor):
        return torch.sum(tensor)

sender, receiver = MyActor.remote(), MyActor.remote()
group = create_collective_group([sender, receiver], backend="torch_gloo")

tensor = sender.random_tensor.remote()
result = receiver.sum.remote(tensor)
print(ray.get(result))
```

- **decorator 只加在产出 tensor 的方法上**，消费方不用加（除非它也要返回 RDT tensor）。
- tensor 存在 **producer actor** 里，不是 Plasma object store。
- 传给另一个 actor 时，Ray 自动用指定 transport 做 send/recv。
- 返回值若未标注 RDT，仍走默认 Plasma object store（上例 `sum` 的标量结果）。

嵌套结构、多 tensor 返回值也支持，Ray 会递归识别其中的 `torch.Tensor`。

# 三种 transport

| transport | 场景 | collective group | 备注 |
|-----------|------|------------------|------|
| `gloo` | CPU tensor | 需要，`backend="torch_gloo"` | 无 GPU 也能跑通 demo |
| `nccl` | NVIDIA GPU | 需要，`backend="nccl"` | actor 需 `num_gpus=1`，tensor 在 `.cuda()` |
| `nixl` | CPU / GPU | **不需要** | 基于 UCX 的 p2p RDMA；`ray.get` / `ray.put` 也可走 NIXL |

Gloo / NCCL 是 **collective** 语义，使用前必须 `create_collective_group`，且 `backend` 与 `tensor_transport` 一致。NIXL 更灵活，actor 环境装好 `nixl` 即可，适合跨节点 p2p。

NCCL 版几乎就是 Gloo 版三处替换：`tensor_transport="nccl"`、`backend="nccl"`、tensor 放 GPU。

NIXL 额外支持 driver 侧 `ray.put(t, _tensor_transport="nixl")`，以及 consumer 内 `ray.get(ref)` 直接经 NIXL 取回。

> collective transport 的 `ray.get` 若 caller 不在 group 里会报错，需配置 `_use_object_store=True` 回退。

# 与 Plasma object store 的语义差异

**RDT object 是可变的。** Ray 只持有 tensor 引用，不做 immutable copy。producer 若仍持有同一块 tensor 并在 in-place 修改，后续 consumer 可能看到被改过的数据。这与 Ray Core 默认「actor 返回即拷贝」的行为不同。

传回 **同一个 producer actor** 时零拷贝，只是引用；若同时再传给别的 actor，in-place 修改会影响 Ray 内部持有的那份，Ray 会打印 warning。

需要 producer 再次写同一块 tensor 时，用 `ray.experimental.wait_tensor_freed(tensor)` 等 Ray 释放所有引用；注意此时 driver 不要再 `ray.get` 持有该 ref，否则会死锁。

# 限制

> 当前 alpha 状态

- 仅 **`torch.Tensor`**，仅 **Ray actor**（不含普通 task）。
- 不支持 asyncio（[tracking issue](https://github.com/ray-project/ray/issues/56398)）。
- Gloo / NCCL：
  - 只有 **创建 collective group 的进程** 能提交返回 / 传递 RDT object 的 actor task。
  - RDT `ObjectRef` 不能序列化后跨进程传递，只能作为 **同 group 内 actor task 的直接参数**。
  - 每个 actor 在同一 transport 下同时只能属于一个 group。
  - 不支持 `ray.put`。
- NIXL：同一 actor 上若先后存两个 object、tensor 集合有重叠但不完全相同，当前有已知问题；需等第一个 `ObjectRef` 出 scope 后再存第二个。

系统级传输错误：Gloo/NCCL collective 失败会 **销毁 group 并 kill actor**；NIXL 会 abort 并在依赖 task / `ray.get` 处抛异常。超时可调 `RAY_rdt_fetch_fail_timeout_milliseconds`。

# 与 RL 训推 infra 的关系

RL 里 actor 间传 rollout buffer、logits、hidden states 若走默认 Plasma object store，GPU 数据会被反复拉到 CPU。RDT 把这条路径收成 **actor 间 direct transport**，和 NCCL collective、NIXL RDMA 对齐，适合 **多 actor 流水线**（例如 rollout actor → trainer actor）且 tensor 较大的场景。但 alpha 阶段的 collective group 创建进程限制、可变语义、以及仅 actor 支持，使用前要先对照 workload 评估是否适用。

# 参考

- [Ray Object Spilling（Plasma 内存层与 spill）](https://docs.ray.io/en/latest/ray-core/objects/object-spilling.html)
- [Ray Direct Transport 官方文档](https://docs.ray.io/en/latest/ray-core/direct-transport.html)
- [NIXL](https://github.com/ai-dynamo/nixl)
