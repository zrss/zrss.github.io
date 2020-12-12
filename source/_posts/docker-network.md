---
title: docker network
abbrlink: ac75c7e9
date: 2018-12-02 11:31:11
tags:
---

# Docker Network

IBM 的几篇 Blog overall 的讲了一下

**容器如何访问外部网络**

通过 docker0 网桥的外发包经过 NAT 之后 src ip 变为主机 ip

**外部网络如何访问容器**

容器内的端口，可在容器启动时，通过 -p 参数映射到 host 上，这时 host 上的端口会随机分配。当然也可以通过 -p [container-port]:[host-port] 方式，指定映射到 host 的特定端口

至于实现上也较为直接，若容器有 expose 端口，则 docker 会相应启动一个 docker-proxy 监听 host 上的 host 端口 (如上述例子中的 host-port)，外部流量到达 host-port 时，由 docker-proxy 转发至最终容器

当然上述只是 docker network 的原生实现，docker 原生实现的不同 host 的 container 略去

# Flannel

如果在 k8s 生态中，docker container 跨 host 通信，早期版本多使用 Flannel 完成

[Flannel 原理](https://www.hi-linux.com/posts/30481.html)

Flannel 实现的是 overlay network，即基于已有的 underlay network，在其之上扩展报文字段，完成报文转发

原理也比较好理解

* 在 ETCD 中设置 Flannel 网段及子网范围
* 多个 Host 上运行 Flannel daemon
* Flannel daemon 根据 ETCD 中记录的已分配子网，确定自己的子网，并注册至 ETCD 中
* Docker 根据 Flannel 划分的子网启动，docker0 地址从 Flannel 子网中分配得到，一般来说 Flannel0 地址为子网的第一个地址 (10.0.2.0)，docker0 地址为子网的第二个地址 (10.0.2.1)

VM1 Container 1 至 VM2 Container 2 的报文转发过程

[可参看该作者的一篇详细分析](https://blog.laputa.io/kubernetes-flannel-networking-6a1cb1f8ec7c)

看上述链接吧，讲的非常好，图文并茂，下面我只是自我温习 😆 努力积累

**VM1 Container 1**

* Container 1 报文中 src ip 为容器 ip，假设为 10.1.15.2/24，dst ip 为对端容器 ip，假设为 10.1.20.3/24
* 报文从容器中的 veth0 发往 host 上的 veth pair (veth_XXX)
* kernel 根据 route 表将报文转发至 Flannel0 TUN
* Flannel0 接收到之后 overlay 的作用体现了，首先根据目的 ip 查询其所在 host 的 ip，封装一层 IP 报文，随后封装一层 UDP 报文，投递到对端 Flannel daemon 监听端口 8285。这个时候报文就能通过 underlay network 转发至对端 host 了

**VM2 Container 2**

* 报文到达当前 host 后，UDP 报文交由 Flannel daemon 处理
* Flannel daemon 交由 Flannel0 TUN 处理
* kernel 直接根据 route 表处理，转发至 docker0
* docker0 是网桥设备，所有 docker container 均连接在其之上，因此最后根据 container dst ip 转发至 dst container

当然这是 Flannel 早期的版本，使用了 UDP 的报文封装，这样会有一些 packet 来回拷贝的开销

Flannel 还支持 VxLan 的模式，看下它的原理，网络这块还是比较有意思

这篇也很 nice [An illustrated guide to Kubernetes Networking [Part 2]](https://medium.com/@ApsOps/an-illustrated-guide-to-kubernetes-networking-part-2-13fdc6c4e24c)

nice shot [An illustrated guide to Kubernetes Networking [Part 1]](https://medium.com/@ApsOps/an-illustrated-guide-to-kubernetes-networking-part-1-d1ede3322727)

这篇非常详细 … 蛤蛤

ARP 协议

[ARP](https://www.geeksforgeeks.org/computer-network-arp-works/)

Flannel [VxLan](https://www.slideshare.net/enakai/how-vxlan-works-on-linux)

# Term

ref [Han’s blog](https://blog.laputa.io/kubernetes-flannel-networking-6a1cb1f8ec7c)

* TUN is a software interface implemented in linux kernel, it can pass raw ip packet between user program and the kernel
