---
title: mxnet debug
abbrlink: acff1ae2
date: 2019-06-01 10:42:52
tags: hpc
---

recomplie mxnet

```bash
DEBUG=1 in comfig.mk, then recompile the whole framework.
```

https://github.com/apache/incubator-mxnet/issues/6796#issuecomment-311310985

```bash
make -j $(nproc) YOU_OPTIONS will compile parallelly
gdb --args python YOU_ARGS can debug with gdb
```
