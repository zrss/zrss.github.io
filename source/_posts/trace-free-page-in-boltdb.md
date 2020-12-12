---
title: boltdb 中的 page 回收策略及优化
abbrlink: ab4aa031
date: 2017-10-21 15:35:21
tags:
    - boltdb
    - etcd-v3
---

> [Dream Of A Dream](http://music.163.com/#/m/song?id=28949431) —— “人言南柯一梦，领略了繁华沧桑，谁人过往不相似”

# etcd v3.1.9 boltdb pending pages 回收策略

etcdv3 中 backend 使用 boltdb 实现

在 etcdv3.1.9 集成的 boltdb 版本中，仅在 freelist 中记录可释放的 page id (pending: [txid] -> page ids)，在 rw txn 中释放当前 txn 中最小 txid 之前的 pending pages[1]，因此如果有一个 read txn 运行时间过长，会导致部分 pages 无法及时回收使用，导致 db 大小增加。示意图如下

![leak-of-pages](./uploads/leak-of-pages.jpeg)

```go
[1] func (db *DB) beginRWTx() (*Tx, error) {} // 在该方法中释放 pending pages
```

mock 代码也很好写，随手写了个示例 (为了效果更明显，在 tx 的 Commit 方法中输出了 freelist 的情况)

```go
func (tx *Tx) Commit() error {
	...
	fmt.Printf("freelist pending_cnt: %d, freelist free_cnt: %d\n", tx.db.freelist.pending_count(), tx.db.freelist.free_count())
	p, err := tx.allocate((tx.db.freelist.size() / tx.db.pageSize) + 1)
	...
}
```

正式的 mock 代码: 在一个 read txn 中 “休息” 一会儿，同时不断的开启 rw txn 写数据

```go
package main
import (
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"
	"github.com/boltdb/bolt"
)
func main() {
	// Open the my.db data file in your current directory.
	// It will be created if it doesn't exist.
	db, err := bolt.Open("frag.db", 0600, nil)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	db.Update(func(tx *bolt.Tx) error {
		_, err := tx.CreateBucketIfNotExists([]byte("MyBucket"))
		if err != nil {
			return err
		}
		return err
	})
	go func() {
		db.View(func(tx *bolt.Tx) error {
			fmt.Printf("start of long run read txn\n")
			fmt.Printf("read txn txid: %d\n", tx.ID())
			bucket := tx.Bucket([]byte("MyBucket"))
			bucket.Get([]byte("answer"))
			<-time.After(10 * time.Second)
			fmt.Printf("end of long run read txn\n")
			return nil
		})
	}()
	mockValue := make([]byte, 1024)
	for i := 0; i < 64; i++ {
		db.Update(func(tx *bolt.Tx) error {
			fmt.Printf("rw txn txid: %d\n", tx.ID())
			b := tx.Bucket([]byte("MyBucket"))
			err = b.Put([]byte("answer"), mockValue)
			return err
		})
	}
	c := make(chan os.Signal, 2)
	signal.Notify(c, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-c
		os.Exit(1)
	}()
}
```

运行三次之后，效果明显 (见如下控制台输出) ，read txn 未退出时 pending_count 增加，退出之后，free_count 总量增加，然而此时 db 文件已经扩展增大了，即总的可用页数增加了

```bash
freelist pending_cnt: 1, freelist free_cnt: 12
rw txn txid: 133
freelist pending_cnt: 3, freelist free_cnt: 10
start of long run read txn
read txn txid: 132
rw txn txid: 134
freelist pending_cnt: 6, freelist free_cnt: 7
rw txn txid: 135
freelist pending_cnt: 9, freelist free_cnt: 4
rw txn txid: 136
freelist pending_cnt: 12, freelist free_cnt: 1
rw txn txid: 137
freelist pending_cnt: 15, freelist free_cnt: 0
rw txn txid: 138
freelist pending_cnt: 18, freelist free_cnt: 0
rw txn txid: 139
freelist pending_cnt: 21, freelist free_cnt: 0
rw txn txid: 140
freelist pending_cnt: 24, freelist free_cnt: 0
rw txn txid: 141
end of long run read txn
freelist pending_cnt: 27, freelist free_cnt: 0
rw txn txid: 142
freelist pending_cnt: 3, freelist free_cnt: 25
rw txn txid: 143
freelist pending_cnt: 3, freelist free_cnt: 25
```

当然 long run read txn，会获取 mmap 读锁，因此当 rw txn 需要 mmap 写锁以扩大存储空间时，会阻塞

```
Read-only transactions and read-write transactions should not depend on one another and generally shouldn’t be opened simultaneously in the same goroutine. This can cause a deadlock as the read-write transaction needs to periodically re-map the data file but it cannot do so while a read-only transaction is open. https://github.com/boltdb/bolt#transactions
```

为了优化这个点儿，当然也因为 boltdb 原作者不干了，coreos 的大佬们自己拉了一个库继续搞，就是 https://github.com/coreos/bbolt，这个新库在它的第二个合入 pr https://github.com/coreos/bbolt/pull/3 中尝试解决这个问题

附赠一个删除 key 之后空间不会变小的解释，直觉来理解的话，boltdb 是 page 管理的空间，底层空间是连续的，boltdb 将这个空间逻辑上划分为一个个页

# bbolt 优化后的回收策略

粗略过了一遍代码，总之之前是只能释放当前最小 txn 之前的 pending pages 对吧，现在不管你，能释放的我都释放掉不就行了？示意图如下

![free-pages](./uploads/free-pages.jpeg)

为了实现这个方案，当然要增加一些记录值，修改一些实现，下面详细看一下这个 pr https://github.com/coreos/bbolt/pull/3/files

```go
// freePages releases any pages associated with closed read-only transactions.
func (db *DB) freePages() {
	// Free all pending pages prior to earliest open transaction.
	// txid 升序排序
	sort.Sort(txsById(db.txs))
	minid := txid(0xFFFFFFFFFFFFFFFF)
	if len(db.txs) > 0 {
		minid = db.txs[0].meta.txid
	}
	// 释放最小 txid 之前的 pengding pages
	if minid > 0 {
		db.freelist.release(minid - 1)
	}
	
	// Release unused txid extents.
	// 释放 tx 之间的 pending pages
	for _, t := range db.txs {
		db.freelist.releaseRange(minid, t.meta.txid-1)
		minid = t.meta.txid + 1
	}
	
	// 释放当前最大 txid 之后的 pending pages
	db.freelist.releaseRange(minid, txid(0xFFFFFFFFFFFFFFFF))
	// Any page both allocated and freed in an extent is safe to release.
	// 假设在 rw txn 之间频繁的有 long run 的 read txn，这个优化很有效
}
```

原 freelist pending 为 [txid] -> []pgid 的映射，现修改为 [txid] -> txPending{} 的映射

```go
type txPending struct {
	// []pgid 与 []txid 对应
	// 每 append 一个 pgid 则 append 一个 txid
	// 以记录该 pgid 是在哪个 tx 中被分配
	ids              []pgid
	alloctx          []txid // txids allocating the ids
	lastReleaseBegin txid   // beginning txid of last matching releaseRange
}
```

freelist 增加一个记录 allocs: map[pgid] -> txid

```go
// freelist represents a list of all pages that are available for allocation.
// It also tracks pages that have been freed but are still in use by open transactions.
type freelist struct {
	ids     []pgid              // all free and available free page ids.
	// 记录每次 allocate 返回的 page id 与 txid 的对应关系
	// allocate 返回的是连续分配的第一个 page id
	allocs  map[pgid]txid       // mapping of txid that allocated a pgid.
	pending map[txid]*txPending // mapping of soon-to-be free page ids by tx.
	cache   map[pgid]bool       // fast lookup of all free and pending page ids.
}
```

freelist allocate 方法增加 txid 参数，用以记录 tx 分配的 page

```go
// allocate returns the starting page id of a contiguous list of pages of a given size.
// If a contiguous block cannot be found then 0 is returned.
func (f *freelist) allocate(txid txid, n int) pgid {
	...
			// 记录；仅记录分配的连续 page 的第一个 page id
			f.allocs[initial] = txid
	...
}
```

修改 freelist free 方法内部实现

```go
// free releases a page and its overflow for a given transaction id.
// If the page is already free then a panic will occur.
func (f *freelist) free(txid txid, p *page) {
	if p.id <= 1 {
		panic(fmt.Sprintf("cannot free page 0 or 1: %d", p.id))
	}
	// Free page and all its overflow pages.
	txp := f.pending[txid]
	if txp == nil {
		txp = &txPending{}
		f.pending[txid] = txp
	}
	// 获取是分配给哪个 tx 使用的
	allocTxid, ok := f.allocs[p.id]
	if ok {
		// 解除关联关系
		delete(f.allocs, p.id)
	} else if (p.flags & (freelistPageFlag | metaPageFlag)) != 0 {
		// Safe to claim txid as allocating since these types are private to txid.
		// 这两种页类型没记录
		allocTxid = txid
	}
	
	// 释放连续页
	for id := p.id; id <= p.id+pgid(p.overflow); id++ {
		// Verify that page is not already free.
		if f.cache[id] {
			panic(fmt.Sprintf("page %d already freed", id))
		}
		// Add to the freelist and cache.
		
		// ids 与 alloctx 对应
		txp.ids = append(txp.ids, id)
		txp.alloctx = append(txp.alloctx, allocTxid)
		
		f.cache[id] = true
	}
}
```

freelist 增加 releaseRange 实现

```go
// releaseRange moves pending pages allocated within an extent [begin,end] to the free list.
// ps: [begin, end]
func (f *freelist) releaseRange(begin, end txid) {
	if begin > end {
		return
	}
	var m pgids
	for tid, txp := range f.pending {
		if tid < begin || tid > end {
			continue
		}
		// Don't recompute freed pages if ranges haven't updated.
		// 已处理
		if txp.lastReleaseBegin == begin {
			continue
		}
		for i := 0; i < len(txp.ids); i++ {
			if atx := txp.alloctx[i]; atx < begin || atx > end {
				continue
			}
			m = append(m, txp.ids[i])
			// 这个实现是够省事儿的
			// 如果该 page 能释放，则直接移除
			// ids 和 alloctx 数组前移一位
			// i-- 以便下次循环保持
			txp.ids[i] = txp.ids[len(txp.ids)-1]
			txp.ids = txp.ids[:len(txp.ids)-1]
			txp.alloctx[i] = txp.alloctx[len(txp.alloctx)-1]
			txp.alloctx = txp.alloctx[:len(txp.alloctx)-1]
			i--
		}
		// 该 txid 的 txp 在该 range 已处理
		txp.lastReleaseBegin = begin
		// 如果均可以释放，则从 pending 中移除
		if len(txp.ids) == 0 {
			delete(f.pending, tid)
		}
	}
	// 排序
	sort.Sort(m)
	// 归并排序合入可用 ids
	f.ids = pgids(f.ids).merge(m)
}
```

回过头来梳理 freelist 中的各种映射

pending [txid] -> txPending

而 txPending 中又会存储 ids 和 alloctx，而看 releaseRange 中的实现，这个 alloctx 与 txid 不一定是一致的，那这个 txPending 是在哪儿修改的 ?

**问题: txPending 在哪儿被修改**

其实刚才我们已经看到了，其在 func (f *freelist) free(txid txid, p *page) 方法中被修改，那么 free 功能又是啥？

1. free(txid txid, p *page)
1. 获取 txPending (txp := f.pending[txid])
1. 获取分配该 page 的 txid (allocTxid, ok := f.allocs[p.id]); 如果获取不到且 page 为 freelist or meta，将 allocTxid 设置为当前 txid
1. 将释放的连续页记录到 txPending 中: txp.ids = append(txp.ids, id); txp.alloctx = append(txp.alloctx, allocTxid))

**是否与 allocate 对应 ?**

1. allocate(txid txid, n int)
1. 分配连续的 n 个 pages，并返回第一个 page id (initial)
1. 记录该 page id 被 txid 分配 (freelist.allocs[initial] = txid)

看起来 free 并不与 allocate 对应，即并不是 free 该 txid 的所分配的 pages 的语义，而是将连续页 (p *page) 加入到 txid 的 pending 记录中待释放；这么看来的话 pending [txid] -> txPending 好理解，然而 txPending 中未必只存储 [txid] 的 pending pages，这么实现应该与上层调用 free 方法的语义有关

最后看看 freelist 的 rollback 修改

```go
// rollback removes the pages from a given pending tx.
func (f *freelist) rollback(txid txid) {
	// Remove page ids from cache.
	txp := f.pending[txid]
	if txp == nil {
		return
	}
	var m pgids
	for i, pgid := range txp.ids {
		delete(f.cache, pgid)
		tx := txp.alloctx[i]
		// tx == 0 ?!
		if tx == 0 {
			continue
		}
		// 非当前 rollback 的 tx 分配的 page
		if tx != txid {
			// Pending free aborted; restore page back to alloc list.
			f.allocs[pgid] = tx
		} else {
			// Freed page was allocated by this txn; OK to throw away.
			// 归还 freelist ids
			m = append(m, pgid)
		}
	}
	// Remove pages from pending list and mark as free if allocated by txid.
	delete(f.pending, txid)
	sort.Sort(m)
	f.ids = pgids(f.ids).merge(m)
}
```

# 更好的回收策略？

https://github.com/coreos/bbolt/issues/14

# 总结

总之这个 pr 目测能极大缓解 etcd v3.1.9 中偶尔会遇到的 mvcc: database space exceeded 的错误，但是总感觉有些 page 还是没有及时回收的样子，这种没彻底弄清楚的感觉，合入总有点儿不放心 … 随意一说
