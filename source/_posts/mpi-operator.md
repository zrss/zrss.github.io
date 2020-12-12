---
title: mpi operator
abbrlink: 2e8d2c8b
date: 2019-01-19 10:51:00
tags: hpc
---

1. 计算 Replica 及 Slot 数
2. 创建 ConfigMap

* hostfile

```
[mpiJobName]-worker-i slots=[8]
```

[mpiJobName]-worker-i i.e. ${POD_NAME} of statefulset’s pod

kubexec.sh

```bash
#!/bin/sh
set -x
POD_NAME=$1
shift
/opt/kube/kubectl exec ${POD_NAME} -- /bin/sh -c "$*"
```

1. 创建 Statefulset

Container Command: Sleep

2. 创建 Launcher (Job)

Statefulset ready 后，创建 Launcher (Job)

设置 env OMPI_MCA_plm_rsh_agent 为 kubexec.sh

即使用 `kubectl exec ${POD_NAME} -- /bin/sh -c "$*"` 作为 ssh_agent

[rsh-not-ssh](https://www.open-mpi.org/faq/?category=rsh#rsh-not-ssh)

所以 openmpi 是有个潜在要求的，要么是支持 IPoIB，or 要有 IP 网络，纯 IB 网络不行

当然 SDP (Socket Direct Protocol) 能加速 Socket 又是另外一个话题了

```bash
# server side
/etc/init.d/sshd stop
env LD_PRELOAD=/usr/lib64/libsdp.so
LIBSDP_CONFIG_FILE=/u/etc/libsdp.conf /etc/init.d/sshd start
# client side
LD_PRELOAD=/usr//lib64/libsdp.so
LIBSDP_CONFIG_FILE=/etc/libsdp.conf scp <file> <user>@<IPoIBaddr>:<dir>
```

Running ssh, scp over SDP

`lsmod | grep sdp`

`sdpnetstat -S`

设置 env OMPI_MCA_orte_default_hostfile 为 hostfile

Container Command: mpirun

综上，mpi-operator 使用 kube-dns 获得 pod ip，mpirun 使用 `kubectl exec` 远程登录 container
