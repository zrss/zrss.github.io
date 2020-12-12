---
title: ETCD V3 中的 .snap 文件
tags:
  - etcd-v3
categories: 笔记
abbrlink: 13770945
date: 2017-10-02 00:00:00
---

> etcd v3.1.9

# 什么时候生成

etcd 启动时设置了参数 –snapshot-count 即 index 变化 达到该值时，会生成 .snap 文件

相关代码如下

```go
func (s *EtcdServer) triggerSnapshot(ep *etcdProgress) {
	if ep.appliedi-ep.snapi <= s.snapCount {
		return
	}
	plog.Infof("start to snapshot (applied: %d, lastsnap: %d)", ep.appliedi, ep.snapi)
	s.snapshot(ep.appliedi, ep.confState)
	ep.snapi = ep.appliedi
}
```

# 文件名规则

snap 的全称呢 snapshot，是快照的意思，在 etcd v3 里面呢，是把 v2 的内存数据存储到磁盘上，生成 [Term]-[Index].snap 一类的文件

> snap 文件名生成规则
>
> fname := fmt.Sprintf(“%016x-%016x%s”, snapshot.Metadata.Term, snapshot.Metadata.Index, snapSuffix)

# 是否可以删除

说到 v2 的存储，全部在内存中，而且是一个非常直接的实现，看着就是个多叉树

那么是否 .snap 文件就可以删除掉了呢

1. 如果存储了 v2 的数据，显然不能删除，否则 etcd 重启之后，就无法从 .snap 文件中恢复出 v2 的数据了；当然恢复也不会是全量的数据，因为有 —snapshot-count 控制，会丢这个数的 Index
1. 如果没存储 v2 的数据，都是存的 v3 的数据，这种情况下，能否删除？
这就要看 .snap 文件除了存储 v2 的数据还存了什么东东；以及存的这东东，还有什么其他重要的用途了

看了 etcd v3 的 restore 代码之后，我们知道 restore 会在 snap 文件下生成 v3 的存储 db 文件，以及一个 .snap 文件，这个 .snap 文件存储了啥东西嘞

相关代码如下

```go
// first snapshot
raftSnap := raftpb.Snapshot{
  Data: b,
  Metadata: raftpb.SnapshotMetadata{
    Index: commit,
    Term:  term,
    ConfState: raftpb.ConfState{
      Nodes: nodeIDs,
    },
  },
}
```

其中的 Data 并不重要，只是存储了两个 namespace，其实就是两路径

```go
st := store.New(etcdserver.StoreClusterPrefix, etcdserver.StoreKeysPrefix)
```

重要的是 Metadata 中的 Index 和 Term

**显然也不能删除**

etcd 在启动时，会读取 .snap 文件，获取其中的 Metadata.Index，使用这个值去搜索应该从哪个 wal 文件开始继续处理

回忆一下 .wal 文件名的第二段，正是当时 wal 存储中的 index

wal 的搜索代码如下

```go
nameIndex, ok := searchIndex(names, snap.Index)
if !ok || !isValidSeq(names[nameIndex:]) {
    return nil, ErrFileNotFound
}
```

从最旧的 wal 搜索到最新的 wal `sort.Strings(names)`，直到搜索到

```go
if index >= curIndex {
    return i, true
}
```

如果 .snap 文件不存在，那么会从 index = 0 开始搜索 wal 文件，也就是说 .snap 文件不存在的时候，必须存在 0000000000000000-0000000000000000.wal 文件，否则 etcd 启动时会报如下错误

```log
2017-10-02 13:49:08.313573 C | etcdserver: open wal error: wal: file not found
```

wal 中存储了 raft MemoryStorage 的 entries / raft HardState，etcd member id 和集群 id

# 构造一个异常情况

purge 保留 1，snapshot count 设置的超大，重启 etcd 会发生什么？

```bash
./bin/etcd --max-snapshots '1' --max-wals '1' --snapshot-count '20000000'
```

这个异常意义在于 snapshot 文件并未生成，而此时 wal 被 purge 之后，第一个 wal 被删掉了，那么重启 etcd 后会出现前述 wal: file not found 的错误。

持续往 etcd 写入数据，直到生成新的 wal 文件，然而不幸的是，并没有观察到 purge 的动作。 那么问题来了，etcd 是在哪儿做了保护？

查看 purge 的代码发现了如下的轨迹

```go
l, err := TryLockFile(f, os.O_WRONLY, PrivateFileMode)
if err != nil {
    break
}
```

也就是说 TryLockFile 成功才可以被 purge 掉，那么我们可以进一步推测没生成 .snap 文件之前，etcd 不会释放 LockFile，阻止仍然有用的 wal 文件被 purge 掉

为了验证我们的猜想，查看 wal/wal.go 的 ReleaseLockTo 方法，直接贴该方法的注释吧

```
ReleaseLockTo releases the locks, which has smaller index than the given index except the largest one among them.
For example, if WAL is holding lock 1,2,3,4,5,6, ReleaseLockTo(4) will release lock 1,2 but keep 3. ReleaseLockTo(5) will release 1,2,3 but keep 4.
```

继续看，ReleaseLockTo 方法被谁调用，即什么时候释放 wal 文件的 lock，什么时候允许 wal 被 purge

okay，答案符合我们的预期。ReleaseLockTo 在 etcdserver/storage.go 的 SaveSnap 方法中被调用，还是直接贴该方法的注释吧

```
SaveSnap saves the snapshot to disk and release the locked wal files since they will not be used.
```
