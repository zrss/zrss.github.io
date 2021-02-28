---
title: PyTorch Distributed Bootstrap
tags:
  - PyTorch
abbrlink: 5a3d0ab7
date: 2021-02-13 11:36:00
---

init_process_group

store TCPStore

rank == 0 作为 TCPStore rendezvous handler 的 server

hostname

port

tcp://

rank

world_size

# TCPStore

`isServer` 为 True 时，内部启动 `TCPStoreDaemon`

`waitWorkerReady` 为 True 时，10ms 轮询一次是否获取到足够到 `workerNumber`
