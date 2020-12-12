---
title: ETCD 链接建立
abbrlink: 4ab1fcf6
date: 2017-12-03 16:48:36
tags:
    - etcd-v3
---

机缘巧合，在测试的引导下，读了下 etcd 连接建立方面的代码

etcd 启动后监听 peer url

peer url 通过 mux 绑定 handler，关于 raft 的 url 的请求绑定到 streamHandler 上，这玩意会 hold 住一个连接，除非遇到错误，<-c.closeNotify()，连接 close

啥时候重新 p.attachOutgoingConn(conn) 回来，当然是该成员又请求连接到 url 上来时，即 streamReader 重新连接回来时

streamWriter 使用长链

streamReader 持续读，与 streamWriter 匹配，streamWriter 不遇到错误，不 close 连接；streamReader 断了之后，100ms 重新 dial 一次，重连上后，对端 streamWriter 能 hold 住新的连接

etcd 对其每一个 peer 都会启动 streamReader 和 streamWriter，reader 建立连接后，writer 使用不关闭，reader 有数据时读，writer 有写入时写，保持着连接

所以 etcd peer 间是建立着长链的，可以使用 netstat -anp | grep {etcd_peer_port} 查看 peer 之间的连接建立情况
