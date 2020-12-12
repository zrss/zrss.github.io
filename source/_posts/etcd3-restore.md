---
title: ETCD V3 中的 Restore
abbrlink: 45aaba66
date: 2017-10-04 23:07:43
tags: etcd-v3
---

> etcd v3.1.9

数据是如此重要，有必要看下 etcdctl restore 的实现

etcdctl 的实现均在 etcdctl 目录下，ctlv2 是 v2 的实现，ctlv3 是 v3 的实现，统一入口 main.go，通过环境变量 ETCDCTL_API 指定使用哪个版本的 etcdctl

查看 etcdctl/ctlv3/command/snapshot_command.go 中的 snapshotRestoreCommandFunc 方法

# Restore 的整体过程

1. 使用 —initial-cluster / —name / —initial-cluster-token / —initial-advertise-peer-urls 参数生成 etcd 集群及成员参数
1. 校验参数
1. 如果 data-dir 已经存在，报错退出
1. 生成 etcd v3 backend db 文件 (makeDB)
1. 生成 .wal 和 .snap 文件 (makeWALAndSnap)

# makeDB

具体查看 makeDB 方法

```go
// makeDB copies the database snapshot to the snapshot directory
func makeDB(snapdir, dbfile string, commit int) {
	// 打开 db 文件
	f, ferr := os.OpenFile(dbfile, os.O_RDONLY, 0600)
	if ferr != nil {
		ExitWithError(ExitInvalidInput, ferr)
	}
	defer f.Close()
	// get snapshot integrity hash
	if _, err := f.Seek(-sha256.Size, os.SEEK_END); err != nil {
		ExitWithError(ExitIO, err)
	}
	sha := make([]byte, sha256.Size)
	if _, err := f.Read(sha); err != nil {
		ExitWithError(ExitIO, err)
	}
	if _, err := f.Seek(0, os.SEEK_SET); err != nil {
		ExitWithError(ExitIO, err)
	}
	
	// 创建 data-dir/member/snap 目录
	if err := fileutil.CreateDirAll(snapdir); err != nil {
		ExitWithError(ExitIO, err)
	}
	
	// 拷贝 db 文件至 data-dir/member/snap/db
	dbpath := filepath.Join(snapdir, "db")
	db, dberr := os.OpenFile(dbpath, os.O_RDWR|os.O_CREATE, 0600)
	if dberr != nil {
		ExitWithError(ExitIO, dberr)
	}
	if _, err := io.Copy(db, f); err != nil {
		ExitWithError(ExitIO, err)
	}
	// truncate away integrity hash, if any.
	off, serr := db.Seek(0, os.SEEK_END)
	if serr != nil {
		ExitWithError(ExitIO, serr)
	}
	
	// db 文件中是否存在 hash 值这块有点意思
	// 看着是以 512 chunk 的方式写入的
	// % 512 以后余下的字节数等于 sha256.Size 的话
	// 那么 db 文件存在 hash 值
	hasHash := (off % 512) == sha256.Size
	if hasHash {
		// 去掉 db 文件末尾的 hash 值
		if err := db.Truncate(off - sha256.Size); err != nil {
			ExitWithError(ExitIO, err)
		}
	}
	
	// 如果既没有 hash 值，restore 参数又没有指定 --skip-hash-check
	// 那么报错退出
	// 注意此时已经生成了 data-dir/member/snap/db 文件
	if !hasHash && !skipHashCheck {
		err := fmt.Errorf("snapshot missing hash but --skip-hash-check=false")
		ExitWithError(ExitBadArgs, err)
	}
	if hasHash && !skipHashCheck {
		// check for match
		if _, err := db.Seek(0, os.SEEK_SET); err != nil {
			ExitWithError(ExitIO, err)
		}
		h := sha256.New()
		if _, err := io.Copy(h, db); err != nil {
			ExitWithError(ExitIO, err)
		}
		dbsha := h.Sum(nil)
		if !reflect.DeepEqual(sha, dbsha) {
			err := fmt.Errorf("expected sha256 %v, got %v", sha, dbsha)
			ExitWithError(ExitInvalidInput, err)
		}
	}
	// db hash is OK, can now modify DB so it can be part of a new cluster
	db.Close()
	// update consistentIndex so applies go through on etcdserver despite
	// having a new raft instance
	be := backend.NewDefaultBackend(dbpath)
	// a lessor never timeouts leases
	lessor := lease.NewLessor(be, math.MaxInt64)
	s := mvcc.NewStore(be, lessor, (*initIndex)(&commit))
	id := s.TxnBegin()
	btx := be.BatchTx()
	del := func(k, v []byte) error {
		_, _, err := s.TxnDeleteRange(id, k, nil)
		return err
	}
	
	// db 文件中存储了 member 的信息
	// 此处删除
	// delete stored members from old cluster since using new members
	btx.UnsafeForEach([]byte("members"), del)
	// todo: add back new members when we start to deprecate old snap file.
	btx.UnsafeForEach([]byte("members_removed"), del)
	// trigger write-out of new consistent index
	s.TxnEnd(id)
	s.Commit()
	s.Close()
}
```

# makeWALAndSnap

具体查看 makeWALAndSnap 方法，无图言 x，makeWALAndSnap 生成的 .wal 和 .snap 文件内容如下

![restore_wal](/images/restore_wal.jpeg)

代码注释如下

```go
// makeWAL creates a WAL for the initial cluster
func makeWALAndSnap(waldir, snapdir string, cl *membership.RaftCluster) {
	// 新建 data-dir/member/wal 目录
	if err := fileutil.CreateDirAll(waldir); err != nil {
		ExitWithError(ExitIO, err)
	}
	// etcd v2 storage
	// add members again to persist them to the store we create.
	st := store.New(etcdserver.StoreClusterPrefix, etcdserver.StoreKeysPrefix)
	cl.SetStore(st)
	for _, m := range cl.Members() {
		cl.AddMember(m)
	}
	// cluster and member metadata
	// write to wal
	m := cl.MemberByName(restoreName)
	md := &etcdserverpb.Metadata{NodeID: uint64(m.ID), ClusterID: uint64(cl.ID())}
	metadata, merr := md.Marshal()
	if merr != nil {
		ExitWithError(ExitInvalidInput, merr)
	}
	
	// 生成初始 wal 文件
	w, walerr := wal.Create(waldir, metadata)
	if walerr != nil {
		ExitWithError(ExitIO, walerr)
	}
	defer w.Close()
	//
	// add entries for raft start
	peers := make([]raft.Peer, len(cl.MemberIDs()))
	for i, id := range cl.MemberIDs() {
		ctx, err := json.Marshal((*cl).Member(id))
		if err != nil {
			ExitWithError(ExitInvalidInput, err)
		}
		peers[i] = raft.Peer{ID: uint64(id), Context: ctx}
	}
	ents := make([]raftpb.Entry, len(peers))
	nodeIDs := make([]uint64, len(peers))
	for i, p := range peers {
		nodeIDs[i] = p.ID
		cc := raftpb.ConfChange{
			Type:    raftpb.ConfChangeAddNode,
			NodeID:  p.ID,
			Context: p.Context}
		d, err := cc.Marshal()
		if err != nil {
			ExitWithError(ExitInvalidInput, err)
		}
		e := raftpb.Entry{
			Type:  raftpb.EntryConfChange,
			Term:  1,
			Index: uint64(i + 1),
			Data:  d,
		}
		ents[i] = e
	}
	// add nodes entries are committed
	// initial term 1
	// save to wal
	commit, term := uint64(len(ents)), uint64(1)
	if err := w.Save(raftpb.HardState{
		Term:   term,
		Vote:   peers[0].ID,
		Commit: commit}, ents); err != nil {
		ExitWithError(ExitIO, err)
	}
	b, berr := st.Save()
	if berr != nil {
		ExitWithError(ExitError, berr)
	}
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
	// save snapshot
	// Term: 1
	// Index: The number of member in cluster
	snapshotter := snap.New(snapdir)
	if err := snapshotter.SaveSnap(raftSnap); err != nil {
		panic(err)
	}
	// write to wal
	if err := w.SaveSnapshot(walpb.Snapshot{Index: commit, Term: term}); err != nil {
		ExitWithError(ExitIO, err)
	}
}
```
