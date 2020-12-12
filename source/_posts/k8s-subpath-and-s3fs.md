---
title: k8s-subpath-and-s3fs
abbrlink: a1778563
date: 2020-04-05 10:11:38
tags: s3
---

k8s subPath and s3 fuse mount (s3fs)

意识流分析，致敬一个生产环境中的问题，真是看了很多代码

https://github.com/s3fs-fuse/s3fs-fuse

实现了 fuse 接口，底层对接 s3 协议

打开 s3fs info 日志，观察可知

fuse 周期性触发

1. s3fs_getattr
    1. check_object_access
        1. get_object_attribute
            1. s3 head request
    1. check_parent_object_access
1. s3fs_opendir
    1. check_object_access
        1. check_parent_object_access
1. s3fs_readdir 方法，该方法底层会调用 list_bucket func，到s3 server查询对象列表
    1. 查询到有新的对象后，会 add 到本地 stat cache，并且下载到本地

所以使用 s3fs mount s3 bucket 到本地时，s3fs 会周期性同步远端的数据到本地，写入时，也会同步到远端

```bash
kill -SIGUSR2 ${s3fs_pid}
```

可以动态调整 s3fs 日志级别，s3fs 默认日志输出到 /var/log/messages

messages.2.gz 文件解压，可以使用 `gzip -d messages.2.gz`

---

生产环境出了一个诡异的问题

server / worker 两个实例，在不同节点，挂载了同一个桶

k8s subPath 方式挂载子对象，例如 test-bucket/output1

在开始阶段 server s3fs 会上传 test-bucket/output1 文件夹，两次

而 worker s3fs 不会

debug 了一会儿，直接原因与 s3 对象的权限相关，用户创建的对象，s3fs mount 时，没权限 head，但是又能 list 到

s3fs 如果 list 该对象为非空时，可正常读写该对象下的内容，也与验证结果符合 -.0

---

分割线，前边是一些分析

k8s subPath

subPath 是相对于 volume root path 的一个 sub path，用于挂载 volume 内的子目录

实现上首先会将 volume 挂载于节点的 pod volume 路径下

1. 再去 open subPath，open 之后，成为 kubelet 进程下的一个 fd
1. 接下来创建 volume-subpaths 下的一个路径（文件名与 volumeMount index 一致），并且判断 subPath 是文件还是文件夹
    1. 文件夹，mkdir 一把
    1. 文件，写一个空文件
1. 最后将该 fd mount 到上述创建的路径中

不明点，在 1 步骤上，实际上 subPath 为 noObject；从文件系统的角度不确定它为文件夹，还是对象，而 kubelet 却执行成功了，并顺利挂载到容器中

从 s3fs 的日志，对 subPath 首先执行了

1. s3fs_mkdir，mode 0750
1. s3fs_chmod，mode 40777

即触发了两次 s3 PUT.OBJECT 的操作

这块就不深入分析了为何如此了

感叹一下，系统层层调用之后，问题定位需要极其清晰的思路，大胆假设，小心求证；解决问题的思路是第一重要的

---

另外 s3fs 1.80 版本 err ret 不打印错误信息，只打印了个 response code，这个也比较伤，建议升级到当前最新版本
s3fs 1.86，会把错误信息也打印出来
