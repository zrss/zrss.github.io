---
title: GPUDirect RDMA
tags:
  - Infiniband
  - GPU
categories: 笔记
abbrlink: ec17aa10
---

# 环境信息

* Kernel: 3.10.0-514.44.5.10.h254.x86_64 (`uname -r`)
* Nvidia Driver: 440.33.01 (`nvidia-smi`)
* MLNX OFED: 4.3-1.0.1.0 (`ofed_info`)
* Mellanox/nv_peer_memory: Tag 1.1-0

# 坑

容器化安装 NVIDIA Driver 看起来会出现 `lsmod | grep nvidia` 能找到，然而 `modinfo nvidia` 会提示找不到 Module 的错误

需要修改 `nv_peer_memory` 代码库的构建脚本，workaround 上述问题

# DIY nv\_peer\_memory 编译

准备空目录

```
mkdir -p /root/nv_peer_memory
cd /root/nv_peer_memory
```

## NVIDIA Driver

> https://us.download.nvidia.com/tesla/440.33.01/NVIDIA-Linux-x86_64-440.33.01.run

```
# 下载 `NVIDIA-Linux-x86_64-440.33.01.run`
curl -o NVIDIA-Linux-x86_64-440.33.01.run 'https://us.download.nvidia.com/tesla/440.33.01/NVIDIA-Linux-x86_64-440.33.01.run'

# 解压至当前目录
./NVIDIA-Linux-x86_64-440.33.01.run -x
```

## nv\_peer\_memory

> https://github.com/Mellanox/nv_peer_memory/tree/1.1-0

```
curl -o nv_peer_memory-1.1-0.tar.gz 'https://github.com/Mellanox/nv_peer_memory/archive/1.1-0.tar.gz'
tar xzf nv_peer_memory-1.1-0.tar.gz
```

## DIY 编译

```
cd nv_peer_memory-1.1-0
```

修改 `Makefile` 中的 `nv_sources` 为 NVIDIA Driver 源码位置

```
nv_sources=/root/nv_peer_memory/NVIDIA-Linux-x86_64-440.33.01/kernel
```

修改 `create_nv.symvers.sh` 中的 `nvidia_mod` 为主机上安装的 NVIDIA Driver .ko 位置，例如

```
nvidia_mod=/var/k8s/nvidia/drivers/nvidia.ko
```

## 编译

> 参考 nv_peer_memory README.md

```
./build_module.sh

rpmbuild --rebuild /tmp/nvidia_peer_memory-1.1-0.src.rpm
```

## 安装 rpm

```
rpm -ivh /root/rpmbuild/RPMS/x86_64/nvidia_peer_memory-1.1-0.x86_64.rpm
```

## 测试

```
lsmod | grep nv_peer_mem
```

`NCCL_DEBUG=INFO`，例如

> NCCL version 2.4.8+cuda10.1

```
NCCL INFO Ring 00 : 3 -> 10 [send] via NET/IB/0/GDRDMA
```

# Trick

* nvidia_peer_memory 代码中的 `create_nv.symvers.sh` 可独立执行，由于容器化安装 NVIDIA Driver 场景，`modinfo nvidia` 会报找不到 mod 的错，可找一台直接在主机侧安装了 `NVIDIA driver` 的机器，`bash -x create_nv.symvers.sh` 确认执行过程，以及相关变量取值

* 如下命令可显示 mod 对应的 ko 文件位置

```
> /sbin/modinfo -F filename -k 3.10.0-514.44.5.10.h142.x86_64 nvidia
/lib/modules/3.10.0-514.44.5.10.h142.x86_64/kernel/drivers/video/nvidia.ko
```
