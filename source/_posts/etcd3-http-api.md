---
title: ETCD V3 中的 http api
abbrlink: 9e671fcc
date: 2017-10-03 22:47:19
tags: etcd-v3
---

> etcd v3.1.9

# etcd http api

clientURL/health

```
curl http://localhost:2379/health
{"health": "true"}%
```

peerURL/members

```
curl http://localhost:2380/members
[{"id":10276657743932975437,"peerURLs":["http://localhost:2380"],"name":"default","clientURLs":["http://localhost:2379"]}]
```

# pipelineHandler

/raft

接收 raftpb.Message 消息，传递给 raft.Process 处理

# streamHandler

检查 request id 是否已经被 remove

从 local 中获取 peer，如果不存在，则加入 remote 中 trace，并提示

```
failed to find member [mid] in cluster [cid]
```

检查 x-raft-to id 是否与本成员一致

(1) /raft/stream/msgapp

处理 streamTypeMsgAppV2 消息类型；建立 stream 链接，保持 w http.ResponseWriter

(2) /raft/stream/message

处理 streamTypeMessage 消息类型；建立 stream 链接，保持 w http.ResponseWriter

# snapshotHandler

/raft/snapshot

# probingHandler

/raft/probing
