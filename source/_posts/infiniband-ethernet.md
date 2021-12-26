---
title: infiniband ethernet
tags: infiniband
abbrlink: 50cf0505
date: 2021-12-26 14:44:37
---

> TODO

```c++
  // IB setup
  ibv_context* ctx = ncclIbDevs[lComm->dev].context;
  uint8_t ib_port = ncclIbDevs[lComm->dev].port;
  struct ibv_port_attr portAttr;
  NCCLCHECK(wrap_ibv_query_port(ctx, ib_port, &portAttr));
  union ibv_gid gid;
  NCCLCHECK(wrap_ibv_query_gid(ctx, ib_port, ncclParamIbGidIndex(), &gid));

  // QP Creation
  NCCLCHECK(ncclIbInitVerbs(ctx, &rComm->verbs));
  NCCLCHECK(ncclIbCreateQp(ib_port, &rComm->verbs, IBV_ACCESS_REMOTE_WRITE, &rComm->qp));

  // Adjust the MTU
  remQpInfo.mtu = (enum ibv_mtu)std::min(remQpInfo.mtu, portAttr.active_mtu);

  // Setup QP
  struct ibv_qp* qp = rComm->qp;
  NCCLCHECK(ncclIbRtrQp(qp, &remQpInfo));
  NCCLCHECK(ncclIbRtsQp(qp));
```

`ib_write_bw`

> Failed to modify QP 100 to RTR

**ncclIbRtrQp**

NCCL WARN Call to ibv_modify_qp failed with error No such device
