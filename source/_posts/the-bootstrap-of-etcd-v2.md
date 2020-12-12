---
title: ETCD V2 的启动过程
tags:
  - etcd-v2
categories: 笔记
abbrlink: '9e766462'
date: 2017-10-03 00:00:01
---

> 简单的源码阅读
>
> 链接: https://github.com/coreos/etcd/tree/release-2.3

# Main

* 检查运行 arch
* parse 启动配置参数
* 设置日志级别（参考 `admin guide debug part`，可以打开 debug 级别日志，亦可单独打开特定 package 的 debug 日志）
* 声明停止通道 `var stopped <-chan struct{}`
* 打印 etcd 版本 / GitSHA / 编译时的 Go VERSION / 运行架构信息

检查数据目录是否存在，若存在日志提示 (只有 data-dir 存在，就会打印如下日志)

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

# etcdserver.NewServer

初始化 etcdserver

集群信息存在 /0

key 信息存在 /1

检查数据目录版本，并更新数据目录

判断以何种方式启动

(1) !haveWAL && !cfg.NewCluster

没有 wal 目录且 new-cluster == false，此时通过从启动参数 initial-token 及 initial-cluster 配置的集群信息来访问集群（会将自己的 peer url 排除），获取到当前存在的集群信息

校验 启动参数中配置的集群信息与获取到存在的集群信息，并为 local member 设置 id

此时成员信息从 remote peer 中获取，当前 server 的 cluster id 被设置为 remote peer 中获取到 cluster id

打印启动参数

```go
cfg.Print()
```

启动 raftnode

```go
id, n, s, w = startNode(cfg, cl, nil)
```

(2) !haveWAL && cfg.NewCluster

没有 wal 目录且 NewCluster == true

判断 isMemberBootstrapped，从 remote peer 中获取集群信息，如果 server id 已经存在集群中且其 client url 不为空，则表示已经被启动过了，返回错误

```
member XXX has already been bootstrapped
```

打印启动参数，并启动 raftnode

```
cfg.PrintWithInitial()
id, n, s, w = startNode(cfg, cl, cl.MemberIDs())
```

可见

* initial advertise peer url
* intial cluster

参数是用来 bootstrap 成员用的

(3) haveWAL

有 WAL 目录的情况

data-dir/member

data-dir/member/wal

data-dir/member/snap

load snapshot 文件

从 snapshot 文件中恢复

最后启动 raftNode

```go
cfg.Print()
if !cfg.ForceNewCluster {
       id, cl, n, s, w = restartNode(cfg, snapshot)
} else {
       id, cl, n, s, w = restartAsStandaloneNode(cfg, snapshot)
}
cl.SetStore(st)
cl.Recover()
```

注意备份文件恢复时，一定要使用 force-new-start 的原理就在这里了

判断完了以何种方式启动 raftnode 之后，开始初始化 EtcdServer，并且初始化 rafthttp.Transport，启动 rafthttp.Transport，将从 remote peer 获取到的 peer url 信息全部加入 tr.AddRemote，AddRemote 中会判断是否已经存在 peer 或者 remote 中，已存在则不再加入；将 cluster 中的 member 信息全部加入 tr.AddPeer

当然都是除了自己，加入之前判断了 id，如果 id == 本身则不加入

不过我还是不太明白 remote 和 peer 有啥区别，目前

得看看 remote.go 和 peer.go 都干了什么

# EtcdServer.Start

1. EtcdServer.start()
1. goroutine publish
1. goroutine purge file
1. goroutine monit file descriptor
1. goroutine monitor versions

# EtcdServer.publish

注册 server 信息到 cluster 中，并更新 server 的静态 client url

publish 的过程比较直接，调用 pb.Request 方法，将其 attributes 即 name 和 clientURLs 写入集群中

即写入 key / value 中 (v2 的存储)

key 的格式为 /0/members/id/attributes

实践中，当成员无法 publish 至集群时，一般发生的错误为超时；超时后会重试，毕竟是个 for loop，在 publish 成功或者成员停止时直接 return 结束 for loop 否则会持续 publish

# EtcdServer.purge

启了个 goroutine 删除超出 threshold 的 snap 和 wal 文件

# EtcdServer.monitorFileDescriptor

启了个 goroutine 检查系统当前使用的 fd 数量是否超过了 limit 的 80%

# EtcdServer.monitorVersions

启了个 goroutine 检查集群 version

# EtcdServer.start

设置默认 snapshotCount，初始化 done / stop 通道，打印集群版本信息，goroutine run

# EtcdServer.run

raftnode start

待阅读

# startRemote

newPeerStatus(to)

这个结构体中提供了 activate / deactivate 方法

即日志中常见的 the connection with [Member ID] became active 信息

随后初始化了 remote 结构体

remote 结构体中初始化了 pipeline

sync.waitGroup 初始化为 4

启了 4 个 goroutine 跑 handle

handle 从 msgc 通道中获取 raftpb.Message，并使用 post 方法发送出去

waitGroup 在 stop 方法内调用 wait，确保 handle goroutine 均已关闭

# startPeer

newPeerStatus(to)

初始化 peer 结构体

初始化 msgAppV2Writer: msgAppV2Writer / writer: startStreamWriter

初始化 pipeline: newPipeline / snapSender: newSnapshotSender

---

goroutine startPeer 从 recvc 通道中获取 message 交由底层 raft 处理

---

goroutine startPeer 从 propc 通道中获取 message 交由底层 raft 处理

---

初始化 p.msgAppV2Reader = startStreamReader

初始化 p.msgAppReader = startStreamReader

```
// peer is the representative of a remote raft node. Local raft node sends
// messages to the remote through peer.
// Each peer has two underlying mechanisms to send out a message: stream and
// pipeline.
// A stream is a receiver initialized long-polling connection, which
// is always open to transfer messages. Besides general stream, peer also has
// a optimized stream for sending msgApp since msgApp accounts for large part
// of all messages. Only raft leader uses the optimized stream to send msgApp
// to the remote follower node.
// A pipeline is a series of http clients that send http requests to the remote.
// It is only used when the stream has not been established.
```

peer 是 remote raft node 的代表，本地 raft node 通过 peer 发送 message 到 remote

stream and pipeline

pipeline 是一系列 http clients，用于向 remote 发送 http 请求，它只有在 stream 没有建立起来时使用

stream 是接收者 long-polling 链接，用于传递 message；另外 raft leader 使用优化过的 stream 发送 msgApp 信息

stream run 起来之后，尝试去 dial 远端，dial 未返回错误后，将 peerStatus 设置为 active，即此时日志中会打印 the connection with [Member ID] became active

dial 如果返回 errUnsupportedStreamType 亦或是 err := cr.decodeLoop(rc, t) 返回的 err 不是 EOF 或者链接被关闭，则 peerStatus 被设置为 inactive

stream 每 100 ms 会重新尝试 dial remote peer，如果出现 request sent was ignored (cluster ID mismatch: remote[remote member id]=X-Etcd-Cluster-ID in http header, local=local cluster id) 错误的话，那么这个错误日志的打印频率将会很高，需要及时处理

stream 将获取到的 raftpb.Message 放入相应的通道 recvc / propc

# Summary

相比 k8s 的复杂来说，etcd 的代码阅读算是还能摸得着头的了
