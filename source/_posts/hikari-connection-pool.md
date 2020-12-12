---
title: hikari connection pool
abbrlink: 27a23804
date: 2019-09-14 10:25:47
tags: db
---

# hikari 轻量级数据库连接池

https://github.com/brettwooldridge/HikariCP/wiki/About-Pool-Sizing#limited-resources

这句话挺有趣，言简意赅

> More threads only perform better when blocking creates opportunities for executing.

**hikari 的理念，connections 并非越多越好，相反，可能只需要少量；太多的 connections 反而会导致性能下降**

一般而言，一个数据库操作由一个线程执行；而 CPU 一个核心，同时只能执行一个线程

基于该前提，在没有 IO 阻塞的情况，即线程只要启动，就能一直在处理工作，那多线程 (多 connections)，并不能提高性能

如果有 IO 阻塞等情况，使得线程在自己的时间片中，不能充分使用 CPU core，这样通过线程切换技术，可以提高 CPU core 的使用率，最终来看提高了性能 (吞吐量)

因此 PostgresSQL 项目给出了一个连接数计算的参考公式

```
connections = ((core_count * 2) + effective_spindle_count)
```

> Effective spindle count is zero if
> the active data set is fully cached, and approaches the actual number of spindles
> as the cache hit rate falls

effective_spindle_count 即 IO 等待时间的估计值

# hikari 特殊的优化手段介绍

https://github.com/brettwooldridge/HikariCP/wiki/Down-the-Rabbit-Hole

* 修改代码: 生成更优的字节码
* 实现特定的数据结构: 更好的性能

# 连接池的一些问题

https://github.com/brettwooldridge/HikariCP/wiki/About-Pool-Sizing#pool-locking

## 一个线程获取多个数据库连接（饿死）

可能的优化方案

* 设置保证不会出现饿死情况的 pool size = Tn x (Cm - 1) + 1, Tn 为线程数, Cm 为每个线程最大获取的连接数
* 如果当前线程已经获取过数据库连接，再调用 getConnection 时，返回该线程当前的 connection，而不是返回新的 connection

# hikari 的一些配置项

https://github.com/brettwooldridge/HikariCP#configuration-knobs-baby

**leakDetectionThreshold**: connection 泄漏告警，getConnection 后，在 leakDetectionThreshold 时间前，未调用 close 方法，会日志打印告警

慢 SQL (10s 以上执行时间) 会导致该告警

**idleTimeout** = idleTimeout = 600s

> This property controls the maximum amount of time that a connection is allowed to sit idle in the pool

此属性控制允许连接在池中空闲的最长时间，即空闲超过该时间后，该 Connection 将被 softEvictConnection

**maxLifetime** = maxLifetime = 1800s

Hikari 新建 connection 时，使用 houseKeeperExecutor 线程池执行，maxLifeTime 后触发 softEvictConnection

maxLifetime 需要结合 DB 的 connection timeout 设置

maxLifetime 加了 2.5% 的抖动，防止同一时间有大量的 Connections 被关闭

**maximumPoolSize** = maximumPoolSize = 10

> This property controls the maximum size that the pool is allowed to reach, including both idle and in-use connections. Basically this value will determine the maximum number of actual connections to the database backend.

决定了最大 Connections 数 (idle and in-use)

**minimumIdle** = maximumPoolSize

需要维持的最小 idle Connections 数

**validationTimeout** = 5s

> This property controls the maximum amount of time that a connection will be tested for aliveness.

getConnection 时会判断 Connection aliveness，设置检测 aliveness 的超时时间

**connectionTimeout** = 30s

> This property controls the maximum number of milliseconds that a client (that’s you) will wait for a connection from the pool.

getConnection 的超时时间

# 与 Scala Slick 结合

增加 slick-hikari 依赖

http://slick.lightbend.com/doc/3.2.1/gettingstarted.html#adding-slick-to-your-project

增加 typesafe config 配置项

http://slick.lightbend.com/doc/3.2.1/database.html#connection-pools

注意到 slick 将 hikari 的初始化方法封装了一层，另外该文档有一些错误，建议直接参考 hikari 的 readme.md 说明，也没几个核心参数

http://slick.lightbend.com/doc/3.2.1/api/index.html#slick.jdbc.JdbcBackend$DatabaseFactoryDef@forConfig(String,Config,Driver,ClassLoader):Database

Slick 这个 O (or function) RM 怎么说呢，一言难尽，表达式太弱 (当然可能是我不熟悉如此灵魂的 function 写法)，生成的 SQL 语句非最优。举个例子

```sql
select count(1), count(distinct job_name), * from A, B, C
```

就没法实现，要么写成子查询，要么只能分开并发执行，or 直接写 sql 语句 …

## 线程池

注意到 slick 维护一个内部线程池，用于执行数据库相关的异步操作，通过 numThreads 参数指定最大线程数

## Database.forConfig()

numThreads: 用于执行数据库相关的异步操作的线程数

maxConnections = numThreads * 5

minimumIdle = numThreads

因此以 Slick numThreads = 16 为例

* maximumPoolSize = 16 * 5 = 80
* minimumIdle = 16

# hikari summary

关键配置项

* minimumIdle 决定了连接池中的最小 idle 连接数，当 idle 连接少于该阈值时，hikari 会尽快补齐
* idleTimeout (10min) 决定了 idle 连接的存活时间
* maximumPoolSize 决定了连接池中的最大连接数
* maxLifeTime (30min) 决定了连接最大存活时间
