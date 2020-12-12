---
title: Memory of Tomcat
abbrlink: d41c4586
date: 2018-08-07 15:27:27
tags:
    - java
    - tomcat
---

# top

top 按 CPU 排序

```bash
top
shift + P
```

top 按 MEM 排序

```bash
top
shift + M
```

# java utils

为 jdk 设置 JAVA_HOME
设置 jdk bin 至 PATH 中

```bash
// 查看 java 进程堆及 GC 情况
jstat
// 查看 java 进程中的线程情况
jstack
```

最后一顿排查，jstat 查看了堆内存情况，发现是 tomcat 启动参数 `-Xms -Xmx` 设置过大了，同一节点上还有其他进程，其他进程占用内存比较猛
