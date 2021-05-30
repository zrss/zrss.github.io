---
title: learning golang again
tags:
  - golang
categories: 笔记
abbrlink: 84d885dc
---

# Type size

> https://golang.org/ref/spec#Size_and_alignment_guarantees

https://github.com/ardanlabs/gotraining-studyguide/blob/master/go/language/struct.go

```
type example struct {
	flag    bool
	counter int16
	pi      float32
}
```

字节对齐系数 `#pragma pack(n)`

* 成员对齐
* 结构体对齐

对齐系数规则

> 1. For a variable x of any type: unsafe.Alignof(x) is at least 1.
> 1. For a variable x of struct type: unsafe.Alignof(x) is the largest of all the values unsafe.Alignof(x.f) for each field f of x, but at least 1.
> 1. For a variable x of array type: unsafe.Alignof(x) is the same as the alignment of a variable of the array's element type.

layout

* bool(0)
* int16(2)
* float32(4)

8 bytes

> https://eddycjy.gitbook.io/golang/di-1-ke-za-tan/go-memory-align


//TODO list

* https://draveness.me/golang/
* https://golang.design/under-the-hood/
