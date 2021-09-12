---
title: resource limit in k8s
tags:
  - k8s
abbrlink: 6555f3f9
---

# Docker Resource Limit

## CPU

https://docs.docker.com/config/containers/resource_constraints/#cpu

* `--cpu-period`: CFS 调度算法中的 cpu 时间分片，默认为 100ms
* `--cpu-quota`: CFS quota，在每个 cpu period 分片中，在 cpu 限流前，docker container 能使用的 cpu 时间
* `--cpuset-cpus`: docker container binding to cpu core
* `--cpu-shares`: Set this flag to a value greater or less than the default of 1024 to increase or reduce the container’s weight, and give it access to a greater or lesser proportion of the host machine’s CPU cycles. This is only enforced when CPU cycles are constrained. When plenty of CPU cycles are available, all containers use as much CPU as they need. In that way, this is a **soft limit**.

## Memory

https://docs.docker.com/config/containers/resource_constraints/#limit-a-containers-access-to-memory

* `--memory`: The maximum amount of memory the container can use (cgroup limit)
* `--memory-swap`:
* `--oom-kill-disable`:

针对 OOM 补充说明如下

1. 容器内进程使用 memory 超过限制，kernel 会触发 oom killer (cgroup)，kill oom_score 高分进程
2. 容器只要 1 pid 进程未退出，则容器不会退出

OOM 始终针对的是进程，而非容器

## Docker Container OOMKilled status

1. https://stackoverflow.com/questions/48618431/what-does-oom-kill-disable-do-for-a-docker-container
2. https://github.com/moby/moby/issues/14440#issuecomment-119243820
3. https://plumbr.io/blog/java/oomkillers-in-docker-are-more-complex-than-you-thought
4. https://zhimin-wen.medium.com/memory-limit-of-pod-and-oom-killer-891ee1f1cad8
5. https://faun.pub/understanding-docker-container-memory-limit-behavior-41add155236c
6. https://github.com/moby/moby/issues/15621#issuecomment-181418985
7. https://draveness.me/docker/
8. https://github.com/moby/moby/issues/38352#issuecomment-446329512
9. https://github.com/containerd/cgroups/issues/74
10. https://github.com/kubernetes/kubernetes/issues/78973
11. https://github.com/kubernetes/kubernetes/issues/50632

容器内的子进程发生了 oom killed，在 docker container 退出时也会被设置 OOMKilled 标志；参考该 issue

https://github.com/moby/moby/issues/15621#issuecomment-181418985

在 docker container 未退出时会设置 container event

https://docs.docker.com/engine/reference/commandline/events/

docker container 设置 OOMKilled 原理，参考该 issue

https://github.com/moby/moby/issues/38352#issuecomment-446329512

在实现上

1. containerd 监听了一系列事件，假若获取到 cgroup oom event 则记录 OOMKilled = true
2. containerd 将处理后的事件发送至 dockerd 进一步处理
3. dockerd 在处理 OOM 事件时，记录 container oom 事件
4. dockerd 在处理 Exit 事件时，将 OOMKilled = true 其写入容器的 status

# K8S Resource Limit

https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/#how-pods-with-resource-limits-are-run

## CPU (Docker Container config)

> CPU is always requested as an absolute quantity, never as a relative quantity; 0.1 is the same amount of CPU on a single-core, dual-core, or 48-core machine.

* `--cpu-shares`: max({requests.cpu} * 1024, 2)

例如 requests 为 180，则 `--cpu-shares=184320`

* `--cpu-period`: 100

* `--cpu-quota`: limits.cpu * 100

> https://stackoverflow.com/a/63352630
>
>  The resulting value is the total amount of CPU time in microseconds that a container can use every **100ms**. A container cannot use more than its share of CPU time during this interval.
>
> The default quota period is 100ms. The minimum resolution of CPU quota is 1ms.

cpu 时间分片为 period，quota 为实际每个 period 周期中，可使用的 cpu time；假若受到 qutoa 限制的 cpu 任务，在当前 period 的 quota 仍未完成，则当前任务挂起，等待下个 period 继续执行

multi cpu 机器注意 quota 可以是 period 的倍数，例如限制 container 使用 0.5 cpu，则 `--cpu-quota=50`，假若主机有 20 cpu，限制 container 使用 10 cpu，则 `--cpu-quota=10*100=1000`

## Memory (Docker Container config)

* `--memory`: int({limits.memory})
* `--memory-swap`: int({limits.memory})

the container does not have access to swap

## K8s OOM Watcher

https://github.com/kubernetes/kubernetes/blob/v1.22.1/pkg/kubelet/oom/oom_watcher_linux.go

* /dev/kmsg

> Start watches for system oom's and records an event for every system oom encountered.

当前 kubelet 观测到发生 system oom 时（非 cgroup oom），生成 event；如下 PR 尝试将进程 oom 关联至 pod，未合入

https://github.com/kubernetes/kubernetes/issues/100483

https://github.com/kubernetes/kubernetes/pull/100487
