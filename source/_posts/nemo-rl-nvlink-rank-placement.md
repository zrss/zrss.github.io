---
title: NeMo-RL 中 NVLink Domain 与 Rank Placement
abbrlink: 2f0a8c7d
date: 2026-06-10 00:12:00
tags:
  - LLM
  - Infra
  - RL
  - Ray
  - GPU
categories: 笔记
---

这篇是一次代码阅读笔记，起点是一个很具体的问题：

> NeMo-RL 怎么将 rank placement 对齐 NVLink domain？

一开始容易把几件事混在一起：

1. Kubernetes/KAI 把 pod 放到同一个 GPU clique / ComputeDomain。
2. Ray worker 启动时注册 `nvlink_domain_<UUID>` 和 `topo_rank` 这类 custom resource。
3. NeMo-RL 的 `RayVirtualCluster` 创建 placement group，并把 Ray bundle 映射成 PyTorch/Megatron rank。
4. Megatron/DeepEP 的 HybridEP 还会读 `NUM_OF_HYBRID_EP_RANKS_PER_NVLINK_DOMAIN`、`USE_MNNVL` 这类环境变量。

它们都和“拓扑”有关，但不是同一层的东西。尤其是：当前 `main` 分支和一些特性分支的行为并不一样。

## 结论

当前 `main` 分支里：

- infra YAML 会在 Ray worker 启动时注册 `nvlink_domain_<UUID>` 和 `topo_rank`。
- 但是 NeMo-RL Python 侧的 rank placement 没有消费 `nvlink_domain_*`。
- unified placement group 场景下，`RayVirtualCluster` 只按 `(node_id, gpu_id)` 对 bundle 做稳定排序。
- 真正保证 worker 落在同一个 NVLink/RoCE 拓扑域里的，是 KAI topology annotation、ComputeDomain/DRA、以及 `segmentSize` 这类 K8s/infra 层约束。

特性分支里则不一样。至少这些 fetched refs 里已经有 topology-aware placement 逻辑：

```text
origin/dsv3-from-v0.6.0
origin/topology-base-v2
origin/ultra-v3
origin/youngeunk/topology-aware-placement
origin/youngeunk/topology-aware-placement-dco-fix
origin/youngeunk/numa-aware-binding
origin/pull-request/2612
origin/pull-request/2613
```

这些分支的 `nemo_rl/distributed/virtual_cluster.py` 里，确实会读取 Ray node resource 中的 `nvlink_domain_*` / `topo_rank`，并把它们用于 bundle 排序；部分逻辑还支持通过 `node_resource_constraints` 把 placement group bundle pin 到某个 NVLink domain。

所以更准确的说法是：

> main 分支已经有 infra probe，但 Python 消费侧还没合进来；特性分支里已经有完整一些的 topology-aware rank placement。

## 资源调度 Infra

### K8s/KAI/DRA：容器资源 clique

GB300 相关 infra YAML 里，worker pod 有这几个关键配置：

```yaml
metadata:
  annotations:
    kai.scheduler/topology: gb300-topology
    kai.scheduler/topology-required-placement: nvidia.com/gpu.clique
spec:
  schedulerName: kai-scheduler
  resourceClaims:
    - name: compute-domain-channel
      resourceClaimTemplateName: compute-domain-ultra-pipeclean
    - name: roce-channel
      resourceClaimTemplateName: roce-ultra-pipeclean
```

这部分不是 rank ordering，而是 **pod placement 的硬约束**。它让 KAI scheduler 以 `nvidia.com/gpu.clique` 为 topology placement key，把一组 worker gang-schedule 到合适的 GPU clique / ComputeDomain 里。没有这层，pod 可能被放到不同 rack，后面再怎么排 rank，也救不回跨 rack 通信。

`segmentSize` 也在这一层发挥作用。例如某个 worker group 有 64 个 replicas，`segmentSize: 16` 会把它展开成 4 个 16-worker segment：

```python
for i in range(num_segments):
    segment = copy.deepcopy(wg)
    segment["groupName"] = f"{base_name}-segment-{i}"
    segment["replicas"] = segment_size
    segment["minReplicas"] = segment_size
    segment["maxReplicas"] = segment_size
```

这样 KAI 更容易把每个 segment 放进一个完整 clique。它解决的是“调度单位太大，无法表达 domain/rack 约束”的问题。

### Ray worker startup：注册 topology resource

GB300 infra 的 worker command 会在 `ray start` 前跑一段 topology probe：

```bash
CLUSTER_UUID=$(nvidia-smi -q 2>/dev/null \
  | grep 'ClusterUUID' \
  | head -1 \
  | awk -F: '{print $2}' \
  | tr -d ' ')

TOPO_RANK=$(hostname -i | tr -d '.')

RAY_RESOURCES='{'
if [[ -n "$CLUSTER_UUID" ]]; then
  RAY_RESOURCES+="\"nvlink_domain_${CLUSTER_UUID}\": 1"
  [[ -n "$TOPO_RANK" ]] && RAY_RESOURCES+=", "
fi
if [[ -n "$TOPO_RANK" ]]; then
  RAY_RESOURCES+="\"topo_rank\": $TOPO_RANK"
fi
RAY_RESOURCES+='}'

eval "$KUBERAY_GEN_RAY_START_CMD --resources='$RAY_RESOURCES'"
```

它把 NVLink fabric 的 `ClusterUUID` 变成 Ray custom resource：

```text
nvlink_domain_<ClusterUUID>: 1
topo_rank: <some number>
```

注意这里的资源注册本身并不等于“rank placement 已经对齐”。Ray custom resource 只有在后续 placement group bundle 或 actor/task `.options(resources=...)` 里被请求时，才会形成调度约束；或者被 Python 侧读取后参与排序时，才会影响 rank order。

这也是 main 分支和特性分支的分叉点。

## Rank placement：main 与特性分支

### main 分支：只按 node/GPU 稳定排序

当前 `main` 的 `RayVirtualCluster._get_sorted_bundle_indices()` 逻辑大致是：

1. 用 `placement_group_table(pg)` 拿到每个 bundle 落在哪个 Ray node：

```python
bundle_to_node_ids = pg_data["bundles_to_node_id"]
```

2. 对每个 bundle 启一个很小的 actor，强制 schedule 到那个 bundle 上，读它看到的 GPU id：

```python
GetGPUIDActor.options(
    num_cpus=0.01,
    num_gpus=0.01,
    scheduling_strategy=PlacementGroupSchedulingStrategy(
        placement_group=pg,
        placement_group_bundle_index=i,
    ),
).remote()
```

3. 得到：

```text
bundle i -> node_id, gpu_id
```

4. 按 `(node_id, gpu_id)` 排序：

```python
bundle_infos = [
    (i, bundle_to_node_ids[i], gpu_ids[i])
    for i in range(num_bundles)
]

pg_reordered_bundle_indices = [
    bundle_info[0]
    for bundle_info in sorted(bundle_infos, key=lambda x: (x[1], x[2]))
]
```

为什么要做这个？因为 Ray placement group 里的 bundle index 不一定天然就是：

```text
node0 GPU0
node0 GPU1
node0 GPU2
node0 GPU3
node1 GPU0
node1 GPU1
...
```

它可能是乱序的，比如：

```text
bundle 0 -> nodeB GPU1
bundle 1 -> nodeA GPU2
bundle 2 -> nodeB GPU0
bundle 3 -> nodeA GPU0
bundle 4 -> nodeA GPU1
bundle 5 -> nodeB GPU2
bundle 6 -> nodeA GPU3
bundle 7 -> nodeB GPU3
```

如果直接按 bundle index 创建 rank，就会变成：

```text
rank0: nodeB GPU1
rank1: nodeA GPU2
rank2: nodeB GPU0
rank3: nodeA GPU0
...
```

这对 TP/PP/DP/EP locality 都不友好。

排序后得到：

```text
bundle 3 -> nodeA GPU0
bundle 4 -> nodeA GPU1
bundle 1 -> nodeA GPU2
bundle 6 -> nodeA GPU3
bundle 2 -> nodeB GPU0
bundle 0 -> nodeB GPU1
bundle 5 -> nodeB GPU2
bundle 7 -> nodeB GPU3
```

即：

```text
_sorted_bundle_indices = [3, 4, 1, 6, 2, 0, 5, 7]
```

policy 侧再用这个排序后的 bundle list 创建 worker：

```python
group_size = cluster.num_gpus_per_node
tied_groups = [
    (i // group_size, [bundle_idx])
    for i, bundle_idx in enumerate(cluster._sorted_bundle_indices)
]
```

如果 `group_size = 4`，就得到：

```text
logical node 0: bundle 3,4,1,6  # actual nodeA GPU0..3
logical node 1: bundle 2,0,5,7  # actual nodeB GPU0..3
```

最后 `RayWorkerGroup` 按这个 `bundle_indices_list` 创建 worker，并设置：

```python
RANK       = global_rank
LOCAL_RANK = bundle_idx
WORLD_SIZE = self.world_size
NODE_RANK  = pg_idx
```

所以 main 分支里的第 4 步，本质是：

> 在已经由 K8s/KAI 放好的资源上，把 Ray bundle 顺序整理成稳定的 node-major、gpu-major rank 顺序。

它没有读 `nvlink_domain_*`。

### 特性分支：真正消费 `nvlink_domain_*`

特性分支上的实现更接近最初想象中的“对齐 NVLink domain”。

以 `origin/dsv3-from-v0.6.0` 为例，`virtual_cluster.py` 里多了这些常量：

```python
NVLINK_DOMAIN_PREFIX = "nvlink_domain_"
TOPO_RANK_KEY = "topo_rank"
NVLINK_DOMAIN_UNKNOWN = "unknown"
TOPO_RANK_UNKNOWN = -1
```

还多了一个 `_get_gpu_id_info()`：

```python
@ray.remote(num_gpus=1)
def _get_gpu_id_info() -> tuple[int, str, int]:
    gpu_id = ray.get_gpu_ids()[0]
    nvlink_domain = NVLINK_DOMAIN_UNKNOWN
    topo_rank = TOPO_RANK_UNKNOWN

    runtime_ctx = ray.get_runtime_context()
    node_id = runtime_ctx.get_node_id()
    for node in ray.nodes():
        if node.get("NodeID") == node_id:
            all_node_resources = node.get("Resources", {})
            break

    for key, val in all_node_resources.items():
        if key.startswith(NVLINK_DOMAIN_PREFIX):
            nvlink_domain = key
        if key == TOPO_RANK_KEY:
            topo_rank = int(val)

    return gpu_id, nvlink_domain, topo_rank
```

于是每个 bundle 的信息从 main 分支的：

```text
(bundle_idx, node_id, gpu_id)
```

升级成：

```text
(bundle_idx, node_id, gpu_id, nvlink_domain, topo_rank)
```

排序也从：

```text
(node_id, gpu_id)
```

变成：

```text
(domain_min_topo_rank, topo_rank, gpu_id)
```

对应代码里的描述是：

```python
if topology_info_available:
    sort_key = (domain_min_topo_rank, topo_rank, gpu_id)
else:
    sort_key = (node_id, gpu_id)
```

这就真的把 `nvlink_domain_*` 纳入 rank ordering 了。

#### 可选能力：domain pinning

更进一步，特性分支的 `RayVirtualCluster.__init__()` 多了：

```python
segment_size: int | None = None
node_resource_constraints: list[dict[str, float]] | None = None
```

`node_resource_constraints` 的注释很直白：

```python
node_resource_constraints = [
    {"nvlink_domain_<uuid>": 0.001},
] * 16
```

这表示给 16 个 logical nodes 都追加同一个 Ray custom resource requirement，从而把它们 pin 到同一个物理 NVLink domain。

创建 placement group bundle 时：

```python
def _make_bundle(node_idx: int) -> dict:
    bundle = {"CPU": num_cpus_per_bundle, "GPU": num_gpus_per_bundle}
    if self.node_resource_constraints and self.node_resource_constraints[node_idx]:
        bundle.update(self.node_resource_constraints[node_idx])
    return bundle
```

这时 `nvlink_domain_*` 不只是“排序信息”，而是可以进入 Ray placement group 的 resource request，变成调度约束：

```python
{"CPU": 1, "GPU": 1, "nvlink_domain_<uuid>": 0.001}
```

这和 main 分支有本质区别。main 只注册了资源，但 placement group bundle 没请求它；特性分支可以请求它。

#### vLLM：按 topology-sorted bundles 切 TP/PP group

特性分支的 `vllm_generation.py` 也相应改了。

当 vLLM 需要跨节点 model parallelism 时，它会用 unified placement group。之后 `_get_tied_worker_bundle_indices()` 会调用内部的 `allocate_worker_groups()`，传入：

```python
sorted_bundle_indices=cluster._sorted_bundle_indices
nvlink_domain_per_bundle_index=cluster._nvlink_domain_per_bundle_index
```

如果有 topology-sorted bundle list，就直接按这个 list 切连续片段：

```python
flat = list(sorted_bundle_indices)
slice_ = flat[i * model_parallel_size : (i + 1) * model_parallel_size]
```

每个 slice 是一个 model-parallel group，也就是一个 DP replica 里的 TP/PP workers。

如果一个 slice 里出现多个 NVLink domain，代码会 warning：

```text
Model-parallel group ... spans ... NVLink domains;
cross-domain collectives may use slower links.
Prefer TP*PP that divides usable GPUs per domain.
```

这点很重要：排序能让连续 rank 尽量落在同一个 domain，但如果 `TP * PP` 和每个 domain 的可用 GPU 数不整除，还是可能切出跨 domain 的 group。拓扑感知不是魔法，parallelism 配置还得和物理 domain 尺寸匹配。

## Megatron/DeepEP：HybridEP 是另一层

NeMo-RL 的 Megatron setup 里还有：

```python
NUM_OF_HYBRID_EP_RANKS_PER_NVLINK_DOMAIN
USE_MNNVL
```

这部分是给 DeepEP/Megatron HybridEP 用的。

如果 config 里有：

```yaml
megatron_cfg:
  moe_flex_dispatcher_backend: hybridep
  hybridep_num_ranks_per_nvlink_domain: 72
  hybridep_use_mnnvl: true
```

setup 会写：

```python
os.environ["NUM_OF_HYBRID_EP_RANKS_PER_NVLINK_DOMAIN"] = "72"
os.environ["USE_MNNVL"] = "1"
```

如果不显式设置，默认大致是：

```python
NUM_OF_HYBRID_EP_RANKS_PER_NVLINK_DOMAIN = min(expert_model_parallel_size, 64)
USE_MNNVL = int(expert_model_parallel_size > 4)
```

这和 Ray custom resource `nvlink_domain_*` 不是一回事：

- `nvlink_domain_*`：Ray / placement 层看到的节点拓扑资源。
- `NUM_OF_HYBRID_EP_RANKS_PER_NVLINK_DOMAIN`：Megatron/DeepEP 运行时理解 HybridEP domain 大小的参数。

前者决定 rank 怎么被放；后者告诉通信/dispatcher 这些 rank 应该按多大的 NVLink domain 处理。理想情况下，二者要一致，否则上层以为的 domain 和实际 placement 可能对不上。

## 可视化

完整可视化放在独立页面里，避免大段 HTML 干扰正文渲染：

[打开 NeMo-RL NVLink domain placement 可视化](/nemo-rl-nvlink-placement-visual.html)

## 小结

这次阅读最大的收获，是不要把“拓扑感知”当成一个单点功能。它横跨好几层，每层能保证的东西不一样：

- K8s/KAI/DRA 负责 **资源真的落在正确的物理 domain**。
- Ray custom resource 负责 **把物理 domain 暴露给 Ray 调度/运行时**。
- Ray placement group 负责 **把 bundle 绑定到资源约束上**。
- NeMo-RL `RayVirtualCluster` 负责 **把 bundle 顺序转成 rank 顺序**。
- Megatron/DeepEP 负责 **按这些 rank 做 TP/PP/EP/MoE 通信**。

当前 `main` 只完成了其中一部分：infra 注册了 `nvlink_domain_*`，但 Python rank placement 没消费它。特性分支补上了后半截：读 `nvlink_domain_*` / `topo_rank`，按 topology 排 bundle，必要时通过 `node_resource_constraints` 把 placement group bundle pin 到 domain。

所以如果问：

> NeMo-RL 现在是不是用 `nvlink_domain_*` 对齐 rank placement？

答案要分支限定：

- `main`：没有。main 主要靠 K8s/KAI 保证 placement，NeMo-RL 只做 `(node_id, gpu_id)` 稳定排序。
- topology-aware 特性分支：有。它已经把 `nvlink_domain_*` 纳入排序和可选调度约束。

这个差异也解释了为什么 main 的 infra 注释里已经写着“Registers `nvlink_domain_<UUID>` and `topo_rank` so `virtual_cluster.py` can do segment-aware rank assignment”，但实际 main 代码里搜不到消费路径：看起来 Python 侧实现还停在特性分支/PR 上，没有合入主线。

