---
title: horovod-tf
abbrlink: 9ca10b5e
date: 2019-05-19 10:44:40
tags: hpc
---

> 0.16.2

horovod 启动流程

hvd.init() 发生了什么

HorovodBasics -> init -> horovod_init -> InitializeHorovodOnce

启动线程

BackgroundThreadLoop

MPI 初始化

MPI_Comm_dup

MPI_Comm_rank 获取当前进程的 RANK

MPI_Comm_size 获取 local size

两次 AllGather, 把 rank 与 size 分发到所有进程

检查是否同构，即 size 是否相同

rank 0 初始化 MessageTable

initialization_done = true 初始化结束

主线程等待

initialization_done = true

背景线程持续 RunLoopOnce

```c++
while (RunLoopOnce(state, is_coordinator));
```

从 message_queue 中获取数据

DistributedOptimizer