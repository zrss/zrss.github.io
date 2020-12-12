---
title: raft
abbrlink: cda86f18
date: 2019-11-09 10:20:59
tags: CAP
---

CP

先写 log

再复制 log

一致性协议确保大多数都已成功复制 log 后，这个时候 log 也称为被 committed 了

执行状态机

三种角色

Leader / Follower / Candidate

Leader 负责周期性发起心跳

Follower 接收心跳

Follower 选举超时后，发起 Vote，状态转变为 Candidate

ETCD 的流程

写 WAL; raft 协议 ok; apply data to boltdb

使用 raft 来同步 WAL;

选举的限制

A candidate must contact a majority of the cluster in order to be elected, which means that every committed entry must be present in at least one of those servers

Raft determines which of two logs is more up-to-date by comparing the index and term of the last entries in the logs

简单来说，在发起选举投票时，需要携带最新的 log 信息，包括 index 及 term；term 越大越新，如果 term 相同，则 log 的长度越长越新；这可以保证新选举出来的 leader 包含了之前所有 commited 的信息

网络分区需要特殊考虑 (2PC)

> 第一阶段先征求其他节点是否同意选举，如果同意选举则发起真正的选举操作，否则降为 Follower 角色

例如当有 follow 被隔离时，其 term 会不断增大，当其重新加入集群时，会触发选举，影响集群稳定性；为避免如此情况，增加 preVote 阶段，即发起 vote 的前提为

* 没有收到有效领导的心跳，至少有一次选举超时
* Candidate的日志足够新（Term更大，或者Term相同raft index更大）

才开始选举，避免网络隔离后，恢复加入的节点 term 较高，触发集群选举

客户端也需要考虑，网络分区，无法完成写入，需要 server 端返回特定的错误时，直接切换后端

Summary

* 2PC 两阶段
* Leader 一致性算法
