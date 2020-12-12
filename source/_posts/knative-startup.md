---
title: knative startup
abbrlink: bed8f754
date: 2018-09-01 14:26:45
tags:
    - k8s
    - go
---

也许 kubernetes 对于开发者来说仍然过于复杂，另外现实系统中，又对服务发布后的流量管理有诸多需求

Knative 的出现，似乎是要真正实现 PAAS on the kubernetes

开发者仅需要关心如何编写代码 (write code) ，其他的所有，交给 Knative 吧（Maybe）

[One Platform for Your Functions, Applications, and Containers (Cloud Next ‘18)](https://www.youtube.com/watch?v=F4_2gxTtLaQ&t=849s)

# Knative serving

## controller

* revision
* configuration
* services
* routes

抽象了一套统一的框架去实现四个 controller，不过当前命名的不是很理想，虽然都在 controller package 下面，然而文件名仅为 revision.go … 不如 kubernetes 的 job_controller.go 来的直接，也便于搜索

controller 的主要方法均为 Reconsile，即从 kube-apiserver list-watch CRD 的增量更新后，调用 Reconsile 执行相应操作，使得最终状态与用户期望的一致

提到 list-watch 而又不能不提到 kubernetes 中的杰出 api sdk 实现——informer

基于已日渐稳定的 kubernetes，knative 目前实现的简洁直接

```go
ctrlr.Run(threadsPerController, stopCh)
```

每个 controller 启动 2 (threadsPerController) 个 goroutine 处理 list-watch 获得的 CRD 更新信息

```go
for i := 0; i < threadiness; i++ {
    go wait.Until(func() {
        for c.processNextWorkItem(syncHandler) {
        }
    }, time.Second, stopCh)
}
```

syncHandler 由各个不同的 controller 传入

下面简单分析 knative serving 模块的几个 controller

### services

根据 knative 的 simple demo app，开始的时候，我们需要使用 yaml 创建一个 service，这是所有 knative 奇妙之旅的开端 getting-started-knative-app

```yaml
apiVersion: serving.knative.dev/v1alpha1 # Current version of Knative
kind: Service
metadata:
  name: helloworld-go # The name of the app
  namespace: default # The namespace the app will use
spec:
  runLatest:
    configuration:
      revisionTemplate:
        spec:
          container:
            image: gcr.io/knative-samples/helloworld-go # The URL to the image of the app
            env:
            - name: TARGET # The environment variable printed out by the sample app
              value: "Go Sample v1"
```

services 的 reconcile 首先会查询

service 对应的 configuration (its name is the same with service-name) 是否存在

* 不存在，创建之
* 存在，reconcile 之

service 对应的 routes (its name is the same with service-name) 是否存在

* 不存在，创建之
* 存在，reconcile 之

### configuration

获取对应的 rev

[config-name]-[config.spec.Generation]: helloworld-go-00001

* 不存在，创建之

随后更新 configuration 的 status

所以可以看到在 configuration 中其实实现了 app 的多版本管理，每次 configuration 的修改（Generation + 1）均会生成一个新的 revision

### revision

revision 关注下述几种资源，在下述资源有变化时，将变化加入 queue 中，等待 revision 2 个 goroutine 处理之

* revisionInformer
* deploymentInformer

暂时仅关注 revisionInformer，endpointsInformer 及 deploymentInformer

revision controller 获取到 revision 之后

若未找到其对应的 deployment

[rev-name]-deployment

将其 revision 的 status 更新为

* ResourcesAvailable [status: Unknown, reason: Deploying]
* ContainerHealthy [status: Unknown, reason: Deploying]
* Ready [status: Unknown, reason: Deploying]

并调用 kube-apiserver api 创建 deployment

注意到在创建 deployment 时，revision controller 需要连接至该 deployment 的镜像仓库，获取其 digest，因此如果 revision controller 所在节点的网络受限的话，revision 的 status 可能会提示如下信息

```yaml
status:
  conditions:
  - lastTransitionTime: 2018-08-29T19:03:43Z
    reason: Deploying
    status: Unknown
    type: ResourcesAvailable
  - lastTransitionTime: 2018-08-29T19:04:13Z
    message: 'Get https://gcr.io/v2/: dial tcp: i/o timeout'
    reason: ContainerMissing
    status: "False"
    type: ContainerHealthy
  - lastTransitionTime: 2018-08-29T19:04:13Z
    message: 'Get https://gcr.io/v2/: dial tcp: i/o timeout'
    reason: ContainerMissing
    status: "False"
    type: Ready
```

即连接镜像仓库（如示例中的连接 gcr.io 超时），导致 revision notReady，正常工作的 revision 状态如下

```yaml
status:
  conditions:
  - lastTransitionTime: 2018-08-30T09:36:46Z
    status: "True"
    type: ResourcesAvailable
  - lastTransitionTime: 2018-08-30T09:36:46Z
    status: "True"
    type: ContainerHealthy
  - lastTransitionTime: 2018-08-30T09:36:46Z
    status: "True"
    type: Ready
```

非 active 的 revision 状态如下

```yaml
status:
  conditions:
  - lastTransitionTime: 2018-08-30T09:09:18Z
    reason: Updating
    status: Unknown
    type: ResourcesAvailable
  - lastTransitionTime: 2018-08-30T09:09:18Z
    reason: Updating
    status: Unknown
    type: ContainerHealthy
  - lastTransitionTime: 2018-08-30T09:09:18Z
    reason: Inactive
    status: "False"
    type: Ready
```

若找到其对应的 deployment

则根据 rev 的状态，决定 deployment replica 的数量

* rev.spec.servingState 状态为 Active，且 deployment replica = 0 时，需将其调整为 1
* rev.spec.servingState 状态为 Reserve，且 deployment replica != 0 时，需将其调整为 0

如果期望的 deployment replica 与实际的 replica 相同，那么将 rev 的 status 更新为

* ResourcesAvailable [status: Unknown, reason: Updating]
* ContainerHealthy [status: Unknown, reason: Updating]
* Ready [status: Unknown, reason: Updating]

如果不相同，调用 kube-apiserver api 更新 deployment

### routes

routes 获取其对应的 kubernetes svc

[route-name] 例如 helloworld-go

* 不存在，创建之
* 否则，更新之

随后通过 istio CRD Istio VirtualService 配置流量

* 不存在，创建之
* 否则，更新之

# Summary

controller of serving

* services controller
* configuration controller
* routes controller
* revision controller

数据源均来自 list-watch 相应的 CRD，实现相应的 reconcile 方法

services controller 负责创建 configuration 和 routes 资源

configuration controller 负责创建 revision 资源

routes controller 负责创建 Istio VirtualService 资源

# Issues

Knative 还处于较为年轻的阶段，花了两天时间最后成功在内网环境上成功运行了其 simple demo app。目前在需要使用 proxy 访问公网网络的情况下，如何配置 knative，其文档中还没有相关的说明

目前为止尝试 knative 的一些 debug 经历，可参看下述 issues

[Knative http proxy sample](https://github.com/knative/docs/issues/365)

[istio-statsd-prom-bridge pod crash due to unknown short flag](https://github.com/knative/serving/issues/1954)

[Configuration is waiting for a Revision to become ready](https://github.com/knative/serving/issues/1971)

to be cont …
