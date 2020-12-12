---
title: kubelet workflow
abbrlink: b5fa504c
date: 2018-08-25 14:38:42
tags:
    - k8s
    - kubelet
---

kubelet 为运行在 node 上的主要组件

其一方面 list-watch kube-apiserver pod 资源的变化

另一方面调用 docker 接口获取当前实际存在的 container 来 SyncLoop (PLEG)

所以下面分两条路线来分析 kubelet 的一些细节 (仅关注 pod/container，略去其他无关资源)

# overview

* Run
    * start a goroutine, one second trigger once podKiller method
    * call kl.statusManager.Start()
    * call kl.probeManager.Start()
    * call kl.pleg.Start()
        * start a goroutine, one second trigger once relist method
    * call kubelet main loop kl.syncLoop(updates, kl)
        * syncLoopIteration

注意到 kubelet main loop 传递的 updates channel 为从 kube-apiserver list-watch 到的 pod 变化数据，当 kubelet 重启时，会收到当前 node 上的所有 pod 数据

syncLoopIteration 是 kubelet 的 main loop，其主要处理

* configCh channel: pod info with ADD / Update / Delete …, this channel’s data comes from kube-apiserver
* plegCh channel: pod life cycle generator event, such as ContainerStart / ContainerDied …, this channel’s data comes from docker
* syncCh channel: a one-second period time ticker
* livenessManager.Updates() channel
* housekeepingCh channel: a two-second period time ticker

当 kubelet 启动时指定 -v=2 的情况下

kubelet 处理 configCh 数据时，会显示如下日志

```
SyncLoop (ADD, api): podName_podNamespace(podUID),...

or 

SyncLoop (UPDATE, api): podName_podNamespace(podUID),...

and REMOVE / RECONCILE / DELETE / RESTORE type
```

具体如下

```
SyncLoop (ADD, "api"): "nginx-deployment-6c54bd5869-wppm8_default(1336f9f0-a898-11e8-b01b-000d3a362518)"
```

kubelet 处理 plegCh 数据时，会显示如下日志

```
SyncLoop (PLEG): podName_podNamespace(podUID),..., event:
```

具体如下

```
SyncLoop (PLEG): "nginx-deployment-6c54bd5869-9jsp5_default(1336d6cf-a898-11e8-b01b-000d3a362518)", event: &pleg.PodLifecycleEvent{ID:"1336d6cf-a898-11e8-b01b-000d3a362518", Type:"ContainerStarted", Data:"7e06e4ce8ab3a4a0b8bbb84f35ac8ac078bb5ec9db4ce765e35a235664cb3dd7"}
```

Data 为 ContainerID 与 docker ps 看到的相同

```
hzs@kubernetes:~/work/src/k8s.io/kubernetes$ docker ps | grep 7e06e4ce8ab3
7e06e4ce8ab3        nginx                                      "nginx -g 'daemon of…"   3 minutes ago       Up 3 minutes                            k8s_nginx_nginx-deployment-6c54bd5869-9jsp5_default_1336d6cf-a898-11e8-b01b-000d3a362518_0
```

经过上述分析，大概对 kubelet 的工作原理及数据来源有了个基本认识，下面详细看一下 kubelet 对 configCh 及 plegCh 的数据处理

# configCh

list-watch from kube-apiserver in a independant goroutine, once there is events about pods, then these pod data will be put into configCh

syncLoopIteration -> handle the pod data from list-watch from kube-apiserver pod resource -> HandlePodAdditions/… -> dispatchWork -> podWorkers.UpdatePod

UpdatePod

* 如果之前未处理该 pod，则为该 pod 创建一个大小为 1 的 UpdatePodOptions channel，并启动一个协程调用 managePodLoop(podUpdates)
* 如果处理过了，判断 isWorking
    * 若 false，则置为 true，并将 *options 置入 UpdatePodOptions channel，以供 managePodLoop 处理
    * 若 true，则进一步判断 lastUndeliveredWorkUpdate 未被记录或者 UpdateType 不等于 kubetypes.SyncPodKill，则更新 lastUndeliveredWorkUpdate 为本次 UpdatePod *options

managePodLoop -> syncPodFn -> kubelet.syncPod

# plegCh

one second trigger once time relist -> generate container event (Started/…) -> put the event into eventChannel channel

syncLoopIteration -> handle the event from eventChannel -> HandlePodSyncs -> dispatchWork -> podWorkers.UpdatePod

看到这，简单总结一下，两条更新的路，最终得到统一，即来自于 kube-apiserver pod 更新，又亦或是来自于节点上 container status 的变化 (pleg)，最终均会调用 syncPod

```
SyncLoop (ADD, "api"): "nginx-deployment-6c54bd5869-wppm8_default(1336f9f0-a898-11e8-b01b-000d3a362518)"
SyncLoop (PLEG): "nginx-deployment-6c54bd5869-9jsp5_default(1336d6cf-a898-11e8-b01b-000d3a362518)", event: &pleg.PodLifecycleEvent{ID:"1336d6cf-a898-11e8-b01b-000d3a362518", Type:"ContainerStarted", Data:"7e06e4ce8ab3a4a0b8bbb84f35ac8ac078bb5ec9db4ce765e35a235664cb3dd7"}
```

# syncPod

举几个典型的例子吧

## create a deployment with replica 1

kubelet 的响应流程

### configCh

* SyncLoop (ADD, “api”): “podName_namespace(podUID)”
* HandlePodAdditions

从 podManager 中获取已存在的 pod，并将新的 pod 添加至其中。从已存在的 pod 中过滤出 activePods，并判断新的 pod canAdmitPod。例如亲和性、反亲和性的判断

* dispatchWork

调用 podWorkers.UpdatePod

```go
kl.podWorkers.UpdatePod(&UpdatePodOptions{
    Pod:        pod,
    MirrorPod:  mirrorPod,
    UpdateType: syncType, // SyncPodCreate
    OnCompleteFunc: func(err error) {
        if err != nil {
            metrics.PodWorkerLatency.WithLabelValues(syncType.String()).Observe(metrics.SinceInMicroseconds(start))
        }
    },
})
```

* UpdatePod

```go
初始化 podUID -> UpdatePodOptions channel (1)，并启动协程执行 p.managePodLoop(podUpdates)。p.isWorking[pod.UID] 为 false，随后设置其为 true，并将 *options 置入 UpdatePodOptions channel
```

* managePodLoop

循环处理 UpdatePodOptions channel

```go
// This is a blocking call that would return only if the cache
// has an entry for the pod that is newer than minRuntimeCache
// Time. This ensures the worker doesn't start syncing until
// after the cache is at least newer than the finished time of
// the previous sync.
status, err := p.podCache.GetNewerThan(podUID, lastSyncTime)
err = p.syncPodFn(syncPodOptions{
    mirrorPod:      update.MirrorPod,
    pod:            update.Pod,
    podStatus:      status,
    killPodOptions: update.KillPodOptions,
    updateType:     update.UpdateType,
})
lastSyncTime = time.Now()
```

* syncPodFn(kubelet.syncPod)

mkdir dir

```
/var/lib/kubelet/pods/[podUID]
```

* volumeManager.WaitForAttachAndMount(pod)

获取 imagePullSecrets

```go
// Fetch the pull secrets for the pod
pullSecrets := kl.getPullSecretsForPod(pod)
```

* containerRuntime.SyncPod

```
// Call the container runtime's SyncPod callback
result := kl.containerRuntime.SyncPod(pod, apiPodStatus, podStatus, pullSecrets, kl.backOff)
```

* createPodSandBox

mkdir logs dir

```
/var/log/pods/[podUID]
```

* run init container
* run container

# pleg

relist 的时候，先从 docker 获取一把全量的 pod 数据

```
// Get all the pods.
podList, err := g.runtime.GetPods(true)
```

当前状态与之前的状态一比，生成每个 container 的 PLE (pod life cycle event)

```
SyncLoop (PLEG): "podName_Namespace(podUID)", event: &pleg.PodLifecycleEvent{ID:"podUID", Type:"ContainerStarted", Data:"ContainerID"}
```

值得注意的是 ContainerDied 就是容器退出的意思

```go
func generateEvents(podID types.UID, cid string, oldState, newState plegContainerState) []*PodLifecycleEvent {
    if newState == oldState {
        return nil
    }
    glog.V(4).Infof("GenericPLEG: %v/%v: %v -> %v", podID, cid, oldState, newState)
    switch newState {
    case plegContainerRunning:
        return []*PodLifecycleEvent{{ID: podID, Type: ContainerStarted, Data: cid}}
    case plegContainerExited:
        return []*PodLifecycleEvent{{ID: podID, Type: ContainerDied, Data: cid}}
    case plegContainerUnknown:
        return []*PodLifecycleEvent{{ID: podID, Type: ContainerChanged, Data: cid}}
    case plegContainerNonExistent:
        switch oldState {
        case plegContainerExited:
            // We already reported that the container died before.
            return []*PodLifecycleEvent{{ID: podID, Type: ContainerRemoved, Data: cid}}
        default:
            return []*PodLifecycleEvent{{ID: podID, Type: ContainerDied, Data: cid}, {ID: podID, Type: ContainerRemoved, Data: cid}}
        }
    default:
        panic(fmt.Sprintf("unrecognized container state: %v", newState))
    }
}
```

* plegCh

plegCh 有数据后，调用 HandlePodSyncs 处理之

* UpdatePod

```go
// if a request to kill a pod is pending, we do not let anything overwrite that request.
update, found := p.lastUndeliveredWorkUpdate[pod.UID]
if !found || update.UpdateType != kubetypes.SyncPodKill {
    p.lastUndeliveredWorkUpdate[pod.UID] = *options
}
```

即更新 lastUndeliveredWorkUpdate

HandlePodSyncs 执行结束之后（同步）

如果容器挂掉，则执行清理动作

```go
if e.Type == pleg.ContainerDied {
    if containerID, ok := e.Data.(string); ok {
        kl.cleanUpContainersInPod(e.ID, containerID)
    }
}
```

默认配置，只保留最新一个。若 pod 被 evicted，或者是 DeletionTimestamp != nil && notRunning(apiPodStatus.ContainerStatuses)，那么它的所有容器将会被删除

```
MaxPerPodContainerCount: 1
```
