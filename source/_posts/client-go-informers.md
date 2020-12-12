---
title: client go informers
abbrlink: 73c2c618
date: 2018-09-16 14:09:09
tags: k8s
---

占个坑，还是在 ut 的时候被坑到了，后续有时间补上，这个我认为 k8s 最成功的地方

不是容器调度，而是这套基于 etcd 抽象出来的 api 😃

* informer
* lister

这 informer 呀，其实就是提供 add/update/create 回调的封装 (所谓 informer)

而这 lister 呢，是对象 cache，从 lister 中可以获取到对象。lister 由 informer 提供。

其实还挺自然的，想想 informer 回调 add/update/create 的时候，基本思路

* list-watch kube-apiserver
* watch 到对象变化，根据 cache 计算 diff，然后相应回调 add/update/create

所以它是需要 lister 这样的 local cache 的

所以如果自己要实现一个 k8s style 的 controller，需要使用到 informer 时，首先初始化 informer，初始化 ok 之后，如果需要查对象，那可以通过 informer 的 lister 来获取