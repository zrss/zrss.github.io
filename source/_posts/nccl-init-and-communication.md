---
title: NCCL 从建链到通信
abbrlink: 9e7a43b2
date: 2026-06-07 00:11:01
---

以 NCCL 2.14.3 源码为例，梳理 communicator 初始化时如何从拓扑搜索结果走到 transport 连接建立，以及建链完成后一次通信如何复用这些连接。

这里说的“建链”可以拆成两层：

1. 图层：决定每个 channel 上，本 rank 与哪个 rank 通信。
1. transport 层：决定这条边具体用 P2P、SHM 还是 NET 连接，并把 device kernel 需要的 `ncclConnInfo` 填好。

建链完成后，通信阶段主要复用 `ncclConnInfo`，由 host 生成 work，由 device kernel 和必要的 proxy 线程推进数据传输。

相关阅读：[reading nccl](/archives/f62c2008.html) 主要记录 NCCL 2.14.3 中 `net_ib`、RDMA、QP、MR、FIFO 等网络传输细节。本文侧重从 communicator 建链到一次通信执行的主线，两篇可以结合阅读。

# 总览

## 阶段主线

主线可以压缩为：

```text
topology / graph
  -> channel 逻辑邻居
  -> connectSend / connectRecv bitmask
  -> transport.setup 生成 ncclConnect
  -> bootstrap 交换 handle
  -> transport.connect 填 ncclConnInfo
  -> cudaMemcpyAsync 到 devPeers
  -> device kernel 可直接通信
```

下图按阶段和模块边界展示建链过程：

<img src="/images/nccl-connect-architecture.svg" alt="NCCL 建链架构图" width="100%">

## 主要源码入口

对应的主要文件：

* `src/init.cc`
  * `initTransportsRank` 是 communicator 建链主线。
  * `ncclTopoCompute` 搜索 ring/tree/collnet/nvls graph。
  * `ncclTopoPostset` 后，`comm->channels[c].ring/tree` 已经知道逻辑邻居。
  * 非 runtime connect 时，在初始化阶段直接调用 `ncclTransportRingConnect` 和 `ncclTransportTreeConnect`。
* `src/graph/connect.cc`
  * `ncclTopoPreset`：根据本节点 intra 排列先生成本 rank 的 `topoRanks`。
  * `ncclTopoPostset`：聚合所有 rank 的 `topoRanks`，生成全局 ring/tree 关系。
* `src/transport/generic.cc`
  * `ncclTransportRingConnect`
  * `ncclTransportTreeConnect`
  * `ncclTransportPatConnect`
* `src/transport.cc`
  * `ncclTransportP2pConnect`：标记要连谁。
  * `ncclTransportP2pSetup`：执行 setup、交换 handle、connect。
  * `selectTransport`：按 transport 优先级选择连接方式。
* `src/transport/p2p.cc`
* `src/transport/shm.cc`
* `src/transport/net.cc`

## 与 reading nccl 的内容对照

[reading nccl](/archives/f62c2008.html) 可以看作本文中 NET/IB 传输部分的展开。本文描述 NCCL 的通用抽象和调用主线，`reading nccl` 更接近 `ncclNetIb` 的实现细节。

| 本文中的位置 | reading nccl 中的对应内容 | 对应关系 |
| --- | --- | --- |
| `transport/net.cc` 和 NET transport | `nccl net`、`nccl net ib` | 本文说明 NCCL 如何选择 NET transport；旧文说明 NET 后端如何落到 socket 或 IB。 |
| `transport.setup` / `transport.connect` | `ib connect` / `ib accept` / `send check` / `recv check` | 本文把它抽象为 setup、handle 交换、connect；旧文展开为 QP、CQ、MR、FIFO、QP 状态转换。 |
| `ncclConnect` | `qpInfo`、fifo addr、rkey、qp 信息 | 本文中的 `ncclConnect` 是 transport 交换的抽象 handle；IB 实现中交换的是对端建立 RDMA 连接所需的信息。 |
| `ncclConnInfo` | MR、buffer、fifo、rkey 等可传输资源 | 本文关注 device/proxy 后续如何使用连接信息；旧文关注这些资源在 IB verbs 中如何注册和暴露。 |
| `ncclProxyStart` / `ncclProxyProgress` | `nccl recv 流程说明`、`nccl 流程说明` | 本文说明 proxy 何时被投递和推进；旧文说明 proxy 最终调用 `ncclNetIrecv` / `ncclIbIrecv` 等接口。 |
| `sendProxyProgress` / `recvProxyProgress` | `ncclIbIsend` / `ncclIbIrecv` / `ncclIbTest` | 本文描述 NET proxy 的发送、接收、轮询边界；旧文展开 IB 后端如何 `post_send`、`post_recv`、`poll_cq`。 |
| step / FIFO 通信协议 | `ncclIbSendFifo`、`ncclIbPostFifo` | 本文描述 NCCL 通用的 step/FIFO 协议；旧文展示 IB 后端如何通过 FIFO 传递接收侧地址和 rkey。 |

阅读时可以先用本文建立两条主线：

```text
建链：topology -> transport -> ncclConnInfo
通信：work -> device primitive -> proxy -> ncclNet
```

再回到 `reading nccl` 看 IB verbs 细节：

```text
ncclNet -> ncclNetIb
  -> connect / accept
  -> isend / irecv
  -> test
  -> ibv_post_send / ibv_post_recv / ibv_poll_cq
```

# 阅读路径

如果直接从 `initTransportsRank` 沿调用链展开，会同时涉及 topology、bootstrap、proxy、CUDA IPC、SHM、NET、GDR、PXN 等多个子系统。

阅读时可以先按问题边界分层，再进入完整调用链。

## 第一层：先看谁连谁

这一层只看 graph 层，不关心 P2P、SHM、NET。

要回答的问题是：

```text
每个 channel 上，本 rank 的上游和下游分别是谁？
```

关注函数：

```text
src/init.cc
  initTransportsRank
    ncclTopoCompute(ringGraph)
    ncclTopoCompute(treeGraph)
    ncclTopoPreset
    ncclTopoPostset

src/graph/connect.cc
  ncclTopoPreset
  ncclTopoPostset
  connectRings
  connectTrees
```

这一层的结论：

```text
topo / graph 阶段只是在填逻辑邻居：

channel->ring.prev
channel->ring.next
channel->tree.up
channel->tree.down[]
```

也就是说，这一层还没有真的建立连接，只是把通信图画出来。

## 第二层：再看逻辑邻居如何变成待连接任务

这一层看 `generic.cc` 和 `transport.cc` 的第一段。

要回答的问题是：

```text
ring.prev / ring.next 这些逻辑邻居，怎么告诉 transport 层去连接？
```

关注函数：

```text
src/transport/generic.cc
  ncclTransportRingConnect
  ncclTransportTreeConnect

src/transport.cc
  ncclTransportP2pConnect
```

这一层的阶段边界：

```text
ncclTransportP2pConnect 不建链。
```

它只是把待连接的 channel 写进 bitmask：

```text
comm->connectRecv[peer]
comm->connectSend[peer]
```

因此它可以视为待连接记录的生成步骤。

## 第三层：看连接建立函数

这一层进入连接建立逻辑。

要回答的问题是：

```text
待连接 bitmask 如何变成 device kernel 能用的 ncclConnInfo？
```

关注函数：

```text
src/transport.cc
  ncclTransportP2pSetup
  selectTransport
```

读 `ncclTransportP2pSetup` 时，可以先将分析范围限定为：

```text
rank A 和 rank B
一个 channel
一个 send connector
一个 recv connector
```

然后按这个顺序看：

```text
读 connectSend / connectRecv bitmask
  -> selectTransport
  -> transport.setup
  -> bootstrapSend / bootstrapRecv 交换 ncclConnect
  -> transport.connect
  -> 填 connector->conn，也就是 ncclConnInfo
  -> cudaMemcpyAsync 到 devPeers
```

这里最重要的是区分两个结构：

```text
ncclConnect:
  host 之间交换的临时 handle。
  它携带对端建立连接所需的信息。

ncclConnInfo:
  device kernel 最终使用的连接信息。
  里面有 buffs、head、tail、connFifo、stepSize 等字段。
```

这两个结构对应不同阶段：`ncclConnect` 属于 bootstrap 交换阶段，`ncclConnInfo` 属于 device 侧执行阶段。

## 第四层：最后再分 transport 看细节

transport 细节可以作为最后一层阅读，第一阶段只关注 `setup` 和 `connect`。

阅读顺序：

```text
src/transport/p2p.cc
  p2pSendSetup
  p2pRecvSetup
  p2pSendConnect
  p2pRecvConnect

src/transport/shm.cc
  shmSendSetup
  shmRecvSetup
  shmSendConnect
  shmRecvConnect

src/transport/net.cc
  sendSetup
  recvSetup
  sendConnect
  recvConnect
```

可以先读 P2P，再读 SHM 和 NET：

```text
P2P:
  GPU 之间可直接或间接访问。
  可能走 direct pointer、CUDA IPC、cuMem，也可能选 intermediate rank。

SHM:
  同 host、共享 /dev/shm 时使用。
  主要是共享内存描述符的创建和 import。

NET:
  跨节点通信的主要路径。
  会涉及 NIC 选择、GDR、PXN、proxy、异步 connect。
```

`proxyProgress` 主要用于运行时数据传输的进度推进，可以不纳入初始化建链的第一阶段阅读。

## 最小闭环

最小阅读闭环可以只覆盖 ring：

```text
connectRings
  -> ncclTransportRingConnect
  -> ncclTransportP2pConnect
  -> ncclTransportP2pSetup
  -> p2pSendSetup / p2pRecvSetup
  -> p2pSendConnect / p2pRecvConnect
```

在这个闭环中暂不展开 tree、CollNet、NVLS、runtime connect。ring 路径建立后，其它路径主要差异为：

```text
邻居集合不同
connIndex 不同
transport 细节不同
```

对应关系如下：

```text
graph 层：生成 channel 的逻辑通信关系
P2pConnect：将逻辑通信关系记录到待连接 bitmask
P2pSetup：处理待连接 bitmask
transport.setup：创建本地资源并生成 ncclConnect
bootstrap：交换 ncclConnect
transport.connect：根据对端 ncclConnect 建立连接
ncclConnInfo：保存 device kernel 使用的连接信息
```

# 建链流程

建链流程可以按阶段阅读：先生成 channel 的逻辑邻居，再把逻辑邻居登记成待连接任务，随后选择 transport、交换 handle、填充 `ncclConnInfo`。

## 生成逻辑邻居

初始化时，NCCL 先探测机器拓扑，计算 GPU、NIC、CPU 之间路径，然后搜索不同 collective algorithm 对应的 graph。

典型流程在 `initTransportsRank` 中：

```text
ncclTopoGetSystem
ncclTopoComputePaths
ncclTopoTrimSystem
ncclTopoSearchInit
ncclTopoCompute(ringGraph)
ncclTopoCompute(treeGraph)
ncclTopoCompute(collNetGraph / nvlsGraph)
```

此时 graph 中包含拓扑搜索结果。之后进入：

```text
ncclTopoPreset
bootstrapAllGather(allGather3Data)
ncclTopoPostset
```

`ncclTopoPreset` 先基于本节点 intra 排列生成本 rank 视角下的信息，例如：

* `topoRanks->ringRecv[c]`
* `topoRanks->ringSend[c]`
* `topoRanks->ringPrev[c]`
* `topoRanks->ringNext[c]`
* `topoRanks->treeToParent[c]`
* `topoRanks->treeToChild0[c]`
* `topoRanks->treeToChild1[c]`

然后所有 rank 做一次 `bootstrapAllGather`，每个 rank 都拿到全局的 `topoRanks`。

`ncclTopoPostset` 会调用：

```text
connectRings
connectTrees
```

这里会把 channel 中的逻辑邻居写好：

```text
channel->ring.prev
channel->ring.next
channel->tree.up
channel->tree.down[]
```

注意，这一步只回答“谁和谁连”，还没有真的建立 CUDA IPC、SHM 或 NET 连接。

## 记录待连接 bitmask

以 ring 为例：

```c
ncclTransportP2pConnect(comm, c, 1, &channel->ring.prev, 1, &channel->ring.next, 0)
```

tree 类似，只是 recv/send peer 来自 `tree.down[]` 和 `tree.up`。

`ncclTransportP2pConnect` 不创建 transport 资源，也不交换 handle。它根据 channel id 在两个 bitmask 上记录待连接关系：

```text
comm->connectRecv[peer] |= 1ULL << channelId
comm->connectSend[peer] |= 1ULL << channelId
```

因此，`ncclTransportP2pConnect` 的输出是待连接 bitmask，而不是已建立的连接。

连接建立发生在随后调用的：

```text
ncclTransportP2pSetup(comm, graph, connIndex)
```

## 建立连接并写入 ncclConnInfo

`ncclTransportP2pSetup` 可以拆成一个循环：

<img src="/images/nccl-connect-setup-sequence.svg" alt="NCCL P2pSetup 连接建立时序图" width="100%">

更具体一点：

1. 按 rank 距离枚举 peer。
1. 读取 `connectRecv[recvPeer]` 和 `connectSend[sendPeer]`，知道哪些 channel 需要连接。
1. 对每条待连接边调用 `selectTransport`。
1. `selectTransport` 按顺序尝试 `P2P`、`SHM`、`NET`、`COLLNET`。
1. 命中某个 transport 后调用它的 `setup`。
1. `setup` 创建本地资源，并把远端需要的信息写到 `ncclConnect`。
1. 通过 bootstrap 把 `ncclConnect` 交换给对端。
1. 调用对应 transport 的 `connect`，用对端 handle 去 import/map 资源。
1. 填好 `connector->conn`，也就是 `ncclConnInfo`。
1. 把 `ncclConnInfo` 拷到 device side 的 `devPeers`。
1. 最后做一次 bootstrap 同步，清理 `connectSend/connectRecv` bitmask。

`ncclConnInfo` 是 device kernel 使用的信息，核心字段包括：

* `buffs[]`
* `head`
* `tail`
* `connFifo`
* `stepSize`
* `flags`
* 部分 NET/GDR 场景下的 net device handle 和 memory handle

## 选择 transport

transport 抽象在 `src/include/transport.h`：

```c
struct ncclTransportComm {
  ncclResult_t (*setup)(...);
  ncclResult_t (*connect)(...);
  ncclResult_t (*free)(...);
  ncclResult_t (*proxySharedInit)(...);
  ncclResult_t (*proxySetup)(...);
  ncclResult_t (*proxyConnect)(...);
  ncclResult_t (*proxyFree)(...);
  ncclResult_t (*proxyProgress)(...);
  ncclResult_t (*proxyRegister)(...);
  ncclResult_t (*proxyDeregister)(...);
};

struct ncclTransport {
  const char name[8];
  ncclResult_t (*canConnect)(...);
  struct ncclTransportComm send;
  struct ncclTransportComm recv;
};
```

全局 transport 顺序在 `src/transport.cc`：

```c
struct ncclTransport* ncclTransports[NTRANSPORTS + 1] = {
  &p2pTransport, &shmTransport, &netTransport, &collNetTransport,
  &profilerTransport
};
```

`selectTransport` 会按这个顺序调用 `canConnect`，第一个返回可用的 transport 就会被选中。

因此普通点对点边的选择顺序为：

```text
优先 P2P
其次 SHM
最后 NET
```

### P2P transport

`src/transport/p2p.cc` 处理 GPU 之间可以直接或间接访问的场景。

setup 阶段：

* 判断是否可以 CUDA P2P。
* 判断使用 read 还是 write。
* 判断是否需要 intermediate rank。
* 同进程可能用 direct pointer。
* 跨进程可能用 CUDA IPC 或 cuMem handle。
* 通过本地 proxy 分配或导出可共享 buffer。
* 把 `p2pConnectInfo` 写入 `ncclConnect`。

connect 阶段：

* import/map 对端 buffer。
* 设置本端 `conn.buffs[]`。
* 设置 `head/tail`。
* 设置 `ptrExchange/redOpArgExchange` 等辅助字段。
* 设置 `proxyProgress`。

P2P 连接不一定是 A 与 B 直接连接。`p2pGetInfo` 可能选择 intermediate rank，形成 indirect P2P path。

### SHM transport

`src/transport/shm.cc` 处理同 host 且共享 `/dev/shm` 的场景。

`shmCanConnect` 主要检查：

* `NCCL_SHM_DISABLE` 是否关闭 SHM。
* topo 是否要求走 NET。
* 两个 rank 是否在同 host。
* 两个 rank 是否有共同的 shm device。

setup 阶段通过 SHM proxy 创建共享内存，把描述符写入 `shmConnectInfo`。

connect 阶段 import 对端共享内存，然后设置：

```text
conn.buffs[]
conn.head
conn.tail
conn.stepSize
```

### NET transport

`src/transport/net.cc` 是跨节点通信的主要 transport，也可能在同节点但拓扑要求走 NET 时使用。

setup 阶段会：

* 通过 `ncclTopoGetNetDev` 选择 NIC。
* 判断是否启用 GDR。
* 判断是否需要 PXN proxy。
* 通过 `ncclProxyConnect` 连到对应 proxy rank。
* 对 proxy 发送 `ncclProxyMsgSetup`。
* 把 proxy rank 和 GDR 信息放进 `ncclConnect`。

NET connect 阶段可能异步进行：

```text
ncclProxyCallAsync(ncclProxyMsgConnect)
ncclPollProxyResponse
```

如果还没完成，会返回 `ncclInProgress`。外层 `ncclTransportP2pSetup` 因此会循环 polling，直到所有 channel 都完成连接。

NET connect 完成后，会 map host/device/shared memory，并设置：

```text
conn.head
conn.tail
conn.connFifo
conn.buffs[]
conn.netDeviceHandle
conn.mhandles[]
```

## runtime connect

另一个分支是 runtime connect：

```c
comm->runtimeConn = comm->cuMemSupport && ncclParamRuntimeConnect();
```

如果 runtime connect 开启，初始化阶段不会把 ring/tree 都预连接好，而是在 group/enqueue 阶段按需连接。

相关入口：

* `ncclP2PPreconnectFunc`
* `ncclCollPreconnect`

这也是为什么有时候读 `initTransportsRank` 会发现某些连接没有在 init 阶段直接发生。

# 通信流程

建链完成后，NCCL 不会在每次通信时重新选择 transport。建链阶段已经把每个 channel、peer、connIndex 对应的连接信息写入 `connector->conn`，并同步到 device side 的 `devPeers`。通信阶段复用这些连接信息，主要完成三件事：

```text
host 侧生成本次通信的 work
device kernel 按算法执行 copy / reduce / send / recv
proxy 线程在需要时推进 NET 或其它需要 CPU 参与的 transport
```

下图展示一次通信对建链产物的使用方式：

<img src="/images/nccl-after-connect-communication.svg" alt="NCCL 建链后的通信过程" width="100%">

## Host 侧生成 work

一次 collective 或 P2P API 调用先被放入 communicator 的 planner。group launch 阶段会调用：

```text
ncclLaunchPrepare
  -> scheduleCollTasksToPlan / scheduleP2pTasksToPlan
  -> finishPlan
```

`ncclLaunchPrepare` 的输出是 `ncclKernelPlan`。plan 中包含：

* 本次通信使用哪些 channel。
* 每个 channel 上的 device work。
* kernel 参数和 work buffer。
* 需要 proxy 推进时的 proxy op。

随后 launch 阶段会执行：

```text
uploadWork
  -> 把 ncclDevWork 写入 kernel args 或 work FIFO

uploadProxyOps / ncclProxyStart
  -> 如果 transport 需要 proxy，则把 proxy op 投递给 proxy progress thread

ncclLaunchKernel
  -> 按 channel 数启动 NCCL device kernel
```

在这个阶段，host 侧主要负责“把本次通信描述清楚”。真正的数据搬运发生在 device kernel 和 proxy progress 中。

## Device kernel 消费连接信息

device kernel 拿到 work 后，会根据 collective 类型、algorithm、protocol 进入对应实现。

以 ring allreduce 为例，核心路径在 `src/device/all_reduce.h` 的 `runRing`。它使用建链阶段写好的：

```text
ncclShmem.channel.ring.prev
ncclShmem.channel.ring.next
```

并构造 `Primitives`。ring allreduce 的执行可以分成两个阶段：

```text
reduce-scatter:
  directSend
  recvReduceDirectSend
  recvReduceCopyDirectSend

all-gather:
  directRecvCopyDirectSend
  directRecv
```

这些 primitive 最终会进入 `src/device/prims_simple.h` 中的 `genericOp`。`genericOp` 的基本循环是：

```text
waitPeer
  -> 等待对端 step 状态满足条件
  -> 根据 connFifo / directBuff / buffs 计算本 slice 使用的地址

reduceCopy
  -> 执行 copy、reduce 或 reduce + copy

postPeer
  -> 更新 step counter
  -> 通知对端当前 slice 已经生产或消费完成
```

对于用户显式的 `ncclSend` / `ncclRecv`，device 侧路径在 `src/device/sendrecv.h`。send 侧循环调用 `directSend`，recv 侧循环调用 `directRecv`，同样通过 `Primitives` 使用建链阶段准备好的连接。

## step 和 FIFO

`ncclConnInfo` 中的 `buffs`、`head`、`tail`、`connFifo`、`stepSize` 是通信阶段的关键状态。

可以把它理解为一个带 credit 的环形 FIFO：

```text
NCCL_STEPS 个 slot 循环使用
每个 slice 对应一个或多个 step
发送方等待可写 slot
接收方等待可读 slot
数据写入或读出后更新 step counter
head / tail / connFifo 用于表达空间、数据大小和可见性
```

因此，通信阶段不是简单地调用一次 memcpy。它是按照 slice/chunk 粒度，在 channel 上反复执行：

```text
等待可用 step
确定 buffer 地址
copy / reduce
发布 step
进入下一个 slice
```

## Proxy 推进 NET 等传输

如果当前连接是 GPU 可以直接访问的 P2P 路径，device primitive 可以直接读写对端可见的 buffer。

如果当前连接需要 CPU proxy，例如 NET transport，device kernel 和 proxy thread 会共同推进传输：

```text
device kernel:
  写入 staging buffer
  更新 tail 或 connFifo

proxy progress thread:
  发现 GPU 数据 ready
  调用 ncclNet->isend / ncclNet->irecv
  轮询 ncclNet->test
  网络完成后更新 head / tail / connFifo

device kernel:
  观察 step 状态变化
  继续消费下一个 slice
```

对应代码路径：

```text
src/proxy.cc
  ncclProxyStart
  ncclProxyProgress
  progressOps

src/transport/net.cc
  sendProxyProgress
  recvProxyProgress
```

`sendProxyProgress` 主要做三件事：

```text
给 GPU 投递可用 buffer
等待 GPU 写完并设置 connFifo size / tail
调用 ncclNet->isend，完成后释放 FIFO slot
```

`recvProxyProgress` 主要做三件事：

```text
把接收 buffer 投递给 ncclNet->irecv
等待网络接收完成
更新 GPU 可见的状态，让 device kernel 继续读取
```

## 建链和通信的边界

二者的边界可以概括为：

```text
建链阶段：
  选择 transport，交换 handle，填 ncclConnInfo。

通信阶段：
  复用 ncclConnInfo，把本次 API 调用切成 channel work，
  由 device kernel 和 proxy progress 按 step/FIFO 协议完成数据传输。
```

# 小结

NCCL 的建链和通信可以按两个阶段理解。

建链阶段可以概括为：

```text
topology 决定 channel 的逻辑邻居，
P2pConnect 把待连接边登记到 bitmask，
P2pSetup 选择 transport、交换 handle、填 ncclConnInfo，
最后把 conn 信息拷到 device，让 kernel 直接通信。
```

通信阶段可以概括为：

```text
host 把 API 调用切成 ncclKernelPlan，
device kernel 按 channel 执行 collective 或 P2P work，
Primitives 通过 waitPeer / reduceCopy / postPeer 消费 ncclConnInfo，
NET 等路径由 proxy progress 线程协同推进。
```

源码结构对应关系：

* `graph/connect.cc` 负责生成 channel 的逻辑通信关系。
* `transport.cc` 回答“这些边什么时候建、怎么调度建”。
* `transport/p2p.cc`、`transport/shm.cc`、`transport/net.cc` 回答“具体 transport 如何创建资源、交换 handle、填 device 可用的连接信息”。
* `enqueue.cc` 和 `group.cc` 负责把一次 API 调用变成 kernel plan。
* `device/all_reduce.h`、`device/sendrecv.h` 和 `device/prims_simple.h` 负责 device 侧 copy、reduce 和 step/FIFO 协议。
* `proxy.cc` 和 `transport/net.cc` 负责需要 proxy 参与的运行时传输。

按上述边界划分后，NCCL 可以拆成两条相互衔接的主线：建链阶段准备连接，通信阶段复用连接。
