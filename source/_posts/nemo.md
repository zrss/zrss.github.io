---
title: Nemotron 3 Ultra 技术报告：RL Infra 阅读
abbrlink: b9ff3fc4
date: 2026-06-07 23:58:20
tags:
  - LLM
  - Infra
  - RL
  - Nemotron
---

Nemotron 3 Ultra 的技术报告标题是 [Nemotron 3 Ultra: Open, Efficient Mixture-of-Experts Hybrid Mamba-Transformer Model for Agentic Reasoning](https://research.nvidia.com/labs/nemotron/files/NVIDIA-Nemotron-3-Ultra-Technical-Report.pdf)。

## 报告概览

报告围绕四大板块展开：

1. 预训练（Pretraining）
架构细节（层数、MoE 配置、Mamba 头参数等）、NVFP4 低精度训练配方、数据混合策略（两阶段课程：Phase 1 偏多样性、Phase 2 偏质量）、长上下文扩展（用 32-way context parallelism 在 GB200 上扩展到 1M），以及两次训练发散事件的诊断（原因、回滚方案）。
2. 后训练（Post-training）
SFT → RLVR → MOPD（多教师蒸馏）的三阶段流水线。训练了超过 10 个专项教师模型，涵盖软件工程、终端使用、搜索、Office 办公任务、安全、数学推理、竞赛编程等领域。还包括 MTP Boosting（推测解码头的专项优化）和推理预算控制。
3. 量化（Quantization）
NVFP4 量化方案及其对精度的影响分析。
4. 推理（Inference）
吞吐量对比、MTP 加速推理的效果数据。

## RL Infra 总览

报告的 Infra 内容集中在 **RL/MOPD 训练阶段的工程挑战**，背景是 GB200 NVL72 集群 + Slurm + Ray + vLLM + NeMo-RL 的异构分布式训练栈。以下按问题分类整理：

这部分最有价值的地方，是它没有只给一个大而化之的“我们用了很多 GPU”描述，而是把 post-training 期间真实会拖慢训练、放大失败、拖垮共享服务的问题列出来，并给出前后对比。对 RL infra 来说，核心目标不只是单个 GPU 的 token/s，而是让 policy update、rollout generation、环境执行、judge / reward、checkpoint 和重启恢复共同组成一个稳定闭环。

报告里 RL/MOPD 采用的是 **one-step off-policy asynchronous RL**：rollout generation 和 policy update 会 overlap，整体 step time 取决于更慢的一侧。NVIDIA 观察到瓶颈通常在 rollout generation，而 rollout 又被少量长尾 generation 拖慢。所以后面的 MTP、vLLM、多节点启动、JIT cache、I/O cache，本质上都是为了减少 RL step 的尾延迟和重启成本。

从失败归因看，报告把 RL 软件失败分成三类：

| 失败类别 | 占比 |
|----------|------|
| Generation engine failures / timeouts | 56% |
| Sandbox / tool calling | 36% |
| Other software issues | 8% |

这说明大规模 agentic RL 的主要风险已经不只是 trainer 本身，而是 **生成引擎 + 环境 / 工具执行系统**。二者合计约 92% 的失败，意味着 infra 要把 vLLM、Ray actor、sandbox、tool calling、health check、timeout 和 cleanup 都纳入训练系统，而不是把它们当作外部黑盒。

## 关键优化

### MTP 加速 Rollout 生成

RL/MOPD 训练中，rollout 生成是瓶颈，而生成时间又被极少数"straggler"长请求主导。方案是用 MTP 投机解码（MTP head 先出 k 个候选 token，base model 单次前向验证），k=5 时带来 **1.46× 加速**，收益集中在长尾慢请求上。

这里的关键点是，MTP 在 infra 里的作用不是单纯提高在线推理吞吐，而是缩短训练循环里的 rollout wall-clock。长尾请求往往会在 batch 后段以较低并发继续 decode，投机解码在这类场景里收益更明显。也就是说，它优化的是 RL step 的 tail latency，而不是平均单请求延迟。

### Slurm 启动优化

原有启动脚本对每个节点发多次独立 `srun` 来分配角色，`slurmctld` 串行处理 RPC，节点数多时复杂度 O(n)，导致启动耗时 30+ 分钟。改为单次多节点 `srun`，Slurm 控制器交互降为 O(1)，**启动时间从 30+ 分钟降到 10 分钟**。

这个问题很典型：小规模下“每个节点单独发命令”很直观，但到几百、上千节点后，控制面会先于数据面变成瓶颈。这里的优化不是更快的 GPU kernel，而是减少对 Slurm controller 的 RPC 压力，让 job launch 从节点数线性增长回到常数级控制面交互。

### Ray GCS 扩展性

3000+ GPU 规模下，RL job 同时创建大量 Ray actor（policy、generation、env、judge 四类 worker），Ray 单线程 GCS 被 actor 注册请求淹没，启动耗时 25–49 分钟，且出现雷群式启动失败。解法：
- 把短生命周期 actor 改为 task，减少 40% actor 注册量
- 每节点合并初始化 actor
- 升级到 Ray 2.55（Anyscale 在此版本中修了 GCS 扩展性回归）

这里反映出 Ray 在 RL infra 里的角色更像一个异构 job runtime，而不是只负责几个 Python worker。policy、generation、environment、judge 的生命周期和资源需求不同，如果全部抽象成大量 actor，会把 GCS 注册路径打爆。短生命周期逻辑改为 task，本质是降低控制面对象数量；每节点合并初始化 actor，则是减少 thundering herd。

这也说明 RL infra 的调度单位要谨慎设计：不是所有并发实体都适合作为独立 actor，尤其是在数千 GPU、数千到数万进程同时启动的场景下，控制面元数据本身就是稀缺资源。

### NVLink 拓扑感知调度

GB200 NVL72 的 NVLink 域覆盖单个 rack（18 节点 × 4 GPU = 72 GPU）。若 Megatron 的 Expert Parallelism (EP) 组跨 rack，MoE all-to-all 通信就会走 InfiniBand 而非 NVLink。原因是 Ray node ID 是随机 UUID，无拓扑信息，Megatron 按收到的 rank 排序分组，无法感知物理位置。

解法三步走：
1. 容器启动时，用 `nvidia-smi -q` 读取 NVLink fabric ClusterUUID，注册为 Ray 自定义资源，给调度器提供 rack 归属信息
2. NeMo RL 的 RayVirtualCluster 按 `(domain_min_topo_rank, topo_rank, gpu_id)` 组合键排序 bundle，确保 EP 组内所有 GPU 在同一 NVLink 域；用 `SLURM_TOPOLOGY_ADDR` 修正 Slurm block 乱序
3. Megatron 启用 `external_gpu_device_mapping=True`，信任 Ray 的 GPU 绑定

效果：**端到端吞吐提升 20%**。

这部分是整篇 infra 里最值得关注的优化。GB200 NVL72 的 rack 内 72 GPU 通过 NVLink 域连接，MoE 的 EP all-to-all 如果落在同一个 NVLink 域内，通信路径和跨 rack InfiniBand 完全不是一个量级。问题在于 Ray 和 Megatron 默认看到的是逻辑 rank，而不是物理 rack / NVLink domain。

因此这里其实做了一个跨层契约：

| 层次 | 原问题 | 修正方式 |
|------|--------|----------|
| 硬件层 | NVLink domain 信息只存在于节点本地 | 用 `nvidia-smi -q` 读 ClusterUUID |
| 调度层 | Ray node ID 是随机 UUID | 注册 Ray custom resource 表达 rack 归属 |
| 编排层 | Slurm block 顺序可能乱 | 用 `SLURM_TOPOLOGY_ADDR` / hostname 做 deterministic sort |
| 训练层 | Megatron 按 rank 建 EP 组 | 让 RayVirtualCluster 排好 bundle，Megatron 信任外部 GPU mapping |

这个思路比“给训练框架加一个 topology 参数”更完整：它把硬件拓扑、Slurm 拓扑、Ray placement group、Megatron rank assignment 串成了一条链。链上任意一层丢失物理信息，EP 组就可能静默跨 rack，吞吐下降但不一定立刻报错。

### NUMA 绑定

GB200 NVL72 每个计算托盘有一块 Grace CPU，含两个 socket 和多个 NUMA 节点：GPU 0/1 对应 NUMA node 0，GPU 2/3 对应 NUMA node 1。NVLink-C2C 是 socket-local 的，若 Ray worker 进程跑到远端 socket，CPU↔GPU 的内存带宽会因跨 socket coherence link 而下降。

解法：显式把 policy worker 和 vLLM worker 绑定到与其分配 GPU 物理相邻的 CPU socket。优化器 state offload、tokenization、数据预处理、pinned-memory 申请全部命中本地 DRAM 和 C2C 路径。效果：**端到端吞吐提升 10%**。

这说明在 Grace-Blackwell 这类 CPU/GPU 紧耦合平台上，CPU placement 已经会影响端到端训练吞吐。对 RL 来说，CPU 不是闲置资源：tokenization、环境执行、judge、数据预处理、checkpoint D2H staging、vLLM worker 管理都会用 CPU。如果进程被 Linux 调度到远端 socket，就会把原本应该走本地 C2C 的路径变成跨 socket 访问。

### Checkpoint 异步保存

同步 checkpoint 阻塞训练约 60 秒/次。优化链路：
- 启用 NVRx（NVIDIA Resiliency Extension）异步 checkpoint：参数先 copy 到 CPU，后台持久化，阻塞降到 6–8 秒
- NCCL D2H 传输与 CPU 拷贝 overlap，缩短同步窗口
- 持久化 checkpoint worker 进程，避免每次 fork/spawn 开销
- checkpoint finalization（跨 worker 同步 + 最终 commit）移入后台线程，完全不阻塞训练
- 缓存 distributed save plan，不再每次重新计算

最终效果：**exposed save time 降到 <1 秒**。

这个 checkpoint 优化有两层含义。第一层是减少训练停顿：把参数拷到 CPU 后后台落盘，让 GPU 训练尽快继续。第二层是把 checkpoint 的分布式协议开销从 hot path 移出去：finalization、save plan 计算、worker 进程创建都不能每次阻塞训练主循环。

Megatron Core Distributed Optimizer 也很关键，因为 optimizer state 已经按 data-parallel rank 分片，每个 rank 只保存本地 shard。对超大模型 post-training 来说，checkpoint 不只是容灾机制，也是影响 goodput 的常规周期性开销。

### JIT 编译缓存

1000+ GPU 冷启动时，初始化耗时 ~49 分钟，其中 JIT 编译占 38.8 分钟，明细如下：

| 组件 | 冷启动 |
|------|--------|
| FlashInfer cubin 编译 | 28.0 min |
| Inductor / torch.compile | 5.5 min |
| Triton kernel autotuning | 2.0 min |
| vLLM CUDA graph capture | 2.5 min |
| 模型加载 | 0.4 min |

解法三步：
1. **共享存储持久化缓存**：job 结束时把所有 JIT artifacts 压缩打包写回共享目录
2. **节点本地 seeding**：Ray 初始化前，每个节点把压缩包解压到本地 `/tmp`，后续 JIT 写也打到 `/tmp`，避免并发元数据风暴
3. **FlashInfer cubin 预编译进容器镜像**：build 时用 `flashinfer download-cubin` bake into image，消除运行时编译

效果：**初始化时间从 38.8 分钟降到 0.4 分钟，降低 99%**。

JIT cache 这一节可以理解为“把运行时不确定性前移或局部化”。FlashInfer cubin、Inductor graph、Triton autotuning、vLLM CUDA graph capture 都会生成本地 artifact；如果每个 worker 冷启动都重新编译，集群规模越大，重复工作越多，启动时间也越不可预测。

这里的三个手段分别解决不同问题：

| 手段 | 解决的问题 |
|------|------------|
| 共享存储保存 warm cache | job 之间复用编译结果 |
| 启动前解压到节点本地 `/tmp` | 避免所有 worker 同时打共享文件系统 metadata |
| FlashInfer cubin bake into image | 消除最大头的运行时编译 |

值得注意的是，缓存不是简单放共享盘就结束了。千卡规模下，共享盘上的大量小文件读写会变成 metadata storm，所以训练时写本地、启动时顺序解压 tarball、结束时单点归档，才是完整方案。

### 多节点 vLLM 稳定性

多节点 vLLM 在 GB200 上遇到三类问题及对应修复：

| 问题 | 修复 |
|------|------|
| 各组件安装了不同版本 GPU kernel 库，ABI 不兼容，冷静默崩溃 | 统一全栈 GPU kernel 库版本 |
| 主 Ray actor 的环境变量未传播到 `multiprocessing.spawn` 子进程，子进程加载不同库版本 | 显式在 spawn 时 forward 所有库路径和环境变量 |
| 部分 JIT 编译 kernel 与 NCCL 多节点 NVLink 内存注册不兼容，导致分布式初始化 hang | 在 FlashInfer 上游修复可用前，禁用受影响 kernel 路径的多节点 NVLink 内存注册 |

此外还加了 vLLM health check、RPC timeout、graceful shutdown 和孤儿进程清理，提升整体稳定性。

这部分的工程信号很强：vLLM 在 RL 训练里不是一个独立 serving 服务，而是 Ray 分布式执行图里的 generation backend。主 Ray actor 还会通过 `multiprocessing.spawn` 拉起 EngineCore 子进程，子进程再连 GCS。这样一来，版本、环境变量、NCCL 初始化、CUDA graph、FlashInfer kernel 都必须在父进程、子进程、多节点之间保持一致。

所以它的稳定性问题往往不是“vLLM 算错了”，而是：

- 多组件安装的 GPU kernel 库版本不一致，导致 ABI 静默不兼容；
- 父进程的 `LD_LIBRARY_PATH`、CUDA/NCCL/FlashInfer 相关环境变量没有传到 spawn 子进程；
- 某些 JIT kernel 和 NCCL 多节点 NVLink memory registration 组合会 hang；
- 分布式 worker 没有 timeout / health check，单点卡死会拖住整个 RL job。

这些问题都很像生产 serving，但影响的是训练 goodput。RL 训练里的 generation backend 如果没有 fail-fast 和 cleanup，失败会从一个子进程扩散到整轮 rollout，最后变成整 job 重启。

### 容器镜像 I/O 风暴

44GB squashfs 容器镜像在千卡规模下被所有节点并发读取，共享存储被打爆，部分节点报 I/O error 或卡 12+ 分钟（正常应 2–3 分钟），一个慢节点就能拖延整个 job 的 Ray 初始化。job 结束时所有节点并发回写 JIT 缓存，制造第二次 I/O 风暴。

解法：
- **Enroot 本地 squashfs 缓存**：节点首次提取后，后续 job 直接复用本地缓存，不再读共享存储
- **写入非对称化**：训练时 JIT 全写本地，job 结束时仅由一个 sidecar 进程归档压缩包回共享存储（因所有节点编译的 kernel 完全相同，只需保存一份）

这里可以和 JIT cache 放在一起看：大规模训练的启动阶段会同时制造两类 I/O 压力，一类是所有节点读同一个 44GB squashfs 镜像，另一类是所有节点写回大量 JIT 小文件。前者是吞吐型读风暴，后者是 metadata / 小文件写风暴。

NVIDIA 的处理方式都遵循同一个原则：**共享存储只做低频、顺序、少并发的持久化；高频读写放节点本地**。容器镜像靠 Enroot 本地 cache 变成 warm start，JIT artifact 靠 sidecar 只保存一份，因为所有节点编译出的 kernel 相同，没有必要让每个节点都回写。

## 后续方向：更细粒度的容错

报告的 Future Work 指向两个主要方向：

1. **fail-fast fault isolation**：generation worker 或 sandbox 实例出问题时，尽快隔离失败，避免 retry 引发级联故障。
2. **component-level recovery**：单个 generation worker、sandbox、tool-calling 组件可以独立重启，不必重启整个 RL job。
3. **细粒度状态 checkpoint**：保存 in-flight rollout、KV cache、conversation state，让恢复从最近一致快照继续，而不是从头 replay。

这说明下一阶段 RL infra 的重点会从“让大 job 跑起来”转向“让局部失败不要扩大成全局失败”。尤其是 agentic RL 里，环境、工具、浏览器、终端、judge、模型生成都可能失败，训练系统需要像分布式在线系统一样做 fault domain 切分。

## 开销与收益

| 优化项 | 收益 |
|--------|------|
| NVLink 拓扑感知调度 | +20% 端到端吞吐 |
| NUMA 绑定 | +10% 端到端吞吐 |
| MTP 投机解码加速 rollout | 1.46× rollout 速度 |
| 异步 checkpoint | 60s → <1s 阻塞 |
| JIT 缓存 | 38.8 min → 0.4 min 冷启动 |
| Slurm 启动优化 | 30 min → 10 min |
| 多节点 vLLM 启动 | 25 min → 9.5 min |
| 容器镜像 warm cache | 2–3 min / 失败级联 → warm node 约 0s |

这份 infra 章节的工程密度相当高，尤其是 NVLink 拓扑感知调度和 JIT 缓存部分，对做大规模 RL 训练基础设施的团队很有参考价值。

## RL Infra 启发

我的理解是，Nemotron 3 Ultra 的 infra 经验可以抽象成几条原则：

1. **RL goodput 优先于单点吞吐**：rollout 长尾、checkpoint、启动、恢复、工具执行失败都会进入 wall-clock。
2. **控制面要按规模重新设计**：Slurm RPC、Ray GCS actor 注册、Ray actor spawn、vLLM 子进程连接都会在千卡规模暴露瓶颈。
3. **拓扑信息必须跨层传递**：硬件 NVLink domain、Slurm topology、Ray placement、Megatron rank assignment 必须对齐。
4. **共享存储不能承受所有节点同时读写**：镜像、JIT cache、checkpoint 都要区分本地热路径和共享持久化路径。
5. **agentic RL 的 fault domain 更复杂**：generation engine、sandbox、tool calling、judge、environment 都是训练系统的一部分，需要 health check、timeout、cleanup 和局部恢复。

这也是它和很多只讲模型结构的技术报告不同的地方：§3.6 把 RL 训练看成一个包含推理引擎、调度系统、容器系统、存储系统和任务环境的生产级分布式系统。对做训练平台的人来说，这部分比 benchmark 表格更值得反复看。

## 一个构想：在 Kubernetes 之上构建云原生分布式 RL 系统

如果把 Nemotron 3 Ultra 这套经验迁移到云原生体系里，一个自然的方向是 **在 Kubernetes 之上构建云原生分布式 RL 系统**。这里的 Kubernetes 不是 RL 系统本身，而是资源抽象、调度、隔离、生命周期管理和控制面的底座；真正的 RL 系统由 Ray / NeMo-RL / vLLM、learner、rollout generator、sandbox、tool calling、judge、checkpoint、cache 和 topology-aware runtime 共同组成。

所以这套系统不是把 Ray job 简单塞进 Pod，也不是只做一个训练 launcher，而是把 RL 训练里的 policy、rollout、inference engine、sandbox、tool calling、judge、checkpoint、cache 和 topology placement 都变成 Kubernetes 可理解、可调度、可恢复的资源。

这里有一个很关键的现实基础：NeMo-RL 本身已经开源，而且采用 Apache-2.0 License。官方 README 明确说它是 open-source post-training library，支持从小规模实验到 multi-GPU / multi-node deployment，并用 Ray 做资源管理和调度；GitHub repo 也标注了 Apache-2.0 License。也就是说，它不是只公开了 paper 或 recipe，而是把 RL post-training runtime 和相当一部分 infra 代码也放了出来。

公开仓库里能看到几类和 §3.6 对应的基础设施代码，而且不少已经不是“示例级说明”，而是直接在 NeMo-RL runtime 路径里：

| 方向 | 开源实现线索 |
|------|--------------|
| Ray 资源调度封装 | [`nemo_rl/distributed/virtual_cluster.py`](https://github.com/NVIDIA-NeMo/RL/blob/main/nemo_rl/distributed/virtual_cluster.py) 里的 `RayVirtualCluster` 负责 placement group、逻辑节点、GPU bundle、端口分配和 bundle 排序；[`nemo_rl/distributed/worker_groups.py`](https://github.com/NVIDIA-NeMo/RL/blob/main/nemo_rl/distributed/worker_groups.py) 里的 `RayWorkerGroup` 负责 worker 创建、rank/env 设置、bundle_indices、跨 worker 调用和结果聚合 |
| Slurm 启动 | 根目录 [`ray.sub`](https://github.com/NVIDIA-NeMo/RL/blob/main/ray.sub) 是 Slurm 上启动 Ray head / worker 的脚本，处理 container、mount、port layout、日志同步、attach、worker 检查、失败退出等逻辑 |
| Kubernetes infra | [`infra/`](https://github.com/NVIDIA-NeMo/RL/tree/main/infra) 包含 KAI scheduler、KubeRay、JobSet、Helmfile、本地 GPU-enabled kind、monolithic / disaggregated RayCluster / JobSet 示例；[`infra/nrl_k8s`](https://github.com/NVIDIA-NeMo/RL/tree/main/infra/nrl_k8s) 进一步提供 config-driven Kubernetes launcher |
| 异步 checkpoint | [`nemo_rl/utils/checkpoint.py`](https://github.com/NVIDIA-NeMo/RL/blob/main/nemo_rl/utils/checkpoint.py) 的 `CheckpointingConfig` 已包含 `is_async`；Automodel checkpoint manager 会把 `is_async` 传给 checkpointer；DTensor v2 policy worker 初始化 checkpoint manager 时默认设置 `is_async=True` |
| NVLink 拓扑感知 | Kubernetes GB300 示例 manifest 里用 KAI topology annotation 约束 GPU clique，并在 worker entrypoint 里通过 `nvidia-smi -q` 读取 `ClusterUUID`，注册 `nvlink_domain_<UUID>` 和 `topo_rank` 为 Ray custom resources；Megatron setup 中也设置 `external_gpu_device_mapping=True`，并给 HybridEP 配置 NVLink domain 相关环境变量 |
| NUMA / CPU locality | GB300 Kubernetes 示例里通过 `nvidia-smi topo -m` 生成 `NRL_GPU_CPU_AFFINITY_FILE`，把 GPU 到 CPU affinity 的映射传给运行时，给后续 NUMA-aware worker 绑定提供输入 |
| vLLM 多节点稳定性 patch | [`nemo_rl/models/generation/vllm`](https://github.com/NVIDIA-NeMo/RL/tree/main/nemo_rl/models/generation/vllm) 里有 vLLM worker、backend、async worker、generation wrapper；代码会 patch vLLM Ray executor，向 worker subprocess 传 `py_executable` 和 `NCCL_CUMEM_ENABLE` / `NCCL_NVLS_ENABLE` 等环境变量；跨节点并行时显式设置 `NCCL_NVLS_ENABLE=0`；async generation 路径有 timeout、socket lock、HTTP keepalive、shutdown cleanup 等稳定性处理 |

所以这件事比“未来可以做一个 Kubernetes RL 系统”更现实：**NeMo-RL 已经开源了 RL runtime、Ray 编排、Slurm/Kubernetes 启动、checkpoint 管理、NVLink topology plumbing、NUMA affinity 输入和 vLLM generation 稳定性 patch**。剩下真正值得平台化的是，把这些能力从 repo 里的脚本、runtime 模块和 manifests，进一步沉淀成云原生控制器、调度插件、节点 daemon、cache controller 和标准化 CRD。

这套系统可以分成几层：

| 层次 | 职责 |
|------|------|
| RLJob CRD | 描述一次 RL/MOPD 训练，包括 policy、rollout、reward、judge、environment、checkpoint 策略 |
| WorkerGroup | 管理 learner、generation、sandbox、judge 等异构 worker 的副本数、资源和生命周期 |
| Topology Scheduler | 感知 GPU、NVLink domain、NUMA、IB fabric、rack，保证 EP/TP/PP/RL rollout 的放置约束 |
| Inference Runtime | 管理 vLLM / TensorRT-LLM 等 generation backend，提供 health check、timeout、graceful restart |
| Environment Runtime | 管理 sandbox、tool calling、browser、terminal、grader，把环境执行也纳入调度和隔离 |
| Checkpoint / Cache Runtime | 负责异步 checkpoint、JIT cache、镜像 cache、warm start 和局部恢复 |
| Goodput Controller | 观测 rollout tail latency、GPU idle、failure rate、restart cost，并动态调整并发和资源 |

核心设计目标应该是 **RL goodput first**。Kubernetes 不能只知道“Pod Running”，还要知道这一组 Pod 是否真的在产生有效 rollout、是否有 generation tail、是否有 sandbox timeout、是否有某个 vLLM worker 卡死、是否因为 checkpoint 或 JIT cache 拖慢训练。换句话说，RLJob 的状态机要比普通 Job 更接近一个长生命周期分布式系统。

调度层可以重点做三件事：

1. **拓扑感知放置**：把 GPU UUID、NVLink ClusterUUID、NUMA node、IB leaf / spine、rack 信息注册成 Node label / extended resource / scheduler plugin 输入，让 TP/EP 组优先落在同一 NVLink domain，跨域通信显式可见。
2. **异构 worker 编排**：learner、rollout generator、sandbox、judge 的资源形态不同，不能只按 GPU 数量调度；CPU、memory、local NVMe、network、ephemeral storage 都会影响 RL step time。
3. **局部失败恢复**：generation worker、sandbox、tool-calling worker 可以独立重启和替换，RLJob controller 负责隔离失败、保留 in-flight 状态、避免整 job 重启。

存储和启动路径也应该平台化。镜像、JIT cache、checkpoint 都走“本地热路径 + 共享持久化路径”：节点本地 NVMe 承担高频读写，共享存储只做少并发归档；checkpoint 异步化，save plan 缓存化；JIT artifact 可以通过 DaemonSet 预热到节点，或者在镜像构建阶段 bake into runtime layer。

这样的系统最终会像一个运行在 Kubernetes 之上的 RL 训练操作系统：Kubernetes 提供资源、隔离和控制面，Ray / NeMo-RL / vLLM 提供执行 runtime，平台层负责 topology、cache、checkpoint、health、failure domain 和 goodput。Nemotron 3 Ultra §3.6 的意义就在这里：它把未来 RL infra 要解决的问题摊开了，而云原生版本要做的，是把这些经验沉淀成可复用的控制器、调度插件和运行时协议。
