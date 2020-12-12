---
title: boltdb init bucket
abbrlink: 64e2c768
date: 2018-02-20 16:50:50
tags:
    - boltdb
    - etcd-v3
---

how to create a bucket in bbolt

fresh new db file

page 3 (start from 0) is a leaf page, it will be used as a root bucket

```go
type bucket struct {
    root     pgid   // page id of the bucket's root-level page
    sequence uint64 // monotonically incrementing, used by NextSequence()
}
```

```go
m.root = bucket{root: 3}
```

bucket 结构表示存储于文件中的 bucket

另外 tx 会关联一个 Bucket 结构体

```go
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

可见其中组合了 bucket 结构体

写事务在初始化时，会使用 meta 锁，锁定住 meta 页的修改；随后将 meta 页拷贝至写事务内部存储；而实际上写事务开启时，会使用 rwlock，因此写事务并不会并发，另仅有写事务会修改 meta 页，所以此处的 meta 页拷贝存疑，似乎没必要

init 方法为 beginTX 内部执行，读写事务都会执行，因此虽然写事务无需 copy meta page 然而读事务需要，因为写事务 commit 之后，会修改 meta page

完成 meta 页的拷贝后，将 tx 的 root (Bucket) 初始化，并设置其 root bucket 为 meta 中的 root bucket; 第一个写事务的 txid 为 2，0、1 用于设置两个 meta 页

```go
for i := 0; i < 2; i++ {
    p := db.pageInBuffer(buf[:], pgid(i))
    p.id = pgid(i)
    p.flags = metaPageFlag
    // Initialize the meta page.
    m := p.meta()
    m.magic = magic
    m.version = version
    m.pageSize = uint32(db.pageSize)
    m.freelist = 2
    m.root = bucket{root: 3}
    m.pgid = 4
    m.txid = txid(i) // 0 1 txid used
    m.checksum = m.sum64()
}
```

create bucket 时 cursor 从 root bucket page 开始遍历 bucket name 应存放的适当位置

branch page 节点 / leaf page 节点

数据存放于 leaf page 节点中

存储于文件中的为 page，内存中的为 node，从文件中读取到的 page 会 materialed 为内存中的 node
