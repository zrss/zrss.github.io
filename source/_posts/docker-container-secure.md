---
title: Docker container secure
tags:
  - docker
categories: 笔记
abbrlink: 85943db7
---

# docker security

https://docs.docker.com/engine/security/

docker security 总的来说，一个是使用了 `kernel namespace` 技术，为每个 container 创建了 `process`, `network` 等 namepsace，使得多个 container 不会有很大的相互影响

另外一个方面是使用了 `control groups` 技术，用于限制 container 所使用的各类资源

> ensure that each container gets its fair share of memory, CPU, disk I/O

简单理解，比如 cpu 资源，`cgroup` 用于避免某个 container 不当使用（或者恶意 or 无意代码 bug）cpu，导致其他 container 没法正常使用 cpu 的场景

# container root user

https://docs.docker.com/engine/security/userns-remap/

container 中不建议使用 `root` 用户执行进程，很大部分原因因为容器内的 uid gid 会映射到 host 上，举个例子，一旦容器内的进程逃逸到 host 上，那么它也有 `root` 用户的权限

> 虽然说容器内的进程逃逸，是很严重的安全问题，docker 社区会第一时间修复
