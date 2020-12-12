---
title: Layer files Content
abbrlink: b0559197
date: 2018-11-17 11:47:49
tags: docker
---

# Creating an Image Filesystem Changeset

https://github.com/moby/moby/blob/master/image/spec/v1.md#creating-an-image-filesystem-changeset

描述了如何 Creating an Image Filesystem Changeset

每层 layers file 仅可能有如下的情况

* add
* update
* deleted

例如

```
Added:      /etc/my-app.d/default.cfg
Modified:   /bin/my-app-tools
Deleted:    /etc/my-app-config
```

对于 changeset 来说，会生成如下文件

```
/etc/my-app.d/default.cfg
/bin/my-app-tools
/etc/.wh.my-app-config
```

> .wh. i.e. without

# Loading an Image Filesystem Changeset

那么我们又如何 Loading an Image Filesystem Changeset

https://github.com/moby/moby/blob/master/image/spec/v1.md#loading-an-image-filesystem-changeset

1. 找到 the root ancestor changeset
1. 从 root ancestor changeset 开始，逐级解压 layer’s filesystem changeset archive 到目录 (将被使用来作为 the root of a container filesystem)
    1.1 每层解压之后再遍历一次目录，删除已被标记删除的目录 removing any files with the prefix .wh. and the corresponding file or directory named without this prefix

# Owner and Group

另外尝试改变文件属主

changeset 也算作文件 update

untar 的时候注意 --same-owner

这里有个新问题，就是 docker load 是如何处理 Image Filesystem Changeset 中的属主的

实际测试得需要 root 用户 `tar --same-owner -xvf` 才行, 解压出来的属主和 group 也仅为 id 值，毕竟宿主机上不一定有该 owner 和 group

```bash
ash-3.2$ ls -al
total 0
drwxr-xr-x   3 zrss  staff  102 11 17 19:24 .
drwxr-xr-x  10 zrss  staff  340 11 17 18:39 ..
drwxr-xr-x  13 101   101    442 11 17 19:25 var
```

> 101 nginx

# Permission

改变文件权限

changeset 也算作文件 update

直接解压即可，可以保留原权限

# Scan Image Tar Archive

业界做法扫描 layer，

https://docs.docker.com/ee/dtr/user/manage-images/scan-images-for-vulnerabilities/

而不是将 layer combine 成 container root fs 之后，再全文件扫描

当然可能因为是病毒扫描，这样做比较简单

话说有没有必要组成 root fs 之后再扫描呢，因为毕竟可能之前 layer 的漏洞，在下一 layer 被修复了，感觉可能是会误报的 ? 细节上不知道可以如何实现

倒是可以看下 coreos clair 是如何实现的

🙄 其实也是一样的，把 layer 解压之后，扫文件，比对数据库

# Summary

其实是有点儿疑惑的, 业界镜像扫描解决方案 (当然是针对病毒扫描) 都是直接扫描 image layer

暂未发现有按照 Loading an Image Filesystem Changeset 描述的过程那样，挂载出 container root fs 之后，再扫描的解决方案

当然描述的过程感觉其实只是好理解，实际上 dockerd 再组织镜像 root fs 时，是需要根据不同的 storage driver 的实现，调用不同的命令实现的挂载 (或者换一个说法，storage driver 本质上实现了描述的过程 …)

1) overlay2

https://terriblecode.com/blog/how-docker-images-work-union-file-systems-for-dummies/

```bash
mkdir base diff overlay workdir
sudo mount \
    -t overlay \
    -o lowerdir=base,upperdir=diff,workdir=workdir \
    overlay \
    overlay
```

这哥们没讲太细

2) aufs

https://coolshell.cn/articles/17061.html?spm=a2c4e.11153940.blogcont62949.21.53a61eearfeDBm

有文件删除的话，在可写层放个 .wh.[file-name]，文件就被隐藏了。和直接 rm 是一样的

3) devicemapper

https://coolshell.cn/articles/17200.html?spm=a2c4e.11153940.blogcont62949.22.53a61eearfeDBm

描述如何用 devicemapper 实现 layers 挂载成 union file system 的，各层可以通过 devicemapper 的 snapshot 技术实现，对用户来说就是单一的 fs
