---
title: a weired bug of job workload
tags:
  - k8s
abbrlink: '8e645281'
date: 2018-07-06 11:05:29
---

又要开始分析一个疑难杂症了

现象是 100 完成数，40 并发度的 job 无法执行结束，两个 pod 一直处于 running 状态，查看发现 container 已退出

# job-controller 的工作原理

job-controller 较为短小精悍，属于 kube-controller-manager 代码中的一部分

```go
go job.NewJobController(
    ctx.InformerFactory.Core().V1().Pods(),
    ctx.InformerFactory.Batch().V1().Jobs(),
    ctx.ClientBuilder.ClientOrDie("job-controller"),
).Run(int(ctx.Options.ConcurrentJobSyncs), ctx.Stop)
```

从启动代码中可以看出 job-controller 关注 pod 与 job 这两种资源的变化情况

* ctx.InformerFactory.Core().V1().Pods()
* ctx.InformerFactory.Batch().V1().Jobs()

```
ConcurrentJobSyncs=5
```

启动 5 个 worker goroutine

```go
for i := 0; i < workers; i++ {
    go wait.Until(jm.worker, time.Second, stopCh)
}
```

在 worker 协程中，1s 执行一次 worker 方法

worker 方法，实现从 queue 中获取待处理的对象（key），并调用 syncJob 方法处理之

* syncJob 处理成功

```go
jobInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
    AddFunc: jm.enqueueController,
    UpdateFunc: func(old, cur interface{}) {
        if job := cur.(*batch.Job); !IsJobFinished(job) {
            jm.enqueueController(job)
        }
    },
    DeleteFunc: jm.enqueueController,
})
```

```go
podInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
    AddFunc:    jm.addPod,
    UpdateFunc: jm.updatePod,
    DeleteFunc: jm.deletePod,
})
```

# kubelet

大致来看与 job-controller 的关系不大，可能还是 kubelet 的问题

我们知道 kubelet 通过 PLEG 来感知节点上 container 的状态，另外 job pod 的 restart policy 目前仅支持两种 Never / onFailure，一般来说默认选择 onFailure 比较合适

这样业务容器在正常退出后（exit 0），kubelet pleg 感知到后，再加上 onFailure 的策略，正常情况下会 killing pod，job-controller 感知到 pod 减少后，即完成数又增加了 1，即可成功结束

看下 kubelet 的代码确认逻辑

```go
// Get all the pods.
podList, err := g.runtime.GetPods(true)
ShouldContainerBeRestarted

// Check RestartPolicy for dead container
if pod.Spec.RestartPolicy == v1.RestartPolicyNever {
    glog.V(4).Infof("Already ran container %q of pod %q, do nothing", container.Name, format.Pod(pod))
    return false
}
if pod.Spec.RestartPolicy == v1.RestartPolicyOnFailure {
    // Check the exit code.
    if status.ExitCode == 0 {
        glog.V(4).Infof("Already successfully ran container %q of pod %q, do nothing", container.Name, format.Pod(pod))
        return false
    }
}
return true
```

如此情况下需要 KillPod

```go
if keepCount == 0 && len(changes.ContainersToStart) == 0 {
    changes.KillPod = true
}
```

所以正常情况下 job 控制的 pod，重启策略为 RestartPolicyOnFailure，如是正常退出的情况，则该 container 无需重启，而再加上述的判断，则当前 pod 需要被删除

调用该 killPodWithSyncResult 方法

经过如此分析，可能出现的问题原因及疑点

* 2 个 pod 处于 running 状态，而对应的 container 却没有了，尝试从 relist: g.runtime.GetPods(true) 寻找可能原因
* 使用命令行如何获取节点上的 container 容器，如果 container 正常获取，且 pod 对应的 container 已正常退出，那么为何未看到 SyncLoop(PLEG) ContainerDied 事件
* pod 状态也是持续 running，而我们知道在 syncPod 中会调用 statusManager 设置新的 pod status，如果能获取到正确的 container info，pod status 也会被正确的更新至 kube-apiserver
* 正常情况下，至多为一个 pod 保留一个 container 记录，其余均会被 clean。为何当时 docker ps -a 无一相关的 container，全都被 clear 了？那意味着 node evicted，或者是 pod 被 delete 了。evicted 的可能性较小，而 pod 被 delete 的话，除了人为，job-controller activeDeadline 超了也会设置
