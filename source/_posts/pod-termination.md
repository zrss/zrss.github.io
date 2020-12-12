---
title: pod termination
abbrlink: 5285fc6a
date: 2020-08-23 14:16:34
tags:
    - k8s
---

> https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#pod-termination

简而言之，pod 被删除时

1. kubelet 触发 container runtime 对 pod 中的每个 container 的 1 号进程，发送 TERM 信号
1. 等待 the grace period expires (terminationGracePeriodSeconds 默认为 30s)
1. 如果 the grace period expires 后 containers 仍未退出，则 kubelet 触发 container runtime，向 pod 中的每个 container 中仍然处于 running 状态的进程发送 KILL 信号

正确处理 TERM 信号，可以让业务优雅退出（or 更快退出）；例如

假设 pod command 为

> https://kubernetes.io/docs/tasks/inject-data-application/define-command-argument-container/#run-a-command-in-a-shell

```yaml
command: ["/bin/bash"]
args: ["-c", "/home/rt/run.sh"]
```

or

```yaml
command:
- "/bin/bash"
- "-c"
- "/home/rt/run.sh"
```

> `/bin/bash /home/rt/run.sh` 是 1 号进程

在 /home/rt/run.sh 中可以如此处理，以达到优雅退出的目的

```bash
function prog_exit {
    echo "receive SIGTERM signal"
    pkill python
}

trap prog_exit SIGTERM

# main function
python /home/rt/train.py &

wait $!
```

ref: docker stop

> https://docs.docker.com/engine/reference/commandline/stop/
>
> The main process inside the container will receive SIGTERM, and after a grace period, SIGKILL.
