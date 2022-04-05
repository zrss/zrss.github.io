---
title: gpu device plugin
tags:
  - k8s
  - gpu
abbrlink: 926bc5d1
date: 2022-04-05 10:06:00
---

# device plugin init and list-watch

## init

device plugin 启动时

```golang
func (m *NvidiaDevicePlugin) initialize() {
	m.cachedDevices = m.Devices()
	m.server = grpc.NewServer([]grpc.ServerOption{}...)
	m.health = make(chan *Device)
	m.stop = make(chan interface{})
}
```

调用 `m.Devices()` 获取当前节点上的 gpu 设备列表信息

## list-watch

返回 gpu 设备详情，注意到不健康的设备 `health` 字段会被设置 `Unhealthy` 值

```golang
	for {
		select {
		case <-m.stop:
			return nil
		case d := <-m.health:
			// FIXME: there is no way to recover from the Unhealthy state.
			d.Health = pluginapi.Unhealthy
			log.Printf("'%s' device marked unhealthy: %s", m.resourceName, d.ID)
			s.Send(&pluginapi.ListAndWatchResponse{Devices: m.apiDevices()})
		}
	}
```

# device plugin health check

health 检测的实现也比较直接

```golang
	go m.CheckHealth(m.stop, m.cachedDevices, m.health)
```

使用 `nvml` go lib API 将已发现的每个设备注册到 `eventSet`，假若不支持该 API 的设备，则直接标记为 `Unhealthy`

注册 ok 后，开启 for loop 等待 event

```golang
	// http://docs.nvidia.com/deploy/xid-errors/index.html#topic_4
	// Application errors: the GPU should still be healthy
	applicationErrorXids := []uint64{
		13, // Graphics Engine Exception
		31, // GPU memory page fault
		43, // GPU stopped processing
		45, // Preemptive cleanup, due to previous errors
		68, // Video processor exception
	}

	skippedXids := make(map[uint64]bool)
	for _, id := range applicationErrorXids {
		skippedXids[id] = true
	}

	for {
		select {
		case <-stop:
			return
		default:
		}

		e, err := nvml.WaitForEvent(eventSet, 5000)
		if err != nil && e.Etype != nvml.XidCriticalError {
			continue
		}

		if skippedXids[e.Edata] {
			continue
		}

		if e.UUID == nil || len(*e.UUID) == 0 {
			// All devices are unhealthy
			log.Printf("XidCriticalError: Xid=%d, All devices will go unhealthy.", e.Edata)
			for _, d := range devices {
				unhealthy <- d
			}
			continue
		}

		for _, d := range devices {
			// Please see https://github.com/NVIDIA/gpu-monitoring-tools/blob/148415f505c96052cb3b7fdf443b34ac853139ec/bindings/go/nvml/nvml.h#L1424
			// for the rationale why gi and ci can be set as such when the UUID is a full GPU UUID and not a MIG device UUID.
			gpu, gi, ci, err := nvml.ParseMigDeviceUUID(d.ID)
			if err != nil {
				gpu = d.ID
				gi = 0xFFFFFFFF
				ci = 0xFFFFFFFF
			}

			if gpu == *e.UUID && gi == *e.GpuInstanceId && ci == *e.ComputeInstanceId {
				log.Printf("XidCriticalError: Xid=%d on Device=%s, the device will go unhealthy.", e.Edata, d.ID)
				unhealthy <- d
			}
		}
	}
```

注意到 gpu device plugin 会忽略特定 `Xid`，因为这些 `Xid` 明确不是硬件故障

# NVIDIA Health & Diagnostic

https://docs.nvidia.com/deploy/index.html

## xid

https://docs.nvidia.com/deploy/xid-errors/index.html#topic_4

> The Xid message is an error report from the NVIDIA driver that is printed to the operating system's kernel log or event log. Xid messages indicate that a general GPU error occurred, most often due to the driver programming the GPU incorrectly or to corruption of the commands sent to the GPU. The messages can be indicative of a hardware problem, an NVIDIA software problem, or a user application problem.
>
> Under Linux, the Xid error messages are placed in the location /var/log/messages. Grep for "NVRM: Xid" to find all the Xid messages.

## NVVS (NVIDIA Validation Suite)

https://docs.nvidia.com/deploy/nvvs-user-guide/index.html

> Easily integrate into Cluster Scheduler and Cluster Management applications

# k8s device

```golang
type ListAndWatchResponse struct {
	Devices              []*Device `protobuf:"bytes,1,rep,name=devices,...`

    ...
}

// E.g:
// struct Device {
//    ID: "GPU-fef8089b-4820-abfc-e83e-94318197576e",
//    Health: "Healthy",
//    Topology:
//      Node:
//        ID: 1
```

结合 Health 信息，k8s 调度器就可以忽略 `UnHealthy` 的 GPU 设备了
