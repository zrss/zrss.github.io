---
title: deep-in-boltdb
abbrlink: e6d66434
date: 2017-10-22 15:44:08
tags:
    - boltdb
    - etcd-v3
---

> to be cont.

bucket -> key/value

Cursor 是内存的概念，记录遍历到 leaf page 的路径

bucket 初始关联了一个 root page，为 db meta page

相关代码，beginTX or beginRWTx 都会有调用

```go
func (tx *Tx) init(db *DB) {
	...
	tx.root.bucket = &bucket{}
	...
	*tx.root.bucket = tx.meta.root
	...
	// 可见读事务不增加 txid，仅读写事务增加
	if tx.writable {
		tx.pages = make(map[pgid]*page)
		tx.meta.txid += txid(1)
	}
}
```

看下 Cursor 的 search 实现

```go
// search recursively performs a binary search against a given page/node until it finds a given key.
func (c *Cursor) search(key []byte, pgid pgid) {
	// 该 pgid 可能在 page or node 中
	p, n := c.bucket.pageNode(pgid)
	if p != nil && (p.flags&(branchPageFlag|leafPageFlag)) == 0 {
		panic(fmt.Sprintf("invalid page type: %d: %x", p.id, p.flags))
	}
	e := elemRef{page: p, node: n}
	c.stack = append(c.stack, e)
	// If we're on a leaf page/node then find the specific node.
	if e.isLeaf() {
		c.nsearch(key)
		return
	}
	if n != nil {
		c.searchNode(key, n)
		return
	}
	c.searchPage(key, p)
}
```

page 和 node

> Once the position is found, the bucket materializes the underlying page and the page’s parent pages into memory as “nodes”

Bucket 的数据结构

```go
// Bucket represents a collection of key/value pairs inside the database.
type Bucket struct {
	*bucket
	tx       *Tx                // the associated transaction
	buckets  map[string]*Bucket // subbucket cache
	page     *page              // inline page reference
	rootNode *node              // materialized node for the root page.
	nodes    map[pgid]*node     // node cache
	// Sets the threshold for filling nodes when they split. By default,
	// the bucket will fill to 50% but it can be useful to increase this
	// amount if you know that your write workloads are mostly append-only.
	//
	// This is non-persisted across transactions so it must be set in every Tx.
	FillPercent float64
}
```

bucket 的数据结构

```go
// bucket represents the on-file representation of a bucket.
// This is stored as the "value" of a bucket key. If the bucket is small enough,
// then its root page can be stored inline in the "value", after the bucket
// header. In the case of inline buckets, the "root" will be 0.
type bucket struct {
	root     pgid   // page id of the bucket's root-level page
	sequence uint64 // monotonically incrementing, used by NextSequence()
}
```

继续过 Cursor 的 search 实现: 根据 pageid 获取到 page 或者 node，如果是 page 类型且为 branch or leaf page 则记录到 Cursor 遍历过的 stack 中，否则 panic；node 类型直接记录；判断是否为 leaf (page or node)，是的话，在其中 nsearch(key)；nsearch 取出 stack 中最后一个 ele，如果 node 不为空，则搜索 node 中的 inode，是否存在该 key

```go
if n != nil {
	// 二分查找；如果没找到返回 len(n.inodes)
	index := sort.Search(len(n.inodes), func(i int) bool {
		// <
		return bytes.Compare(n.inodes[i].key, key) != -1
	})
	e.index = index
	return
}
```

page 类型的话，将 ptr 转换为 *[0x7FFFFFF]leafPageElement 数组，即 inodes，在其中二分搜索 key 值

```go
inodes := p.leafPageElements()
index := sort.Search(int(p.count), func(i int) bool {
	return bytes.Compare(inodes[i].key(), key) != -1
})
e.index = index
```

如果 ele 不是 leaf 元素的话，那么只能继续从 node 中查找了 c.searchNode(key, n)

看到这里，记录下 node 的数据结构，越来越接近 B+ tree 的真相了

```go
// node represents an in-memory, deserialized page.
type node struct {
	bucket     *Bucket
	isLeaf     bool
	unbalanced bool
	spilled    bool
	key        []byte
	pgid       pgid
	parent     *node
	children   nodes
	inodes     inodes
}
```

node 树状关系如图，直觉其中的 pgid 对应的是底层的 page，即 mmap db 文件出来的 byte[] array 中的一块

![node-graph](/images/node-graph.jpeg)

node 的 inodes 数目存储在 page.count 中，下面的代码从 read 中摘出

```go
// read initializes the node from a page.
func (n *node) read(p *page) {
	...
	n.inodes = make(inodes, int(p.count))
	...
}
```

branchPage 中只有 key; leafPage 中有 key 和 value

node 中的 key 存储着其第一个 inode 的 key 值；当然如果其没有 inode 则为 nil

```go
// Save first key so we can find the node in the parent when we spill.
if len(n.inodes) > 0 {
	n.key = n.inodes[0].key
	_assert(len(n.key) > 0, "read: zero-length node key")
} else {
	n.key = nil
}
```

node split，将 inodes 拆分至符合 fillPercent，parent node 的 inodes 也需要添加这些拆分出来的 nodes；还不是特别理解，这么下去的话 root node 岂不是包含所有的 inode，B+ tree 是这么设计的？还不是特别明白
