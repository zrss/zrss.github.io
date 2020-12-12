---
title: docker load tar archive
abbrlink: 9d1faa5
date: 2018-11-17 13:58:45
tags: docker
---

> 在上一遍文章中我们 get 到了 crane pull 的过程，然而好奇的我仍然有个疑问，那就是 tar archive 中并未定义了 layer 的 stack 关系，如此 docker load 如何能正确组织 image 的 fs changeset 呢 ？

docker load

https://docs.docker.com/engine/reference/commandline/load/

docker (moby)

https://github.com/moby/moby

Layer 是如何串联起来的

https://www.hi-linux.com/posts/44544.html

# Study

按说理论上每层，应有镜像层 id，并且有指向 parent layer 的指针，当然基础镜像没有 parent layer

否则无法将 layer 组织起来

既然如此那在 image tar archive 中，是如何体现这种 layer stack 关系的 ?

docker save

```
.
├── 2daafd635a629218204652bd3b10ddd23ae5e33abe1ebc3c26c01103e33369de
│   ├── VERSION
│   ├── json
│   └── layer.tar
├── 9fbc75679caed833594370d2effbdbba4e09eb6ee7a87f9d2e94b41627d56831
│   ├── VERSION
│   ├── json
│   └── layer.tar
├── e81eb098537d6c4a75438eacc6a2ed94af74ca168076f719f3a0558bd24d646a.json
├── ecfed8505473c79ab6831d6272a1adff68a42cd102e9992e60b2f8925df01927
│   ├── VERSION
│   ├── json
│   └── layer.tar
├── manifest.json
└── repositories
3 directories, 12 files
```

可见 docker save 时会将 layer 的 metadata 文件输出，查看 json 文件后发现其的确有 parent 的定义

```
{
    "id": "2daafd635a629218204652bd3b10ddd23ae5e33abe1ebc3c26c01103e33369de",
    "parent": "9fbc75679caed833594370d2effbdbba4e09eb6ee7a87f9d2e94b41627d56831",
    "created": "2018-11-16T13:32:10.147294787Z"
}
```

我还做了个实验，将每层的 json, VERSION 及 repositories 文件删除，检查是否仍然能继续 docker load，呃当然是肯定的

```
.
├── 2daafd635a629218204652bd3b10ddd23ae5e33abe1ebc3c26c01103e33369de
│   └── layer.tar --- Layer File
├── 9fbc75679caed833594370d2effbdbba4e09eb6ee7a87f9d2e94b41627d56831
│   └── layer.tar --- Layer File
├── e81eb098537d6c4a75438eacc6a2ed94af74ca168076f719f3a0558bd24d646a.json --- Config file
├── ecfed8505473c79ab6831d6272a1adff68a42cd102e9992e60b2f8925df01927
│   └── layer.tar --- Layer File
└── manifest.json --- Image Tar Archive Description
3 directories, 5 files
```

docker load 一把

```
tar -cf nginx-new.tar *
> docker load -i nginx-new.tar
ef68f6734aa4: Loading layer [==================================================>]  58.44MB/58.44MB
876456b96423: Loading layer [==================================================>]  54.38MB/54.38MB
9a8f339aeebe: Loading layer [==================================================>]  3.584kB/3.584kB
Loaded image: nginx:latest
```

docker load 各 layer, 其中左侧的 hex 值为 layer sha256 hash value

可见的确未受影响，所以 docker load 并未依赖 docker save 时保留的 layer metadata 信息

```
"os": "linux",
"rootfs": {
    "type": "layers",
    "diff_ids": [
        "sha256:ef68f6734aa485edf13a8509fe60e4272428deaf63f446a441b79d47fc5d17d3",
        "sha256:876456b964239fb297770341ec7e4c2630e42b64b7bbad5112becb1bd2c72795",
        "sha256:9a8f339aeebe1e8bcef322376e1274360653fb802abd4b94c69ea45a54f71a2b"
    ]
}
```

另外对于镜像 Config file 中说明的 rootfs.diff_ids, 其中的 sha256 hash 值均为各 layer 的 sha256 hash 值

```
ef68f6734aa485edf13a8509fe60e4272428deaf63f446a441b79d47fc5d17d3  ecfed8505473c79ab6831d6272a1adff68a42cd102e9992e60b2f8925df01927/layer.tar
876456b964239fb297770341ec7e4c2630e42b64b7bbad5112becb1bd2c72795  9fbc75679caed833594370d2effbdbba4e09eb6ee7a87f9d2e94b41627d56831/layer.tar
9a8f339aeebe1e8bcef322376e1274360653fb802abd4b94c69ea45a54f71a2b  2daafd635a629218204652bd3b10ddd23ae5e33abe1ebc3c26c01103e33369de/layer.tar
```

https://www.huweihuang.com/article/docker/docker-commands-principle/

> 如果你要持久化一个镜像，可以使用 docker save 指令
> 它与 docker export 的区别在于其保留了所有元数据和历史层
> 另外 docker export 用于容器，而不是镜像

docker inspect 用于查看镜像最顶层的 metadata

docker images -a 该指令用作列出镜像的所有镜像层。镜像层的排序以每个顶层镜像 ID 为首，依次列出每个镜像下的所有镜像层

docker history 查看该镜像 ID 下的所有历史镜像

# Summary

对比发现，其实在 Image Tar Archive 中，layer 的 parent-child 关系实际上就是定义于镜像 Config file 中的 rootfs.diff_ids 顺序

[0] <- [1] <- [2] <- …

以 nginx:latest 为例

1. ef68f6734aa485edf13a8509fe60e4272428deaf63f446a441b79d47fc5d17d3 (base layer)
1. 876456b964239fb297770341ec7e4c2630e42b64b7bbad5112becb1bd2c72795
1. 9a8f339aeebe1e8bcef322376e1274360653fb802abd4b94c69ea45a54f71a2b
1. …

这下就恍然大悟了
