---
title: welcome to hpc
abbrlink: e57ea50b
date: 2019-01-19 10:54:39
tags: hpc
---

最近接触了一些 HPC (高性能计算) 新玩意儿，入门首先要掌握一些基本的概念

# 术语

## MPI

Message passing interface

消息传递接口，可以理解为分布式消息传递框架

## OpenMPI

MPI 的一种开源实现

## RDMA

remote direct memory access

## Infiniband

IB

网络设备，支持 RDMA

# OpenMPI

[Terminology](https://www.open-mpi.org/faq/?category=developers#ompi-terminology)

[MCA](https://www.open-mpi.org/faq/?category=tuning#mca-def)

* framework
* components
* module

> An easy example framework to discuss is the MPI framework named “btl”, or the Byte Transfer Layer. It is used to send and receive data on different kinds of networks. Hence, Open MPI has btl components for shared memory, TCP, Infiniband, Myrinet, etc.

不同的 MCA 支持不同的参数，我们可以参考如下查询支持的 MCA 参数

[available-mca-params](https://www.open-mpi.org/faq/?category=tuning#available-mca-params)

```bash
ompi_info --param all all --level 9
# only btl
ompi_info --param btl all --level 9
# only tcp of btl
ompi_info --param btl tcp --level 9
```

可以通过 MCA 参数选择 Components

[selecting-components](https://www.open-mpi.org/faq/?category=tuning#selecting-components)

```bash
mpirun --mca btl ^tcp,openib
```

不使用 btl framework 中的 tcp component，使用其中的 openib

[mpirun](https://www.open-mpi.org/doc/v3.1/man1/mpirun.1.php)

mpirun 的常用参数

* -H: List of hosts on which to invoke processes.
* -np: Run this many copies of the program on the given nodes. This option indicates that the specified file is an executable program and not an application context. If no value is provided for the number of copies to execute (i.e., neither the “-np” nor its synonyms are provided on the command line), Open MPI will automatically execute a copy of the program on each process slot (see below for description of a “process slot”). This feature, however, can only be used in the SPMD model and will return an error (without beginning execution of the application) otherwise.
* --bind-to: Bind processes to the specified object, defaults to core. Supported options include slot, hwthread, core, l1cache, l2cache, l3cache, socket, numa, board, and none.
* -x: Export the specified environment variables to the remote nodes before executing the program. Only one environment variable can be specified per -x option. Existing environment variables can be specified or new variable names specified with corresponding values. For example: % mpirun -x DISPLAY -x OFILE=/tmp/out ... The parser for the -x option is not very sophisticated; it does not even understand quoted values. Users are advised to set variables in the environment, and then use -x to export (not define) them.
* -mca: Send arguments to various MCA modules. See the “MCA” section, below.

`--mca btl self` 的作用

[ib-btl](https://www.open-mpi.org/faq/?category=openfabrics#ib-btl)

self 用于本地进程通信 (可能使用 lo 设备，也可能不用，例如可以使用内存共享)

openmpi，假设多机同一个地址族的地址可通，如果主机上有多个网络，openmpi 参考如下链接进行网络选择

[tcp-selection](https://www.open-mpi.org/faq/?category=tcp#tcp-selection)

注意到 openmpi 会使用所见的所有网络，如果你不想其使用 ip network，你可以显式的禁用之，然而

> Note that Open MPI will still use TCP for control messages, such as data between mpirun and the MPI processes, rendezvous information during MPI_INIT, etc. To disable TCP altogether, you also need to disable the tcp component from the OOB framework.

这句话比较有意思，一般来说 mpirun 要求 node 间可以 ssh 免密登录，而 ssh 是应用层协议，依赖 TCP

openmpi 会选择最优的网络

[tcp-routability](https://www.open-mpi.org/faq/?category=tcp#tcp-routability)

[tcp-routability-1.3](https://www.open-mpi.org/faq/?category=tcp#tcp-routability-1.3)

如何查看 mpirun 连接的过程

```bash
mpirun --mca btl self,vader,tcp --mca btl_base_verbose 30 -np 2 -host NodeA,NodeB a.out
```

a.out 为可执行程序

如果有 ib 卡，tcp component 会自动下线

[tcp-auto-disable](https://www.open-mpi.org/faq/?category=tcp#tcp-auto-disable)

openmpi build default option

[default-build](https://www.open-mpi.org/faq/?category=building#default-build)

```bash
--with-openib(=DIR) and --with-openib-libdir=DIR
```
