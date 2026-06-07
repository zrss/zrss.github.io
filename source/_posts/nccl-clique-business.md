---
title: 业务侧配置与 NCCL clique
abbrlink: 8a7d13c9
date: 2026-06-07 12:29:33
---

本文以当前 NCCL `master` 分支源码为例，版本标识来自 `makefiles/version.mk`，当前为 NCCL 2.30.7。

本文中的“业务侧 NCCL clique”不是 NCCL 暴露的独立 API，而是指业务或训练框架对一组 rank / GPU 的通信组织方式。例如数据并行组、张量并行组、流水并行组、专家并行组，在运行时会对应到一个或多个 NCCL communicator。

相关阅读：

* [NCCL 从建链到通信](/archives/9e7a43b2.html)：解释 communicator 初始化、建链和一次通信执行主线。
* [reading nccl](/archives/f62c2008.html)：以 NCCL 2.14.3 为例展开 `net_ib`、RDMA、QP、MR、FIFO 等实现细节。

# 几种 clique 的含义

NCCL 相关讨论里，`clique` 可以对应三类对象。

| 名称 | 来源 | 业务影响方式 | 含义 |
| --- | --- | --- | --- |
| communicator clique | NCCL API / 训练框架 | 由业务通信组直接定义 | 一组 rank 使用同一个 `ncclUniqueId`、`nranks` 和唯一 rank 编号初始化成同一个 communicator。 |
| launch clique | NCCL 本地 launch 逻辑 | 由进程内 communicator 组织和 group 调用顺序间接影响 | 同一进程内、同一 `intraComm0` 的 sibling communicator 会被放在一起 prepare / launch。 |
| MNNVL clique | NVML / Fabric Manager / NCCL MNNVL 逻辑 | 由 GPU placement、Fabric Manager 和相关环境变量间接影响 | Multi-Node NVLink fabric 中，具有相同 fabric UUID 和 cliqueId 的 rank 会被认为处在同一个 NVLink domain。 |

本文把业务文档中的“NCCL clique”对应到第一类：一组业务 rank 被组织成同一个 communicator。

MNNVL clique 和业务 clique 都表示 rank 的集合关系，但来源不同。业务 clique 来自框架和调度输入，MNNVL clique 来自硬件 fabric 信息；业务可以影响 MNNVL clique 的使用条件，但不直接定义硬件 fabric 的物理拓扑。

下图给出从业务输入到 NCCL 实际通信顺序的层次关系：

<img src="/images/nccl-clique-business-layers.svg" alt="业务侧影响 NCCL clique 的层次图" width="100%">

# 业务通信组到 communicator 的映射

NCCL API 注释里，`ncclCommInitRank` 要求 rank 在一个 communicator clique 内唯一。这里的 communicator clique 表示一组共同参与同一个 communicator 的 ranks。

典型初始化输入是：

```text
ncclUniqueId
nranks
rank
CUDA device
```

其中：

* `ncclUniqueId` 决定哪些进程 / 线程加入同一个 communicator。
* `nranks` 决定 communicator 的规模。
* `rank` 是这个 communicator 内的逻辑编号，必须唯一。
* 当前 CUDA device 决定该 rank 绑定到哪张 GPU。

单进程多卡时，`ncclCommInitAll` 是一个便利封装。源码注释也说明 `devlist` 的顺序定义了 communicator 内 processor 的 user-order。它内部会生成一个 `ncclUniqueId`，再用 `ncclGroupStartInternal` / `ncclGroupEndInternal` 批量初始化多张 GPU 上的 communicator。

多进程训练框架通常先完成 rendezvous，然后为不同通信组构造不同的 communicator。例如：

```text
global group:
  ranks = [0, 1, 2, 3, 4, 5, 6, 7]

tensor parallel group:
  ranks = [0, 1, 2, 3]
  ranks = [4, 5, 6, 7]

data parallel group:
  ranks = [0, 4]
  ranks = [1, 5]
  ranks = [2, 6]
  ranks = [3, 7]
```

这些业务组如果使用 NCCL backend，会对应到不同的 NCCL communicator。每个 communicator 都有自己的 rank 空间。全局 rank 4 在某个 data parallel communicator 里可能是 rank 1；在 global communicator 里仍然是 rank 4。

# 业务侧输入项

业务侧对 NCCL 的影响，主要发生在初始化之前和 collective enqueue 之前。

## rank 集合

业务可以决定哪些进程 / GPU 进入同一个 communicator。

这会直接影响：

* communicator 的 `nranks`；
* collective 的参与者；
* NCCL 拓扑搜索看到的 rank 集合；
* 后续 ring、tree、NVLS、CollNet 等图的候选空间。

如果业务把跨机 rank 放进同一个 communicator，NCCL 需要考虑 NET transport。如果业务把同机 GPU 放进一个 communicator，NCCL 可以在 P2P、SHM、NVLS 等路径中选择。

## rank 顺序

业务可以决定 communicator 内 rank 的编号顺序。

这个顺序不是最终通信边的唯一决定因素，但它是 NCCL 图搜索的输入之一。NCCL 会结合 GPU busId、NVLink、PCIe、NIC、NUMA、MNNVL 等拓扑信息计算 ring / tree。最终每个 channel 上的 `ring.prev` 和 `ring.next`，是在拓扑计算和 `ncclTopoPostset` 之后确定的。

因此，业务 rank 顺序可以影响通信图，但不等价于“业务指定 ring 顺序”。NCCL 仍然会根据拓扑和配置做选择。

## rank 到 GPU 的 placement

业务调度和框架启动方式决定 rank 绑定到哪张 GPU。

该映射会影响 NCCL 的 transport 选择和图搜索，因为 NCCL 会使用物理位置信息：

* 同一进程还是不同进程；
* 同一节点还是跨节点；
* GPU 之间是 NVLink、PCIe 还是需要经过 CPU / NIC；
* GPU 到 NIC 的距离；
* 是否属于同一个 MNNVL fabric domain。

例如，同样是 8 个 rank，如果 rank 0-7 都在同一台 8 卡机器上，和 rank 0-7 分散在 8 台机器上，NCCL 得到的图和 transport 选择会不同。

## communicator 切分

业务可以通过框架里的 process group / communication group，或者直接使用 `ncclCommSplit`，把已有通信世界切成多个 communicator。

`ncclCommSplit` 的语义是：

* 相同 `color` 的 ranks 会进入同一个新 communicator；
* `key` 用来决定新 communicator 内 rank 顺序；
* `NCCL_SPLIT_NOCOLOR` 表示该 rank 不进入任何新组。

这种语义可以对应业务里的 data parallel、tensor parallel、expert parallel 分组。它影响的是 communicator 边界，而不是单次 collective 内部的 packet 传输顺序。

## collective 调用和 group launch

业务可以影响 collective 的 enqueue 顺序：

* 哪个 stream 上调用；
* 同一个 stream 上 collective 的先后顺序；
* 是否用 `ncclGroupStart` / `ncclGroupEnd` 把多个 communicator 的操作聚合起来；
* 每次 collective 的数据规模、datatype、op 类型。

NCCL 内部 `ncclGroupCommJoin` 会把同一进程内 sibling communicators 放在相邻位置。这里的 sibling 由 `intraComm0` 判断。`doLaunches` 再按这些本地 clique 分批 prepare、launch、finish。

因此，业务调用顺序会影响 launch 组织方式；NCCL 也会在本地对 communicator 做聚合和排序，以满足多 GPU 同进程场景下的 launch 约束。

## 环境变量和配置

业务或平台也可以通过环境变量影响 NCCL 选择。

常见方向包括：

* `NCCL_ALGO`：约束 algorithm，例如 Ring、Tree、NVLS、CollNet 等。
* `NCCL_PROTO`：约束 protocol，例如 Simple、LL、LL128。
* `NCCL_MIN_NCHANNELS` / `NCCL_MAX_NCHANNELS`：影响 channel 数量边界。
* `NCCL_MNNVL_ENABLE`：控制是否启用 MNNVL 检测。
* `NCCL_MNNVL_CLIQUE_ID`：在支持 MNNVL 的系统上，用于设置 MNNVL cliqueId。
* `NCCL_MNNVL_CROSS_CLIQUE`：允许同一 NVLink domain 内跨 clique 的 P2P。

这些配置可用于验证、隔离或特定平台调优。它们约束 NCCL 的选择空间，不等同于显式指定完整的通信执行计划。

# MNNVL clique 的来源

MNNVL clique 表示 Multi-Node NVLink fabric 中的硬件通信域。它和业务 clique 都描述 rank 集合，但来源是 NVML / Fabric Manager 提供的 fabric 信息。

初始化时，NCCL 会在 `fillInfo` 里通过 NVML 读取 GPU fabric 信息。相关信息包括：

```text
fabricInfo.clusterUuid
fabricInfo.cliqueId
fabricInfo.state
```

当前源码也提供了 `NCCL_MNNVL_UUID` 和 `NCCL_MNNVL_CLIQUE_ID` 这样的环境变量覆盖入口。文档里说明 `NCCL_MNNVL_CLIQUE_ID` 从 2.25 起可用，通常由 Fabric Manager 分配，也可以用于 MNNVL job 的 soft partition。

随后 `ncclMnnvlCheck` 会做几件事：

* 要求 cuMem 和 FABRIC handle 支持可用；
* 要求所有 ranks 的 fabric state 都完成；
* 比较 rank 之间的 `clusterUuid`；
* 在相同 `clusterUuid` 内，再按 `cliqueId` 判断是否属于同一个 clique；
* 把同 clique 的 ranks 记录到 `comm->clique.ranks`；
* 设置 `comm->cliqueRank`、`comm->clique.size`、`comm->nvlDomainSize`；
* 条件满足后设置 `comm->MNNVL = 1`。

拓扑检查里，`ncclTopoCheckMNNVL` 也是按这个规则判断：

```text
same clusterUuid &&
  (same cliqueId || p2pCrossClique enabled)
```

如果启用了 cross-clique，并且两个 rank 在同一个 UUID 但不同 cliqueId 中，NCCL 会把它作为 cross-clique P2P 场景处理。

二者关系可以描述为：

```text
业务 clique:
  由业务决定哪些 rank 组成一个 communicator。

MNNVL clique:
  由 Fabric / NVML 信息描述哪些 rank 处在同一个 Multi-Node NVLink clique。

二者交集:
  如果业务把一组 rank 放进 communicator，而这些 rank 在硬件上也属于同一个 MNNVL clique，
  NCCL 可以把 MNNVL 纳入 topology / transport 选择。
```

# 通信顺序的层次

“NCCL 的通信顺序”包含多个层次。业务输入的影响范围取决于具体层次。

## 第一层：communicator 内 rank 顺序

业务通过 rank list、`key`、`devlist`、进程启动顺序等方式，决定 communicator 内 rank 编号。NCCL 后续所有拓扑和 collective 逻辑都以 communicator 内 rank 编号为基础。

但 rank 顺序只是输入，不是最终 ring / tree 的完整结果。

## 第二层：topology graph 顺序

NCCL 初始化时会根据 rank 到 GPU / NIC 的物理关系计算图。

在 ring 场景下，最终每个 channel 上，本 rank 看到的是：

```text
channel[c].ring.prev
channel[c].ring.next
```

在 tree 场景下，则会有 parent / children 等关系。这个阶段综合了业务 placement、硬件拓扑、NCCL 配置和搜索策略。

业务可以通过 placement 和 rank mapping 影响 topology graph，但 rank list 的顺序不等同于最终 ring 顺序。

## 第三层：group launch 顺序

如果业务用 `ncclGroupStart` / `ncclGroupEnd` 聚合多个 communicator 或多个 GPU 上的 collective，NCCL 会做本地 launch 排序。

当前源码中，`ncclGroupCommJoin` 会优先把具有相同 `intraComm0` 的 communicator 放在一起。注释里明确说这样做是为了保留用户程序顺序，同时保证 sibling communicators 连续出现。

`doLaunches` 的外层循环也按相同 `intraComm0` 形成的 clique 迭代。每个 clique 内先 prepare，再按 rounds launch，最后 finish。

这里的 clique 是 launch clique，不是 MNNVL clique。

## 第四层：kernel 内 chunk / step 顺序

数据移动发生在 NCCL kernel 和 proxy 线程里。

这一层由多个因素共同决定：

* collective 类型：AllReduce、AllGather、ReduceScatter、Broadcast 等；
* algorithm：Ring、Tree、NVLS、CollNet、PAT 等；
* protocol：Simple、LL、LL128；
* channel 数量；
* chunk / slice / step 划分；
* transport 是 P2P、SHM 还是 NET；
* NET 场景下 proxy 如何推进 send / recv。

业务可以通过 message size、算法 / 协议环境变量、placement 影响选择结果，但具体 packet 或 chunk 的顺序由 NCCL kernel 和 transport progress 逻辑决定。

# 一个业务视角的例子

假设有 16 个 GPU，分布在两台 8 卡机器上：

```text
node0: rank 0 1 2 3 4 5 6 7
node1: rank 8 9 10 11 12 13 14 15
```

业务可以组织两类通信组：

```text
tensor parallel:
  [0,1,2,3,4,5,6,7]
  [8,9,10,11,12,13,14,15]

data parallel:
  [0,8], [1,9], [2,10], [3,11],
  [4,12], [5,13], [6,14], [7,15]
```

从业务层看，这是两类 clique configuration。

从 NCCL 层看，它们会对应到不同 communicator：

* tensor parallel communicator 主要覆盖同机 GPU 通信，NCCL 可能选择 P2P / SHM / NVLS 等路径；
* data parallel communicator 跨节点，NCCL 需要考虑 NET transport；
* 如果平台支持 MNNVL，并且这些 GPU 的 fabric UUID / cliqueId 满足条件，MNNVL 会进入拓扑判断；
* 如果业务改变 rank 到 GPU 的 placement，两个 communicator 的拓扑图和 transport 选择都可能改变。

这个例子中，业务没有直接指定“ring 是 0->1->2->3”。业务指定的是：哪些 rank 一起通信，以及这些 rank 放在哪些 GPU 上。

# 观察和验证

如果要验证业务 clique 到 NCCL 实际图的映射，可以从日志和 dump 文件入手。

常用方式：

```bash
NCCL_DEBUG=INFO
NCCL_DEBUG_SUBSYS=INIT,GRAPH,TUNING,NET,COLL
NCCL_TOPO_DUMP_FILE=/tmp/nccl-topo.xml
NCCL_GRAPH_DUMP_FILE=/tmp/nccl-graph.xml
```

如果只想让特定 rank dump，可以结合：

```bash
NCCL_TOPO_DUMP_FILE_RANK=0
NCCL_GRAPH_DUMP_FILE_RANK=0
```

可以重点观察几类信息：

* communicator 的 `rank`、`nRanks`、`localRank`、`MNNVL`；
* ring / tree 图里每个 channel 的邻居；
* algorithm / protocol 的选择；
* NET / P2P / SHM / NVLS 相关日志；
* MNNVL 的 `cliqueId`、`cliqueSize`、`cliqueRank`、`nvlDomainSize`。

# 小结

业务侧所谓 NCCL clique，在本文中对应“业务通信组到 NCCL communicator 的映射”。它主要通过 rank 集合、rank 顺序、GPU placement、communicator split、collective 调用顺序和环境变量影响 NCCL。

MNNVL clique 和业务 clique 都表示分组关系，但来源不同：MNNVL clique 是硬件 fabric domain，业务 clique 是 communicator membership。业务可以通过调度 placement 和相关环境变量影响 MNNVL 是否被 NCCL 使用，但 MNNVL clique 不是普通业务分组 API。

因此，业务侧给 NCCL 提供成员、顺序和物理放置约束；NCCL 根据这些输入结合硬件拓扑和内部策略，决定最终的通信图、transport、launch 节奏和 kernel 内数据推进顺序。
