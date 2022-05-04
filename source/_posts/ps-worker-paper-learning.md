---
title: ps-worker-paper
tags:
  - docker
date: 2022-05-03 10:00:00
abbrlink: dc51ca39
---

> https://www.bilibili.com/video/BV1YA4y197G8?spm_id_from=333.337.search-card.all.click
> 
> https://www.usenix.org/system/files/conference/osdi14/osdi14-paper-li_mu.pdf

https://github.com/dmlc/ps-lite

总结李沐大神 ps-worker 的论文实现要点如下

# server 高可用

1. 多副本复制: 例如每次对 server 的修改或写入，均会复制到两个其他副本后再回复 ok。当然这会增加延迟，以及要求客户端错误重试
1. 一致性哈希: key-value datastore, improve load balancing and recovery

> https://memcached.org/ 也采用了类似的高可用策略

# server 一致性

1. vector clock，记录时间点 (t) 发出的权重 (w) 的数据，使用 vector clock 便于实现各种一致性模型，given the potentially complex task dependency graph and
the need for fast recovery

# worker 高可用

论文中提到

* 一般而言 worker 仅负责部分数据的计算，而部分数据往往不至于对模型的最终效果有很大影响
* 假若每个 worker 数据量较大，恢复 worker 的代价较高，还不如恢复 server

所以 worker 的高可用，还是交由算法设计者控制。可能算法设计者更愿意实现即使 worker 挂了，模型训练依然能够运行下去的算法

# summary

parameter server 综合利用了现有技术（交叉），是领域型的 memcached/redis (这两都是 kv datastore)。当然 ps 是面向机器学习算法设计的，通过优化机器学习算法，使其适应 ps api，，解决了机器学习领域大规模训练的实际（工业界）问题

> The novelty of the proposed system lies in the synergy achieved by picking the right systems techniques, adapting them to the machine learning algorithms, and modifying the machine learning algorithms to be more systemsfriendly. In particular, we can relax a number of otherwise hard systems constraints since the associated machine learning algorithms are quite tolerant to perturbations. The consequence is the first general purpose ML system capable of scaling to industrial scale sizes
