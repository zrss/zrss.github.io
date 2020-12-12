---
title: finally storage driver in docker
abbrlink: 9df565e8
date: 2018-11-18 11:43:37
tags: docker
---

> 当然有点儿标题党的意思

学习到这呢，已经大概有点儿感觉了

# union fs

docker container 的 root fs，本质上呢都叫 ufs 技术，union file system

docker 用它来干啥的，镜像不是分层的嘛，docker 用这玩意儿技术来把所有层 union 成一个单一的 fs，给用户使用

这就是 docker container root fs 的基础了

问题就来了，现在不依赖 dockerd 咋 union file system，于是乎在 google 中搜索了下 union file system impl in golang，发现了个项目，还挺有意思

https://github.com/spf13/afero

readme 中提到它可以干

* Support for compositional (union) file systems by combining multiple file systems acting as one

看看能不能用吧

显然不能 … 粗略一扫，就是一些 os api 封装，文档也不友好 sigh

# still docker pull

docker pull 的大概过程，pull 镜像，随后使用 graph driver union mount，最后把 image 注册到 layer store

怎么看的，在 daemon/graphdriver/aufs 往上搜就行，最后发现 docker pull 也用了它

所以回答上篇的问题 扫描镜像时，为何不把 layer union 之后，再扫描，看到这，诸位可能已经发现不好实现呀

能不能实现，当然能！

1. 按照这里所说 loading-an-image-filesystem-changeset
    1.1 untar root layer to a dir (act as container root fs)
    1.2 untar each layer to the previous dir, and walk once, rm any file with .wh. prefix and its coresponding file
    1.3 continue this process
    1.4 … pay attention, 可能有童鞋会觉得这个细节可能因 storage driver 而异，实则不然，image tar archive 的格式是独立于 storage driver 的
2. 熟悉 docker layer 代码的老铁，没准能把这部分代码给整出个独立的 lib 来，实现把 image layer union mount 之后，给扫描程序一个统一的 fs view, 但是显然它依赖于 storage driver 的能力，你要想在容器里面干这个事情，我就 🙄 了。要是非得在容器里这么折腾，不如直接挂 docker socket 到容器里，用宿主机的 dockerd 直接搞来的快些，废这大劲儿 sucks

> https://docs.docker.com/storage/storagedriver/
Storage drivers allow you to create data in the writable layer of your container. The files won’t be persisted after the container is deleted, and both read and write speeds are low.

也是够精辟

不过我还是有个疑问，不同 storage driver 实现分层镜像的细节不同，docker save 的时候，是怎么把不同 storage driver 的 layer 能统一到 Image Tar File Archive 里面去的

手头上没有试验 devicemapper 的机器，按说 divicemapper 实现分层镜像用的是 snapshot 技术，所以删除文件的时候，当前 layer 并不会有 .wh. 文件才对

这么说来，似乎是 layer diff 是 docker 自己算出来的了，删除的文件，给标记上 .wh. ?

whatever it needs time to cover it

https://learn-docker-the-hard-way.readthedocs.io/zh_CN/latest/

最后的时候，发现 google 又为世界造轮子了

https://github.com/GoogleContainerTools/container-diff

行吧，google 大佬已经做了，而且的确有 lib，效果好不好那就再说了，这个库基本上实现了 fundamental 的 loading-an-image-filesystem-changeset 描述的过程

当然因为是 file diff，所以权限恢复不出来的
