---
title: kubelet mount gpu
tags:
  - k8s
  - device manager
abbrlink: ab861e1f
date: 2022-03-27 12:48:00
---

> 相关问题: https://github.com/kubernetes/kubernetes/issues/72486, init container 申请 devices 资源时，似乎会锁定资源，导致 container 无法申请到足够的 devices 资源
>
> 讨论目的: 探索 k8s init container 挂载 gpu 的实现逻辑
>
> k8s release-1.19 分支代码

# kubelet sync pod

pkg/kubelet/kubelet_pods.go

大致的调用顺序

1. syncPod
2. SyncPod
3. startContainer
4. generateContainerConfig
5. GenerateRunContainerOptions
6. GetResources
7. GetDeviceRunContainerOptions
8. Allocate

> // syncPod is the transaction script for the sync of a single pod.

**SyncPod**

```golang
	// Step 6: start the init container.
	if container := podContainerChanges.NextInitContainerToStart; container != nil {
		// Start the next init container.
		if err := start("init container", containerStartSpec(container)); err != nil {
			return
		}

		// Successfully started the container; clear the entry in the failure
		klog.V(4).Infof("Completed init container %q for pod %q", container.Name, format.Pod(pod))
	}

	// Step 7: start containers in podContainerChanges.ContainersToStart.
	for _, idx := range podContainerChanges.ContainersToStart {
		start("container", containerStartSpec(&pod.Spec.Containers[idx]))
	}
```

pod 状态有变化时，大致的调用顺序

1. dispatchWork
2. UpdatePod
3. managePodLoop (goroutine)

> // Creating a new pod worker either means this is a new pod, or that the kubelet just restarted.

`managePodLoop` 循环从 `podUpdates` channel 中，调用 `syncPod`

```golang
func (p *podWorkers) managePodLoop(podUpdates <-chan UpdatePodOptions) {
	var lastSyncTime time.Time
	for update := range podUpdates {
		err := func() error {
			podUID := update.Pod.UID
			// This is a blocking call that would return only if the cache
			// has an entry for the pod that is newer than minRuntimeCache
			// Time. This ensures the worker doesn't start syncing until
			// after the cache is at least newer than the finished time of
			// the previous sync.
			status, err := p.podCache.GetNewerThan(podUID, lastSyncTime)
			if err != nil {
				// This is the legacy event thrown by manage pod loop
				// all other events are now dispatched from syncPodFn
				p.recorder.Eventf(update.Pod, v1.EventTypeWarning, events.FailedSync, "error determining status: %v", err)
				return err
			}
			err = p.syncPodFn(syncPodOptions{
				mirrorPod:      update.MirrorPod,
				pod:            update.Pod,
				podStatus:      status,
				killPodOptions: update.KillPodOptions,
				updateType:     update.UpdateType,
			})
			lastSyncTime = time.Now()
			return err
		}()
		// notify the call-back function if the operation succeeded or not
		if update.OnCompleteFunc != nil {
			update.OnCompleteFunc(err)
		}
		if err != nil {
			// IMPORTANT: we do not log errors here, the syncPodFn is responsible for logging errors
			klog.Errorf("Error syncing pod %s (%q), skipping: %v", update.Pod.UID, format.Pod(update.Pod), err)
		}
		p.wrapUp(update.Pod.UID, err)
	}
}
```

综上可知，kubelet 可以并发处理多个 pod 变化事件（syncPod in goroutine），但是处理单个 pod 的不同事件时（syncPod），为串行处理

# kubelet admit pod

那么设备资源分配，如何保证不同 pod 之间无冲突呢？

kubelet 在 pod Admit 时，会调用 deviceManger Allocate api 分配设备资源

kubelet 处理 pod 新增大致顺序如下

1. syncLoopIteration
2. kubetypes.ADD
3. HandlePodAdditions
4. canAdmitPod

for loop pod canAdminPod

即 kubelet 处理 pod add 时，是没有并发的，逐一处理

resourceAllocator admit handler，注意到分配顺序为 init container, containers

```golang
func (m *resourceAllocator) Admit(attrs *lifecycle.PodAdmitAttributes) lifecycle.PodAdmitResult {
	pod := attrs.Pod

	for _, container := range append(pod.Spec.InitContainers, pod.Spec.Containers...) {
		err := m.deviceManager.Allocate(pod, &container)
		if err != nil {
			return lifecycle.PodAdmitResult{
				Message: fmt.Sprintf("Allocate failed due to %v, which is unexpected", err),
				Reason:  "UnexpectedAdmissionError",
				Admit:   false,
			}
		}

		if m.cpuManager != nil {
			err = m.cpuManager.Allocate(pod, &container)
			if err != nil {
				return lifecycle.PodAdmitResult{
					Message: fmt.Sprintf("Allocate failed due to %v, which is unexpected", err),
					Reason:  "UnexpectedAdmissionError",
					Admit:   false,
				}
			}
		}
	}

	return lifecycle.PodAdmitResult{Admit: true}
}
```

继续往下看 deviceManger Allocate

```golang
// Allocate is the call that you can use to allocate a set of devices
// from the registered device plugins.
func (m *ManagerImpl) Allocate(pod *v1.Pod, container *v1.Container) error {
	if _, ok := m.devicesToReuse[string(pod.UID)]; !ok {
		m.devicesToReuse[string(pod.UID)] = make(map[string]sets.String)
	}
	// If pod entries to m.devicesToReuse other than the current pod exist, delete them.
	for podUID := range m.devicesToReuse {
		if podUID != string(pod.UID) {
			delete(m.devicesToReuse, podUID)
		}
	}
	// Allocate resources for init containers first as we know the caller always loops
	// through init containers before looping through app containers. Should the caller
	// ever change those semantics, this logic will need to be amended.
	for _, initContainer := range pod.Spec.InitContainers {
		if container.Name == initContainer.Name {
			if err := m.allocateContainerResources(pod, container, m.devicesToReuse[string(pod.UID)]); err != nil {
				return err
			}
			m.podDevices.addContainerAllocatedResources(string(pod.UID), container.Name, m.devicesToReuse[string(pod.UID)])
			return nil
		}
	}
	if err := m.allocateContainerResources(pod, container, m.devicesToReuse[string(pod.UID)]); err != nil {
		return err
	}
	m.podDevices.removeContainerAllocatedResources(string(pod.UID), container.Name, m.devicesToReuse[string(pod.UID)])
	return nil
}
```

注意到先为 init container 分配 device 资源，且分配后的 device 资源被 `addContainerAllocatedResources` 加入到 devicesToReuse 中；假设在下一个循环，是为 container 分配资源，则会优先使用 `devicesToReuse` 去分配，分配完成后，再使用 `removeContainerAllocatedResources` 从 `devicesToReuse` 中减去已分配的 device 资源

devicesToAllocate

```golang
	// Allocates from reusableDevices list first.
	if allocateRemainingFrom(reusableDevices) {
		return allocated, nil
	}
```

# summary

> 相关问题: https://github.com/kubernetes/kubernetes/issues/72486#issuecomment-482554372

回到相关问题，从上述的分配逻辑可知，init container 申请 device，导致 container 无法继续申请 device 的 bug 已经被 fixed

从代码实现上也可知，假若如 issue 中的 pod yaml

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: busybox
spec:
  containers:
  - name: busybox
    image: busybox
    args:
    - sleep
    - "10"
    resources:
      requests:
        alpha.kubernetes.io/nvidia-gpu: 4
        cpu: "2"
        memory: 4Gi
      limits:
        alpha.kubernetes.io/nvidia-gpu: 4
        cpu: "2"
        memory: 4Gi
  initContainers:
  - name: init-myservice
    image: busybox
    command: ['sh', '-c', 'sleep 200']
    resources:
      requests:
        alpha.kubernetes.io/nvidia-gpu: 4
        cpu: "2"
        memory: 4Gi
      limits:
        alpha.kubernetes.io/nvidia-gpu: 4
        cpu: "2"
        memory: 4Gi
  restartPolicy: Never
```

从 k8s 的实现逻辑上看，init container 申请的 device，实际上会与 container 申请的 device 相同；原因如下

1. device 分配（admit）逐一 pod 进行，因此没有 pod 并发分配约束
2. pod 内部按先 init container 后 container 的顺序依次分配 device
3. init container 已分配的 device 作为 devicesToReuse
4. 在后续的 container 分配时，优先使用 devicesToReuse 分配 device

不过在 syncPod 内部也有一个 workaround 的 case

```golang
func (m *ManagerImpl) GetDeviceRunContainerOptions(pod *v1.Pod, container *v1.Container) (*DeviceRunContainerOptions, error) {

    ...

    for k := range container.Resources.Limits {
        ...

		// This is a device plugin resource yet we don't have cached
		// resource state. This is likely due to a race during node
		// restart. We re-issue allocate request to cover this race.
		if m.podDevices.containerDevices(podUID, contName, resource) == nil {
			needsReAllocate = true
		}
    }

	if needsReAllocate {
		klog.V(2).Infof("needs re-allocate device plugin resources for pod %s, container %s", podUID, container.Name)
		if err := m.Allocate(pod, container); err != nil {
			return nil, err
		}
	}
```

19/11/10 的 commit

> Checks whether we have cached runtime state before starting a container that requests any device plugin resource. If not, re-issue Allocate grpc calls. This allows us to handle the edge case that a pod got assigned to a node even before it populates its extended resource capacity.

注释说明这种情况出现在 node 重启，pod 又被分配到了一个 node 上，但是这个 node 的 extended resource capacity 又并未 polulates 的情况

回到 deviceManger Allocate 方法

```golang
// Allocate is the call that you can use to allocate a set of devices
// from the registered device plugins.
func (m *ManagerImpl) Allocate(pod *v1.Pod, container *v1.Container) error {
	if _, ok := m.devicesToReuse[string(pod.UID)]; !ok {
		m.devicesToReuse[string(pod.UID)] = make(map[string]sets.String)
	}
	// If pod entries to m.devicesToReuse other than the current pod exist, delete them.
	for podUID := range m.devicesToReuse {
		if podUID != string(pod.UID) {
			delete(m.devicesToReuse, podUID)
		}
	}

    ...
}
```

可见其中使用了 map，并不是并发安全的；因此上述 workaround 代码，假若触发条件非单一 pod 的情况下，是有并发问题的；既然提交了如此久，未被修复，那么我也认为该处 workaround 代码无多 pod 并发冲突 ... :) 当然啦，这不是乱说的，找到上边代码合入的 PR 讨论，也可以佐证是 serialized 的

https://github.com/kubernetes/kubernetes/pull/87759

https://github.com/kubernetes/kubernetes/pull/87759#pullrequestreview-364185345

其实大佬们也注意到了这个实现的诡异之处，只是 leave it behind，因为之前就有，此次重构并未修改原来的逻辑

https://github.com/kubernetes/kubernetes/pull/87759#pullrequestreview-353195106

设计思路呢，其实就是 init container 的资源，继续分配给 container

> I'd need to look closer at this, but is the idea to:
>
> 1. Unconditionally allocate CPUs to the container from the pool of available CPUs
>
> 2. Check if the container we just allocated to is an init container
>
> 3. if it IS an init container, reset the pool of available CPUs to re-include the CPUs just assigned to the init container (but **keep them assigned to the init container in the process**).
>
> 4. If it is NOT an init container, just return (leaving the CPUs removed from the pool of available CPUs).

https://github.com/kubernetes/kubernetes/pull/87759#discussion_r383888297

> This would only work if Pod admission is serialized. @derekwaynecarr can you confirm that this is the case?

总之呢，最后是确认了是 work 的
