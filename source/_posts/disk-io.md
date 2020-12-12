---
title: disk-io
abbrlink: c69c7a93
date: 2017-10-21 15:34:07
tags:
    - ops
---

现在环境中 etcd 数据目录独立挂盘，看磁盘命名应该是个 lv

df -h 查看到类似

/device-mapper

和 lvm 相关 https://wiki.archlinux.org/index.php/LVM

pvs https://linux.die.net/man/8/pvs

iotop

iotop -n 1 -b -o

iostat

监控变化

watch -n 2 -d "xxx"

自动执行

watch -n 2 "xxx"
