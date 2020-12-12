---
title: boltdb-cursor
abbrlink: d7e71fec
date: 2017-10-29 15:54:07
tags:
    - boltdb
    - etcd-v3
---

cursor 从 B tree 的 root 开始，提供 B tree 的遍历和搜索实现，遍历过程记录到 stack 中

# 遍历

first / prev / next / last 的实现

first 就是不断搜索 element 的 index = 0 inode，直到 leaf page 为止

last 是不断搜索 element 的 index = the count of inodes - 1，直到 leaf page 为止

first 和 last 实现后，可相应实现 prev / next

prev 当 inode 中可 – 时则直接回退一格，若为开头 inode，则上移，再 last

next 当 inode 中可 ++ 时则直接前进一格，若为末尾 indoe，则上移，再 first

# 搜索

`func (c *Cursor) search(key []byte, pgid pgid) {}`

> nsearch(key)

如果搜到了 leaf page / node，那么就在 inodes 中搜索该 key，返回的 index 为第一个大于等于 key 的 index，若不存在返回 inodes 长度

> searchNode(key, n)

如果不是 leaf page / node，且 node 不为 nil (n)，则 searchNode；searchNode 中如果 key 相等则从该 inodes[index].pgid，继续 search(key, inodes[index].pgid)；如果 key 不相等且 index > 0，则设置为最后一个小于的 index，从该 index 继续 search

> searchPage(key, p)

实现同上述，不过是从 page 中读取

# 获取 node

根据 stack 获取 leaf node，如果已经是 node 且为 leaf 直接返回；不是的话从 stack[0] 开始，遍历到 leaf node，遍历过的 page 都读到 node 并缓存到关联的 bucket 中

获取到 node 之后就可以 put 和 del key 了

# 总结

所以 cursor 常见操作，由 bucket 创建出来，初始绑定 bucket root，从 root 开始搜索 key 值，返回后，c.node().put or del

例如看个创建 bucket 的过程

```go
// Move cursor to correct position.
c := b.Cursor()
k, _, flags := c.seek(key)
var value = bucket.write()
// Insert into node.
key = cloneBytes(key)
c.node().put(key, key, value, 0, bucketLeafFlag)
```

例如看个写入 key / value 的过程

```go
// Move cursor to correct position.
c := b.Cursor()
k, _, flags := c.seek(key)
// Return an error if there is an existing key with a bucket value.
if bytes.Equal(key, k) && (flags&bucketLeafFlag) != 0 {
    return ErrIncompatibleValue
}
// Insert into node.
key = cloneBytes(key)
c.node().put(key, key, value, 0, 0)
```
