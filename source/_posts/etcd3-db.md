---
title: ETCD V3 中的 db 文件
abbrlink: 77fa05dc
date: 2017-10-04 23:11:15
tags: etcd-v3
---

> etcd v3.1.9

to be cont.

boltdb 原哥们，不维护了貌似，coreos 的人继续维护 https://github.com/coreos/bbolt

另外这个 issues 和 free page 相关，即能解决部分 boltdb 内存碎片问题

https://github.com/coreos/bbolt/pull/3

# boltdb

bolt_unix.go 几个工具方法，如 flock / funlock / mmap / munmap

bolt_linux.go fsync db 文件

入口处在 db.go 的 Open 方法，通过 Open 方法初始化一个 db 文件；对应 etcd 中 mvcc/backend/backend.go 中的 newBackend 方法的调用

```go
func newBackend(path string, d time.Duration, limit int) *backend {
	...
	// bolt db
	db, err := bolt.Open(path, 0600, boltOpenOptions)
	if err != nil {
		plog.Panicf("cannot open database at %s (%v)", path, err)
	}
	...
}
```

Open 方法中，如果是新建的 db 文件，则调用 db.init() 写入 metadata 信息，boltdb 的注释写的很赞，感觉就是个工业又学术的艺术品，赞！

查看 db.init() 干了什么，直接上图吧，往 db 文件中写了四个 page （size 一般是 4096 字节） 的内容

![initial_db](/images/initial_db.jpeg)

然后就是各种初始化了，初始化 pagePool，mmap the data file as a byte slice，初始化 freelist

etcd 的 InitialMmapSize 设置为 10 1024 1024 * 1024，吓人，那是否 etcd 一启动，就会占用这么大的实际内存？并不是的哈，在 mac 上实测 top 命令看到的是 314MB，ps aux 看到的 vsz 556879888，rss 476460，很好奇，按理来说 vsz 的单位应该是 kb 呀，但是这个数字有点儿大的吓人，实际应该是字节，也就是 500 多 MB，那么 rss 又怎么理解呢？rss 的单位又是 kb，实际使用了 470 多 MB？神奇，总之并不是启动之后立马占用 10 G内存

开头写两个一样的 meta page 貌似是为了做保护，看到 mmap 的方法中有这段注释

```go
// Validate the meta pages. We only return an error if both meta pages fail
// validation, since meta0 failing validation means that it wasn't saved
// properly -- but we can recover using meta1. And vice-versa.
err0 := db.meta0.validate()
err1 := db.meta1.validate()
if err0 != nil && err1 != nil {
	return err0
}
```

说直接一点儿，boltdb 使用 mmap 把一个名为 db 的文件映射到内存中的 []byte 数组，然后直接操作内存，但是不管怎么说是外部存储，最终还是要落盘的，所以呢推测是用了 B+ tree，然后把写入的内容组织成 page，使用指针操作，这块代码有点像 C 其实

freelist allocate 的逻辑是从 freelist 记录的所有 free page 中分配 n 个连续的 page

```go
// allocate returns the starting page id of a contiguous list of pages of a given size.
// If a contiguous block cannot be found then 0 is returned.
func (f *freelist) allocate(n int) pgid {
	if len(f.ids) == 0 {
		return 0
	}
	var initial, previd pgid
	for i, id := range f.ids {
		if id <= 1 {
			panic(fmt.Sprintf("invalid page allocation: %d", id))
		}
		// Reset initial page if this is not contiguous.
		if previd == 0 || id-previd != 1 {
			initial = id
		}
		// If we found a contiguous block then remove it and return it.
		if (id-initial)+1 == pgid(n) {
			// If we're allocating off the beginning then take the fast path
			// and just adjust the existing slice. This will use extra memory
			// temporarily but the append() in free() will realloc the slice
			// as is necessary.
			
			// 将已分配的连续页移出 free list 记录表 (ids)
			// 并释放 ids 空间
			if (i + 1) == n {
				f.ids = f.ids[i+1:]
			} else {
				copy(f.ids[i-n+1:], f.ids[i+1:])
				f.ids = f.ids[:len(f.ids)-n]
			}
			// Remove from the free cache.
			// 移出 free list cache
			for i := pgid(0); i < pgid(n); i++ {
				delete(f.cache, initial+i)
			}
			
			// 返回起始页
			return initial
		}
		previd = id
	}
	return 0
}
```

freelist 的 write 实现

```go
// read initializes the freelist from a freelist page.
func (f *freelist) read(p *page) {
	// If the page.count is at the max uint16 value (64k) then it's considered
	// an overflow and the size of the freelist is stored as the first element.
	idx, count := 0, int(p.count)
	if count == 0xFFFF {
		idx = 1
		count = int(((*[maxAllocSize]pgid)(unsafe.Pointer(&p.ptr)))[0])
	}
	// Copy the list of page ids from the freelist.
	if count == 0 {
		f.ids = nil
	} else {
		ids := ((*[maxAllocSize]pgid)(unsafe.Pointer(&p.ptr)))[idx:count]
		f.ids = make([]pgid, len(ids))
		copy(f.ids, ids)
		// Make sure they're sorted.
		sort.Sort(pgids(f.ids))
	}
	// Rebuild the page cache.
	f.reindex()
}
```

freelist 的 read 实现，对应 write；如何 write 的，就如何 read

```go
// read initializes the freelist from a freelist page.
func (f *freelist) read(p *page) {
	// If the page.count is at the max uint16 value (64k) then it's considered
	// an overflow and the size of the freelist is stored as the first element.
	// page 中的 count 怎么理解 ？
	// 看着像是 page 下面维护着一系列 pgid
	idx, count := 0, int(p.count)
	if count == 0xFFFF {
		idx = 1
		count = int(((*[maxAllocSize]pgid)(unsafe.Pointer(&p.ptr)))[0])
	}
	// Copy the list of page ids from the freelist.
	if count == 0 {
		f.ids = nil
	} else {
		ids := ((*[maxAllocSize]pgid)(unsafe.Pointer(&p.ptr)))[idx:count]
		f.ids = make([]pgid, len(ids))
		copy(f.ids, ids)
		
		// copy 结束之后，是否可以设置 ids = nil，帮助 gc ?
		
		// Make sure they're sorted.
		sort.Sort(pgids(f.ids))
	}
	// Rebuild the page cache.
	f.reindex()
}
```

freelist 的 reindex 实现，其实就是构造 cache，很直接的实现

```go
// reindex rebuilds the free cache based on available and pending free lists.
func (f *freelist) reindex() {
	// 既然已知大小的话，make 的时候为啥不指定 capacity
	// 好吧，我晕了，这个是 map，怎么指定大小？naive
	f.cache = make(map[pgid]bool)
	for _, id := range f.ids {
		f.cache[id] = true
	}
	// pending 记录了 tx 中使用过，未被释放的 page id
	for _, pendingIDs := range f.pending {
		for _, pendingID := range pendingIDs {
			f.cache[pendingID] = true
		}
	}
}
```

boltdb 在 beginRWTx 中释放空间

```go
func (db *DB) beginRWTx() (*Tx, error) {
	// If the database was opened with Options.ReadOnly, return an error.
	if db.readOnly {
		return nil, ErrDatabaseReadOnly
	}
	// Obtain writer lock. This is released by the transaction when it closes.
	// This enforces only one writer transaction at a time.
	db.rwlock.Lock()
	// Once we have the writer lock then we can lock the meta pages so that
	// we can set up the transaction.
	db.metalock.Lock()
	defer db.metalock.Unlock()
	// Exit if the database is not open yet.
	if !db.opened {
		db.rwlock.Unlock()
		return nil, ErrDatabaseNotOpen
	}
	// Create a transaction associated with the database.
	t := &Tx{writable: true}
	t.init(db)
	db.rwtx = t
	// Free any pages associated with closed read-only transactions.
	// 获取当前事务中的最小 txid
	var minid txid = 0xFFFFFFFFFFFFFFFF
	for _, t := range db.txs {
		if t.meta.txid < minid {
			minid = t.meta.txid
		}
	}
	
	// 释放该 txid 之前的 page
	if minid > 0 {
		db.freelist.release(minid - 1)
	}
	return t, nil
}
```

查看 db.freelist.release 的实现

```go
// release moves all page ids for a transaction id (or older) to the freelist.
func (f *freelist) release(txid txid) {
	m := make(pgids, 0)
	for tid, ids := range f.pending {
		if tid <= txid {
			// Move transaction's pending pages to the available freelist.
			// Don't remove from the cache since the page is still free.
			m = append(m, ids...)
			delete(f.pending, tid)
		}
	}
	sort.Sort(m)
	
	// 可重新使用的 pending page 与当前可使用的 page merge sort
	f.ids = pgids(f.ids).merge(m)
}
```

leafPageElement 结构

```go
type leafPageElement struct {
	flags uint32 // 4 bytes; 2 leafElement / 1 branchElement / 4 meta / 
	pos   uint32 // 4 bytes
	ksize uint32 // 4 bytes
	vsize uint32 // 4 bytes
	// pos = 16 that remain space to store key and value
	// for example ksize = 8 that 64 bytes for key
}
```

如图所示

![leafPageElement](/images/leafPageElement.jpeg)

即叶子节点中存储了 key 和 value

# etcd

查看 mvcc/kvstore.go 的 func (s *store) put(key, value []byte, leaseID lease.LeaseID) 方法

查看如下

```go
func (s *store) put(key, value []byte, leaseID lease.LeaseID) {
	s.txnModify = true
	
	// 每次 put revision + 1
	rev := s.currentRev.main + 1
	c := rev
	oldLease := lease.NoLease
	// if the key exists before, use its previous created and
	// get its previous leaseID
	_, created, ver, err := s.kvindex.Get(key, rev)
	if err == nil {
		c = created.main
		oldLease = s.le.GetLease(lease.LeaseItem{Key: string(key)})
	}
	// revision to bytes
	ibytes := newRevBytes()
	revToBytes(revision{main: rev, sub: s.currentRev.sub}, ibytes)
	
	// 
	ver = ver + 1
	kv := mvccpb.KeyValue{
		Key:            key,
		Value:          value,
		CreateRevision: c,
		ModRevision:    rev,
		Version:        ver,
		Lease:          int64(leaseID),
	}
	d, err := kv.Marshal()
	if err != nil {
		plog.Fatalf("cannot marshal event: %v", err)
	}
	
	// boltdb 中的 key 为 revision
	// value 为 mvccpb.KeyValue
	// 存入 boltdb 即 db 文件
	s.tx.UnsafeSeqPut(keyBucketName, ibytes, d)
	
	// 存入 key -> revision 的索引
	s.kvindex.Put(key, revision{main: rev, sub: s.currentRev.sub})
	
	// 这个是啥
	// s.changes 什么时候释放，不然内存不会爆？
	s.changes = append(s.changes, kv)
	s.currentRev.sub += 1
	// lease 相关代码先略去不表
}
```

查看 kvindex 的实现，实际上为 newTreeIndex()，即 mvcc/index.go，摘抄一句 package 注释

Package btree implements in-memory B-Trees of arbitrary degree.

okay, index 底层是 B tree

查看 kvindex.put 方法

```go
func (ti *treeIndex) Put(key []byte, rev revision) {
	keyi := &keyIndex{key: key}
	ti.Lock()
	defer ti.Unlock()
	
	// B tree get
	item := ti.tree.Get(keyi)
	if item == nil {
		keyi.put(rev.main, rev.sub)
		ti.tree.ReplaceOrInsert(keyi)
		return
	}
	
	// update value in B tree
	okeyi := item.(*keyIndex)
	okeyi.put(rev.main, rev.sub)
}
```

kvindex 是个完全在内存中的索引，如果 etcd 重启了之后，需要恢复 kvindex 么？答案是需要的

etcdserver/server.go -> s.kv.Restore(newbe) -> func (s store) Restore(b backend.Backend) error {} -> func (s store) restore() error {}

在最后这个方法中从 db 文件恢复 kvindex
