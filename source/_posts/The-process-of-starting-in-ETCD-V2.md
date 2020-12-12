---
title: ETCD V2 的启动过程
tags:
  - etcd-v3
categories: 笔记
abbrlink: 2658559073
date: 2017-10-03 00:00:01
---

> 简单的源码阅读
>
> 链接: https://github.com/coreos/etcd/tree/release-2.3

# Main

1. 检查运行 arch
1. parse 启动配置参数
1. 设置日志级别（参考 admin guide debug part，可以打开 debug 级别日志，亦可单独打开特定 package 的 debug 日志）
1. 声明停止通道 `var stopped <-chan struct{}`
1. 打印 etcd 版本 / GitSHA / 编译时的 Go VERSION / 运行架构信息

检查数据目录是否存在，若存在日志提示 (**只有 data-dir 存在**，就会打印如下日志)

```
the server is already initialized as member before, starting as etcd member...
```

不管数据目录存在与否，均如此启动

```go
stopped, err = startEtcd(cfg)
```

最后获取到停止信号停止

```go
// etcd process stpo
<-stoped
```

# startEtcd

首先会从 initial-cluster 中初始化 peer 信息，利用这些 peer 信息新建 peer listener，主要方法为 rafthttp.NewListener

接下来使用 listen-client-url 新建 client listener，这块直接使用 net.Listen 方法，开启 tcp 服务；然后判断系统文件描述符限制，如果 < 150，则 panic，然后限制 listener 的数量为 系统描述符限制 - 150

初始化 net.Listen 的 keepAliveListener

初始化 etcd server config

初始化 etcdserver

启动 etcdserver

---

注册操作系统终止回调函数 osutil.RegisterInterruptHandler(s.Stop)

---

使用 cors 初始化 clientHandler

使用 etcdhttp 初始化 peerHandler

goroutine 为每个 peer listener 开启 http 服务 处理请求，5 min read timeout

goroutine 为每个 client listener 开启 http 服务 处理请求，0 min read timeout // 与 golang 的一个 bug 有关

etcdhttp/peer.go

etcdhttp/client.go

其实是 http server，待阅读

---

最后，返回停止通道及错误

# etcdserver.NewServer

初始化 etcdserver

集群信息存在 /0

key 信息存在 /1

检查数据目录版本，并更新数据目录

判断以何种方式启动

**(1) !haveWAL && !cfg.NewCluster**

没有 wal 目录且 new-cluster == false，此时通过从启动参数 initial-token 及 initial-cluster 配置的集群信息来访问集群（会将自己的 peer url 排除），获取到当前存在的集群信息

校验 启动参数中配置的集群信息与获取到存在的集群信息，并为 local member 设置 id

此时成员信息从 remote peer 中获取，当前 server 的 cluster id 被设置为 remote peer 中获取到 cluster id

打印启动参数 `cfg.Print()`

启动 raftnode

```
id, n, s, w = startNode(cfg, cl, nil)
```

