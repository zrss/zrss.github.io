---
title: Job 与 CronJob
abbrlink: e0d55f2c
date: 2018-04-01 16:52:38
tags:
    - job
    - k8s
---

k8s 1.7 闲暇记录

CronJob 一直到 1.8 才开启，1.7 以下的集群需在 apiserver 的启动参数中增加变量，显示开启特定的 api 版本

k8s 中的 job 一般说来需要业务自身做到幂等，或者即使会被重复执行而不影响功能

# Job

Job 相比于 StatefulSet / Deployment 的特殊字段

* .spec.restartPolicy: 仅支持 OnFailed / Never，两种方式控制范围不同，前者当 Pod 容器失败退出时，重启容器，后者当 Pod 容器失败退出时，新建 Pod，会导致 Pod 中的所有容器重启
* .spec.completions: 完成数，即在 completion 个 pod 执行成功后，认为 Job 完成
* .spec.parallelism: 并发数，即允许同时执行的 pod 数
* .spec.activeDeadlineSeconds: Job 执行时间的上限，若超过上限时间仍未完成则 Job 状态变为 DeadlineExceeded，不会再有新的 Pod 被创建，并且已存在的 Pod 将会被删除

通过 completions 和 parallelism 的组合设置，可以达到如下几种 Job 的执行效果

* 一次性任务

completions =1 && parallelism = 1

* 固定结束次数任务

completions > 1 && parallelism = 1

* 并行任务

completions = 1 && parallelism > 1

* 自定义任务

completions >=1 && parallelism >=1

Job 的接口

```
/apis/batch/v1/namespaces/{namespace}/jobs
```

Job example yaml

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: busybox
spec:
  activeDeadlineSeconds: 100
  parallelism: 1
  completions: 1
  template:
    metadata:
      name: busybox
    spec:
      containers:
      - name: busybox
        image: busybox
        command: ["echo", "hello"]
      restartPolicy: Never
```

# CronJob

顾名思义，定时任务，支持类似 linux cron 的定时策略，定时调度 Job，可以这么理解 CronJob 控制 Job，而 Job 控制 Pod，Pod 完成具体的业务逻辑

CronJob 的特殊字段

* .spec.schedule: core of cronjob and it is like one line of a crontab (cron table) file，即定时策略配置，例如 */1 * * * *，每分钟调度一次 Job 执行
* .spec.startingDeadlineSeconds: 调度 Job 最大开始时间，如果错过任务执行，错过的工作执行将被视为是失败的任务
* .spec.concurrencyPolicy: Allow/Forbid/Replace，即允许并行执行任务，Forbid 不允许并行执行任务，Replace 取消当前执行的任务，并新建一个任务取代它；考虑任务执行时间较长，而定时间隔较短的情况下，该字段的意义明显
* .spec.suspend: 暂停调度任务，不影响已调度的任务
* .spec.successfulJobsHistoryLimit: 保留成功执行的任务记录数
* .spec.failedJobsHistoryLimit: 保留执行失败的任务记录数

注意 CronJob 在 1.7 中仍然为 Alpha 版本，接口为

```
/apis/batch/v2alpha1/namespaces/{namespace}/cronjobs
```

CronJob example yaml

```yaml
apiVersion: batch/v2alpha1
kind: CronJob
metadata:
  name: hello
spec:
  schedule: "*/1 * * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: hello
            image: busybox
            args:
            - /bin/sh
            - -c
            - date; echo Hello from the Kubernetes cluster
          restartPolicy: OnFailure
```

由 CronJob 创建的 Job，在 Job 的 metadata 字段的 ObjectReference 有所体现，会写明是由 cronJob controller 控制

# Overview

查看了 job/cronjob 的功能后，我们发现 job 适合用来执行一些初始化 / 统计数据 / 备份 / 清理工作，即那些不需要一直运行的工作，需要长期运行的工作，当然还是 Deployment/StatefulSet 更合适了
