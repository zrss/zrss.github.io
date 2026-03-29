---
title: nccl tests
abbrlink: 88d66e68
date: 2024-02-01 21:40:00
---

多节点测试依赖 mpi。编译时打开 MPI 开头。

测试时配置多节点 ssh 免密。另外如果是 RoCE 网络，注意正确配置 NCCL 无损队列匹配 RoCE 无损队列。

逐渐调大 size 衡量网络带宽情况。

https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/env.html#nccl-algo

NCCL_ALGO=ring 衡量网络带宽时较为稳定。
