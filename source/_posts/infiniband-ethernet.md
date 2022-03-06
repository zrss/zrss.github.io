---
title: infiniband ethernet
tags: infiniband
abbrlink: 50cf0505
date: 2021-12-26 14:44:37
---

# Configure RoCE

https://community.mellanox.com/s/article/howto-configure-roce-on-connectx-4

https://community.mellanox.com/s/article/understanding-show-gids-script

> Use `ibv_query_gid` and `ibv_find_gid_index` functions defined in libibverbs to get the desired GID index.

根据上述材料可知，RoCE 首先需要网卡设备支持比如 mlnx ConnectX-4

以 mlnx 网卡设备为例

1. 找到 mlnx 设备 GID 映射到的网络设备

`cat /sys/class/infiniband/mlx5_0/ports/1/gid_attrs/ndevs/1`

2. 查看 GIDs 1 对应的 RoCE type

`cat /sys/class/infiniband/mlx5_0/ports/1/gid_attrs/types/1`

3. 查看 GIDs 1 地址

`cat /sys/class/infiniband/mlx5_0/ports/1/gids/1`

| Interface   | GID Index | RoCE version | GID Address |
| ----------- | ----------- | ----------- | ----------- |
| ens785f0    | 1        | RoCEv2 | fe80:0000:0000:0000:e61d:2dff:fef2:a488 |

确定好需要使用的 GID 后，可使用 `ib_send_bw` 指定 GID 进行 RoCE 通信

另外注意到

> https://community.mellanox.com/s/article/howto-configure-roce-on-connectx-4

在 mlnx 设备映射到的网络设备中增加的 vlan 网卡也支持 RoCE

# RoCE in container

## NCCL RoCE failed in container

> NCCL WARN Call to ibv_modify_qp failed with error No such device

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

**ncclIbRtrQp**

```c++
ncclResult_t ncclIbRtrQp(ibv_qp* qp, struct ncclIbQpInfo* info) {
  struct ibv_qp_attr qpAttr;
  memset(&qpAttr, 0, sizeof(struct ibv_qp_attr));
  qpAttr.qp_state = IBV_QPS_RTR;
  qpAttr.path_mtu = info->mtu;
  qpAttr.dest_qp_num = info->qpn;
  qpAttr.rq_psn = 0;
  qpAttr.max_dest_rd_atomic = 1;
  qpAttr.min_rnr_timer = 12;
  if (info->lid == 0) {
    qpAttr.ah_attr.is_global = 1;
    qpAttr.ah_attr.grh.dgid.global.subnet_prefix = info->spn;
    qpAttr.ah_attr.grh.dgid.global.interface_id = info->iid;
    qpAttr.ah_attr.grh.flow_label = 0;
    qpAttr.ah_attr.grh.sgid_index = ncclParamIbGidIndex();
    qpAttr.ah_attr.grh.hop_limit = 255;
    qpAttr.ah_attr.grh.traffic_class = ncclParamIbTc();
  } else {
    qpAttr.ah_attr.is_global = 0;
    qpAttr.ah_attr.dlid = info->lid;
  }
  qpAttr.ah_attr.sl = ncclParamIbSl();
  qpAttr.ah_attr.src_path_bits = 0;
  qpAttr.ah_attr.port_num = info->ib_port;
  NCCLCHECK(wrap_ibv_modify_qp(qp, &qpAttr, IBV_QP_STATE | IBV_QP_AV | IBV_QP_PATH_MTU | IBV_QP_DEST_QPN | IBV_QP_RQ_PSN | IBV_QP_MAX_DEST_RD_ATOMIC | IBV_QP_MIN_RNR_TIMER));
  return ncclSuccess;
}
```

推测是在容器中虽然发现了 mlnx 设备，但是并没有发现 mlnx 设备对应的网络设备（例如 demo 中的 ens785f0)，也就无法找到可使用的 GID 进行 RoCE 通信

## ib_write_bw failed in container

> Failed to modify QP 100 to RTR

使用 `ib_write_bw` 也会报错，看报错信息，与 NCCL 出错的方法一致 `ncclIbRtrQp`

## multus-cni

https://github.com/k8snetworkplumbingwg/multus-cni

理论上需要使用 multus-cni 以 macvlan 的方式增加 RoCE 网络设备到容器中

https://github.com/Mellanox/k8s-rdma-sriov-dev-plugin/issues/18

> instead of calico, you should use macvlan cni where those virtual devices are child of enp175s0. RoCE can make use of those netdevices.
>
> Other users are using multus plugin, which allows you to have multiple netdev interfaces in a Pod. Such as first managed default veth interface via your existing plugin, and second macvlan or sriov interface via 2nd cni.
This way you get both of both world for performance and functionality.

根据 multus-cni quick start 文档，假若 multus 实测可兼容目前 k8s 集群默认的 cni 插件的情况下，需要额外增加 macvlan RoCE 网络设备的 crd 资源配置（假若主机上有多个 RoCE 网络设备，则可分别创建多个 crd 资源配置，每个资源配置对应其中一个 RoCE 网络设备）

```shell
cat <<EOF | kubectl create -f -
apiVersion: "k8s.cni.cncf.io/v1"
kind: NetworkAttachmentDefinition
metadata:
  name: macvlan-conf
spec:
  config: '{
      "cniVersion": "0.3.0",
      "type": "macvlan",
      "master": "eth0",
      "mode": "bridge",
      "ipam": {
        "type": "host-local",
        "subnet": "192.168.1.0/24",
        "rangeStart": "192.168.1.200",
        "rangeEnd": "192.168.1.216",
        "routes": [
          { "dst": "0.0.0.0/0" }
        ],
        "gateway": "192.168.1.1"
      }
    }'
EOF
```

**当然前提是 k8s 集群中已安装了 macvlan cni**

> type: This tells CNI which binary to call on disk. Each CNI plugin is a binary that's called. Typically, these binaries are stored in /opt/cni/bin on each node, and CNI executes this binary. In this case we've specified the loopback binary (which create a loopback-type network interface). **If this is your first time installing Multus, you might want to verify that the plugins that are in the "type" field are actually on disk in the /opt/cni/bin directory.**

https://kubernetes.io/docs/concepts/extend-kubernetes/compute-storage-net/network-plugins/

https://www.cni.dev/plugins/current/main/macvlan/

https://docs.docker.com/network/macvlan/

> Some applications, especially legacy applications or applications which monitor network traffic, expect to be directly connected to the physical network. In this type of situation, you can use the macvlan network driver to assign a MAC address to each container’s virtual network interface, making it appear to be a physical network interface directly connected to the physical network.

https://docs.docker.com/network/network-tutorial-macvlan/
