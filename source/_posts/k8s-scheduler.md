---
title: k8s-scheduler
abbrlink: 893d27a1
date: 2018-05-01 16:55:48
tags:
    - scheduler
    - k8s
---

> v1.7.16

the workflow of the scheduler in kubernetes，开门见山的说，所谓云主机管理也好，网络流量管理也好，总得有个调度员，控制虚拟机实际被运行于哪台物理机中，管理网络流量的走向等等，那么今天看的 scheduler 组件即为 k8s 中的 Pod 调度器组件

概括的说，scheduler 发现有需要调度的 Pod 时，使用注册好的各种策略，进行备选节点筛选及排序，最后选出pod 应被运行于的节点，即完成了其任务

# overview of scheduler

从入口看起，so that is
plugin/pkg/scheduler/scheduler.go

```go
go wait.Until(sched.scheduleOne, 0, sched.config.StopEverything)
```

即无限执行 sched.scheduleOne，那么 sched.scheduleOne 又干了啥，主要的逻辑如下

* 获取待调度的 Pod (sched.config.NextPod())
* 获取该 Pod 被调度到的节点 (sched.schedule(pod))
* 并发 bind the pod to its host

# schedule of scheduler

plugin/pkg/scheduler/core/generic_scheduler.go

默认 schedule 的实现在 generic_scheduler.go 中，实现了调度接口方法 Schedule
Schedule 的方法又完成了下述两个过程

* predicates
* prioritizing

predicates，即强制的过滤策略，使用 predicate 过滤出符合条件的节点

prioritizing，即基于优先级的优选策略，给节点打分，选择得分高的节点

得分排序函数实现

plugin/scheduler/api/types.go

```go
func (h HostPriorityList) Less(i, j int) bool {
	if h[i].Score == h[j].Score {
		return h[i].Host < h[j].Host
	}
	return h[i].Score < h[j].Score
}
```

即 Score 升序排列，在 Score 相等时，host (节点名称) 的字典序在前的优先。得分相同的节点，有 lastNodeIndex round-robin 的方式选择节点

plugin/pkg/scheduler/core/generic_scheduler.go

```go
firstAfterMaxScore := sort.Search(len(priorityList), func(i int) bool { return priorityList[i].Score < maxScore })
g.lastNodeIndexLock.Lock()
ix := int(g.lastNodeIndex % uint64(firstAfterMaxScore))
g.lastNodeIndex++
g.lastNodeIndexLock.Unlock()
```

# F.A.Q of scheduler

* scheduler 调度的单位是？

Pod

* 什么状态的 Pod 会被调度?

待调度的 Pod 会从 podQueue 中被 pop 出，作为 NextPod() 的返回

* podQueue 什么时候添加 pod？

scheduler 的 config 中使用了 podInformer，仅关注未被 assigned 和非 Succeeded 或者 Failed 的 Pod

plugin/pkg/scheduler/factory/factory.go

```go
// unassignedNonTerminatedPod selects pods that are unassigned and non-terminal.
func unassignedNonTerminatedPod(pod *v1.Pod) bool {
	if len(pod.Spec.NodeName) != 0 {
		return false
	}
	if pod.Status.Phase == v1.PodSucceeded || pod.Status.Phase == v1.PodFailed {
		return false
	}
	return true
}
```

scheduler 为 podInformer 提供了 Pod add/update/delete 操作 podQueue 的方法，因此是在此处更新的 podQueue (add 和 update 逻辑实际相同)。另外 podQueue 内部有去重，如果是相同的 pod，则不再入队

plugin/pkg/scheduler/factory/factory.go

```go
podInformer.Informer().AddEventHandler(
		cache.FilteringResourceEventHandler{
			FilterFunc: func(obj interface{}) bool {
				...
			},
			Handler: cache.ResourceEventHandlerFuncs{
				AddFunc: func(obj interface{}) {
					c.podQueue.Add(obj);
				},
				UpdateFunc: func(oldObj, newObj interface{}) {
					c.podQueue.Update(newObj);
				},
				DeleteFunc: func(obj interface{}) {
					c.podQueue.Delete(obj);
				},
			},
		},
    )
```

注意 podInformer 还用于维护 scheduler 的 cache

> 向节点中增加 Pod

plugin/pkg/scheduler/schedulercache/cache.go

```go
func (cache *schedulerCache) addPod(pod *v1.Pod) {
	n, ok := cache.nodes[pod.Spec.NodeName]
	if !ok {
		n = NewNodeInfo()
		cache.nodes[pod.Spec.NodeName] = n
	}
	n.addPod(pod)
}
```

计算节点资源

plugin/pkg/scheduler/schedulercache/node_info.go

```go
// addPod adds pod information to this NodeInfo.
func (n *NodeInfo) addPod(pod *v1.Pod) {
	res, non0_cpu, non0_mem := calculateResource(pod)
	n.requestedResource.MilliCPU += res.MilliCPU
	n.requestedResource.Memory += res.Memory
	
	...
	// Consume ports when pods added.
	n.updateUsedPorts(pod, true)
	n.generation++
}
```

* scheduler 的 node 从哪里获取？

套路与 Pod 一致，scheduler 使用了 nodeInformer，add/update/delete 操作 node cache，于是 scheduler 可见所有可使用的 node 资源

plugin/pkg/scheduler/factory/factory.go

```go
// Only nodes in the "Ready" condition with status == "True" are schedulable
	nodeInformer.Informer().AddEventHandlerWithResyncPeriod(
		cache.ResourceEventHandlerFuncs{
			AddFunc:    c.addNodeToCache,
			UpdateFunc: c.updateNodeInCache,
			DeleteFunc: c.deleteNodeFromCache,
		},
		0,
    )
```

* scheduler 如何调度 pod 的？

1) 从 nodeList (nodeInformer 中来) 获取 nodes
2) Computing predicates
3) Prioritizing
4) Selecting host (按得分排序，相同得分的 round-robin)

* predicates 有哪些？

重要的如

PodFitsResources

计算当前 node 的资源是否能满足 Pod Request，注意 init-container 是串行运行的，因此其所需要的资源，取各个资源维度的最大值，而其他正常的 container 为并行运行的，因此其所需要的资源，取各个资源维度的总和，最后一个 pod 所需要的资源，为 init-container 的最大值与正常 container 的资源总和的较大值

plugin/pkg/scheduler/algorithm/predicates/predicates.go

```go
// Returns a *schedulercache.Resource that covers the largest width in each
// resource dimension. Because init-containers run sequentially, we collect the
// max in each dimension iteratively. In contrast, we sum the resource vectors
// for regular containers since they run simultaneously.
//
// Example:
//
// Pod:
//   InitContainers
//     IC1:
//       CPU: 2
//       Memory: 1G
//     IC2:
//       CPU: 2
//       Memory: 3G
//   Containers
//     C1:
//       CPU: 2
//       Memory: 1G
//     C2:
//       CPU: 1
//       Memory: 1G
//
// Result: CPU: 3, Memory: 3G
```

PodMatchNodeSelector

即 pod 只能被调度至 pod.Spec.NodeSelector 指定的节点上

PodFitsHost

即 pod 只能调度至 pod.Spec.NodeName 的节点上

InterPodAffinityMatches

1) 检查当前 pod 如被调度到节点上，是否会破坏当前节点上的 pod 的反亲和性

2) 检查当前 pod 如被调度到节点上，是否满足亲和性及反亲和性

CheckNodeMemoryPressurePredicate

当 pod 的 QoS 为 BestEffort 时 (即没一个 container 设置 resource request/limit 时)，需检查当前 node 是否有内存压力

CheckNodeDiskPressurePredicate

检查 node 是否有磁盘压力

等其他 predicates

* prioritizing 有哪些？

即优选策略，尽可能的将 pod 部署到不同的 zone 不同的 node，平衡 node 的资源使用等

CalculateSpreadPriority

plugin/pkg/scheduler/algorithm/priorities/selector_spreading.go

```go
// CalculateSpreadPriority spreads pods across hosts and zones, considering pods belonging to the same service or replication controller.
// When a pod is scheduled, it looks for services, RCs or RSs that match the pod, then finds existing pods that match those selectors.
// It favors nodes that have fewer existing matching pods.
```

即 soft-anti-affinity

BalancedResourceAllocationMap

平衡节点资源分配

值得注意的是 prioritizing 返回的均为 HostPriority，当前集群的所有节点会组成 HostPriorityList，可以形象的理解为，经过所有的 prioritizing 后，可以绘制出 node 的条形图，条形即为每个节点的得分，scheduler 最终会推荐得分最高的 node 给 pod

等其他 prioritizing

* binding ?

1) 调用 apiserver 接口发送 post binding 请求 sched.config.Binder.Bind(b)

2) binding 发送之后，调用 sched.config.SchedulerCache.FinishBinding(assumed)

FinishBinding 将 pod 信息附带 ttl 记入 cache，ttl 过期后，从 cache 中删除

为啥在 binding 结束后，还需要如此大费周折的维护 binding 的 ttl cache ？有什么意义呢？

当然有意义，回过开头去看，我们在探寻 podQueue 的 pod 在何处加入时，发现 scheduler 使用了 podInformer，当 podInformer 获得未被调度的 pod 时将这些 pod 加入 podQueue 等待调度

而另外一处 podInformer 则是设置已被调度的 pod 的 add/update/delete 的事件回调，用来同步 cache，若发现 assumePod 已被调度，则从 cache 中删除，又或者 assumePod 已过 ttl 被 cache 删除，则重新 cache.addPod

plugin/pkg/scheduler/factory/factory.go

```go
// scheduled pod cache
	podInformer.Informer().AddEventHandler(
		cache.FilteringResourceEventHandler{
			FilterFunc: func(obj interface{}) bool {
				...
			},
			Handler: cache.ResourceEventHandlerFuncs{
				AddFunc:    c.addPodToCache,
				UpdateFunc: c.updatePodInCache,
				DeleteFunc: c.deletePodFromCache,
			},
		},
    )
```

# that’s it

可见 scheduler 基于 informer，实时关注 pod 和 node 状态，获取到待调度的 pod 后，根据 predicate 和 prioritizing 策略，为 pod 选出合适的 node，最后并发完成 pod 和 node 的 binding，完成一次调度过程

更详细来说的话 (可能有误，欢迎大家交流斧正)

## part of kube-scheduler

当有新的 pod 创建时，the podInformer of scheduler 一方面过滤未被调度且非 Succeed/Failed 状态的 pod， 触发 add 事件，scheduler 将其加入 podQueue 中等待调度，schedulerOne 方法循环执行，每次从 podQueue 中取出一个 pod，根据 predicates / priorities 策略选出 suggested host，assume 该 pod 被调度到 suggested host 上，更新 pod.Spec.NodeName 字段 (仅为后续 addPod，并不影响实际 etcd 中的 pod 对象)，随后开始并发 (goroutine) binding，即调用 kube-apiserver api post a binding RPC，随后 finishingBinding，在 cache 中记录该 pod

cache 会定时扫描其中的 assumedPods 信息，若 pod 被 assumed 且超过了 ttl，则删除该 pod (该 pod 所占用的节点资源也被释放)

the podInformer of scheduler 另一方面过滤已被调度（pod.Spec.NodeName 非空）且非 Succeed/Failed 状态的 pod，触发 add/update/delete 事件等，观察到 assumedPod 被调度后，即从 cache 中删除该 pod

## part of kube-apiserver

kube-apiserver 在接收到创建 binding 对象请求后，执行 assignPod 方法，最后在 setPodHostAndAnnotations 方法中，将 pod.Spec.NodeName 写入 etcd 中

pkg/pod/registry/core/pod/storage/storage.go

```go
// Create ensures a pod is bound to a specific host.
func (r *BindingREST) Create(ctx genericapirequest.Context, obj runtime.Object, includeUninitialized bool) (out runtime.Object, err error) {
	binding := obj.(*api.Binding)
	// TODO: move me to a binding strategy
	if errs := validation.ValidatePodBinding(binding); len(errs) != 0 {
		return nil, errs.ToAggregate()
	}
	err = r.assignPod(ctx, binding.Name, binding.Target.Name, binding.Annotations)
	out = &metav1.Status{Status: metav1.StatusSuccess}
	return
}
```

## part of kubelet

kubelet 启动时，list-watch apiserver

pkg/kubelet/config/apiserver.go

```go
// NewSourceApiserver creates a config source that watches and pulls from the apiserver.
func NewSourceApiserver(c clientset.Interface, nodeName types.NodeName, updates chan<- interface{}) {
	lw := cache.NewListWatchFromClient(c.Core().RESTClient(), "pods", metav1.NamespaceAll, fields.OneTermEqualSelector(api.PodHostField, string(nodeName)))
	newSourceApiserverFromLW(lw, updates)
}
```

kubelet 使用 selector list-watch apiserver，这个 selector 即为 api.PodHostField=nodeName pod.Spec.NodeName=nodeName。kubelet list-watch 被调度本节点上的 pod，当触发 add/update/delete 后做相应的操作
