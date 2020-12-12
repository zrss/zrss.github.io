---
title: mxnet-network-and-infiniband
abbrlink: efe6a532
date: 2019-05-01 10:46:35
tags: hpc
---

# MXNet 分布式通信

MXnet 使用了 dmlc/ps-lite 实现其分布式通信机制

ps-lite

van.h 父类，使用 Protocol buffer 定义了数据格式

zmq_van.h 继承 van.h，使用 zmq 做具体的数据传输

当前 MXnet 只能使用 IPoIB，不能直接使用 IB verbs 来通信；有个改动 ps-lite 也能直接使用 ib 来通信的 PR 挂了一年多了 …

# RDMA in kubernetes

IB 这东西嘛，看起来是没服务发现的能力的；就是使用之前，需要使用 IP 网络通信一次，然后知道对端的 IB 的地址后，才能直接基于 IB 来通信

NCCL 就是这么干的

当然参考阿里云的说法

> RDMA通讯建连过程普遍分为 TCP 和 RDMA_CM 两种实现，如果应用程序使用RDMA_CM 的建连的方式，vpc网络插件中分配的pod ip 无法作为RDMA_CM 地址， 容器需要设置HostNetwork。并将bond0 ip 设置为CM的通讯地址

这得看下 mlx device plugin 的实现和容器网络的实现，比较好奇，看一下吧

业界有两种实现 SR-IOV (single root io virtualization) 另一种就是直接共享设备 (HCA: host channel adapter)

## HCA

HCA 就没啥好说的了，device plugin allocate 时，给 kubelet 返回设备路径，直接整个把 /dev/infiniband 挂载入容器中即可 … 这点会比较误导，相当于可以用所有的 HCA ?

所以对于 HCA 来说，直接用原先的容器网络来初始化 IB 通信即可，即在容器网络上做 ib 设备地址的发现，随后再用 ib verbs api 来通信

当然如果实现时，不是使用 tcp 的方式来初始化 IB，使用的是 rdma_cm，会有区别，容器的 ip 不能用于通信，只能用主机上的 bond0 ip 来通信 （主网卡）

有点儿奇怪可能与 rdma_cm 的 api 有关 …

另外最好加个这个，让单机多卡的训练可以 IPC 通信

```yaml
securityContext:
  capabilities:
    add: [ "IPC_LOCK" ]
```

## SR-IOV

PF -> VF

需要 SR-IOV CNI plugin 及 device plugin 配合

device plugin 挂载 /dev/infiniband 到容器中

SR-IOV CNI plugin 负责将 VF 绑定到容器的 network namespace 中

假设 VF 事先创建好

逻辑是通的，CNI 记录每个节点哪些 VF 已被分配，每个节点记录剩余几个 VF，当有新的 pod 被调度到当前节点时，CNI 即可分配未使用的 VF 与 pod

# IP over Infiniband

IPoIB 由 ipoib driver 实现，能像一般 NIC (ifconfig) 一样使用 ib 网络，当然性能差一些，在到达 NIC 之前，与 socket 通信的开销一致

* socket api
* ib verbs api

socket api 走 os 调用栈，CPU 参与

ib verbs 直接走 ib，相当于 bypass 了 os 与 CPU，硬件卸载

不过有个地方比较疑惑，IPoIB，infiniband 底层的传输方式是 datagram 即不可靠传输，不过上层应用（zmp）都是 tcp，应有自己的重传机制；其次 ps-lite van.h 里也有开关控制重传功能，在未收到当前消息的 ACK 时，不会处理该请求，这里展开说下

van.h 初始时，如果看到打开了重传开关，则初始化 resend.h

启动了一个线程，周期性 (Timeout) 的重传 send_buf 中的消息

van.h 在

* 发送数据时，将数据加入 send_buf 中；
* 接收到数据时
    * 如果是 ACK，则从 send_buf 中移除该消息，并把数据交给上层处理
    * 若当前数据仍不是 ack 数据，则查看是否已发送过 ACK
        * 是的话，则认为是重复消息，不交上层处理，并发送 ACK
        * 否则 交上层处理，记录到 ACK set 中，并发送 ACK

不过这个重传的场景比较神奇，话说 TCP 已经有 ACK 和重传机制了 … 不懂 ps-lite 是遇到了什么具体的场景，再做了一次重传的增强设计

而且这个设计有个限制，收发数据越多，似乎内存消耗越大，因为记录是否收到过该消息的 ACK 的 set，并没有清理的机会，会一直增加

所以一般也未见开启这个功能，env.md 里都没说明这两环境变量，姑且认为是个废弃特性吧 …

```
PS_RESEND=1
PS_RESEND_TIMEOUT=1000 # ms
```

# 厂家

## Azure

只支持 RDMA on IB 不支持 IP over IB

In Azure, IP over IB is not supported. Only RDMA over IB is supported.

https://docs.microsoft.com/zh-cn/azure/virtual-machines/linux/sizes-hpc#rdma-capable-instances

## Aliyun

k8s 目前只看到 RDMA on IB，IP over IB 没看到，看起来是直接主机网络之后，用 ib0 ip 就行？

## AWS

sagemaker 25Bbps/s 互联，看起来不像 IB or RoCE

# 参考

https://community.mellanox.com/s/article/kubernetes-ipoib-ethernet-rdma-sr-iov-networking-with-connectx4-connectx5

在 Kubernetes 上使用 RDMA
