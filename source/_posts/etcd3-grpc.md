---
title: ETCD V3 中的 gRPC
abbrlink: e9295e13
date: 2017-10-03 22:39:17
tags: etcd-v3
---

> etcd v3.1.9

# Introduction

基于 protocol buffer，使用 gRPC 框架实现

示例代码：https://github.com/grpc/grpc-go/tree/master/examples

简单易用

# Convert .proto to .go

pb 定义位于 etcdserver/etcdserverpb/rpc.proto 中，service 中定义了一系列 RPC 方法，RPC 中的 request 和 response 则在 service 之后被定义

使用 scripts/genproto.sh 可根据 pb 文件生成 go 文件

也可以根据官方文档使用 protoc 工具，从 pb 文件生成 go 文件

由 .proto 文件生成的 go 文件有两，如

```
rpc.pb.go
rpc.pb.gw.go
```

其中 rpc.pb.gw.go 是个反向代理，是将 http 请求再封成 grpc 发送至后端；按我理解就是方便使用 curl 命令调试

详情参考 ref: https://grpc.io/blog/coreos

下图源自上述网址，清晰明了；无图言 x

![grpc-rest-gateway](./uploads/grpc-rest-gateway.png)

# The entry in etcd

gRPC 的入口位于 etcdserver/api/v3rpc/grpc.go

该文件中 new 了 grpc server，注册了 pb 中定义的一系列 service，并返回 grpc server

# ETCD v3 vs ETCD v2 in client listener

v3 中保有 peer http，client http 及 client grpc

因此 v3 只是对 client 的 api 变为了 gRPC，peer 之间的通信仍然沿用 v2 的套路
