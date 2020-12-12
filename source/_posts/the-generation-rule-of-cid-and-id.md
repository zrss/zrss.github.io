---
title: Cluster ID 和 Member ID 的生成规则
tags:
  - etcd-v3
categories: 笔记
abbrlink: 781156232
date: 2017-10-03 00:00:00
---

> etcd v3.1.9

# 从 etcd 启动参数中生成 Cluster ID 和 Member ID

```go
cl, err = membership.NewClusterFromURLsMap(cfg.InitialClusterToken, cfg.InitialPeerURLsMap)
```

上述方法从 –initial-cluster-token and –initial-cluster 这个两个启动参数中生成 Cluster ID 和各个 Member ID

NewClusterFromURLsMap 这个方法中调用 NewMember 生成 Member ID

首先来看 NewMember 方法

```
func NewMember(name string, peerURLs types.URLs, clusterName string, now *time.Time) *Member
```

核心思路

```go
b []byte: peerUrls + clusterName + time
hash := sha1.Sum(b)
memberID: binary.BigEndian.Uint64(hash[:8])
```

Member ID 根据 peerUrls / clusterName / current_time 的 sha1 sum 值，取其前 8 个 bytes，为 16 位的 hex 数

回到 NewClusterFromURLsMap 方法中的 NewMember（代码如下）可见最后一个参数为 nil，即不加入时间因素，因此 NewClusterFromURLsMap 生成的 Member ID 是固定的

```go
m := NewMember(name, urls, token, nil)
```

# Member Add 生成的 Member ID

直接从 server 端看起 —— etcdserver/api/v3rpc/member.go 中的 MemberAdd 方法

可见如下代码

```go
urls, err := types.NewURLs(r.PeerURLs)
if err != nil {
    return nil, rpctypes.ErrGRPCMemberBadURLs
}
now := time.Now()
m := membership.NewMember("", urls, "", &now)
if err = cs.server.AddMember(ctx, *m); err != nil {
    return nil, togRPCError(err)
}
```

m := membership.NewMember(“”, urls, “”, &now) 加入了当前时间，因此 Member ID 是不确定的

# 总结

cluster ID 仅生成一次，此后不会变化

通过 etcd 启动参数生成 (initial-cluster) 的 Member ID 固定

通过 Member add 生成的 Member ID 不确定

Member add 的时候，没有传递 member 的 name，因此 member add 成功时，member list 出来的 member item，新加入的 member 其 name 为空，且没有 client url，因该 member 尚未 publish 其 client url 到集群中
