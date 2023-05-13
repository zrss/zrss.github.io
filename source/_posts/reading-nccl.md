---
title: reading nccl
abbrlink: f62c2008
date: 2023-05-03 20:05:15
---

# rdma 和网络相关知识

1. https://www.doc.ic.ac.uk/~jgiceva/teaching/ssc18-rdma.pdf, rdma tutorial
1. https://www.openfabrics.org/images/eventpresos/workshops2013/IBUG/2013_UserDay_Thur_1400_Bob-Russell-programming-concepts.pdf, ofa rdma program, 非常好, 五星推荐
1. https://blog.zhaw.ch/icclab/infiniband-an-introduction-simple-ib-verbs-program-with-rdma-write/, 非常好
1. https://insujang.github.io/2020-02-09/introduction-to-programming-infiniband/, qp 状态转换流程
1. https://www.rdmamojo.com/2012/05/05/qp-state-machine/, qp 状态详述
1. https://arthurchiao.art/blog/linux-net-stack-implementation-rx-zh, linux rx 原理及内核实现
1. https://support.huawei.com/enterprise/zh/doc/EDOC1100197616/3dfff4ec, HPC 集群 mlnx 网卡巡检
1. https://support.huawei.com/enterprise/zh/doc/EDOC1100197616/37b637af, HPC 集群交换机 roce 流量信息巡检

缩写解释

CA: channel adapter, 即 rdma (infiniband) 网卡

# nccl ib

ncclNet

两种实现

* ncclNetSocket
* ncclNetIb

https://github.com/NVIDIA/nccl/issues/790

其中 ib 有如下一段代码

```
      if (wc->status != IBV_WC_SUCCESS) {
        char line[SOCKET_NAME_MAXLEN+1];
        WARN("NET/IB : Got completion from peer %s with error %d, opcode %d, len %d, vendor err %d",
             ncclSocketToString(r->addr, line), wc->status, wc->opcode, wc->byte_len, wc->vendor_err);
        return ncclRemoteError;
      }
```

ncclNetTest 被用于在特定场景下确认发送与接受是否完成

```
      // Check whether the network has completed some send operations.
      if (sub->done < sub->transmitted) {
        int done;
        int buffSlot = (sub->base+sub->done)%NCCL_STEPS;
        NCCLCHECK(ncclNetTest(comm, sub->requests[buffSlot], &done, NULL));
        if (done) {
          TRACE(NCCL_NET, "sendProxy [%ld/%d] request %p done", sub->done, buffSlot, sub->requests[buffSlot]);
```

pytorch 1.13 cuda 11.6.2 with nccl 2.14.3
