---
title: clusterd
date: 2025-06-01 19:30:00
---

https://www.hiascend.com/document/detail/zh/mindcluster/70rc1/clustersched/dlug/mxdlug_007.html

有如下几类 configmap
* cmDevice: ns, kube-system; cmName, mindx-dl-deviceinfo-{NodeName}; which is reported by device-plugin
* cmNode: ns, mindx-dl; cmName, mindx-dl-nodeinfo-{NodeName}; which is reported by nodeD
* cmPingMesh: ns, cluster-system; cmName, pingmesh-config;
* cmSuperPodDevice: ns, cluster-system; cmName, super-pod-{SuperPodId}; clusterD 维护
    * 特别的 {RAS_NET_ROOT_PATH}/cluster/super-pod-{SuperPodId}/super-pod-{SuperPodId}.json; clusterD 维护
* cmPubicFault: mc-consumer-publicfault=true label;

其中 cmDevice configmap mindx-dl-deviceinfo-{NodeName}, 由 device-plugin 上报, 包括如下信息
* DeviceInfoCfg
* SwitchInfoCfg

cmPubicFault configmap, 包括如下信息
* PublicFault

pingmesh-config 的格式为 global pingmesh 任务的配置或者是指定 superpodid 的任务配置

```json
{
    "activate": "on",
    "task_interval": 5
}
```

node annotation 中包括如下信息
* product-serial-number
* superPodID
* baseDeviceInfos
* serverType
* serverIndex