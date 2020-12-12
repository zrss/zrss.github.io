---
title: warning-log-about-etcd
abbrlink: 2a0d5b3c
date: 2017-10-27 15:49:35
tags:
    - etcd-v3
    - ops
---

# wal fsync delay warning

对于 leader 来说，可以先行向 follower 发送 messages，再进行 wal 的写入等后续持久化操作，最后 n.advance

对于 follower 来说，必须进行 wal 的写入等持久化操作后，才能向其他成员发送 messages，最后 n.advance

wal 的 fsync 调用

```go
mustSync := mustSync(st, w.state, len(ents))
func mustSync(st, prevst raftpb.HardState, entsnum int) bool {
	// Persistent state on all servers:
	// (Updated on stable storage before responding to RPCs)
	// currentTerm
	// votedFor
	// log entries[]
	return entsnum != 0 || st.Vote != prevst.Vote || st.Term != prevst.Term
}
```

看的出来 **fsync 调用很频繁**，每次写入都有 fsync 调用，毕竟每次写入时 entsnum 不为 0

fsync 的对象为最新的 wal 文件

```go
start := time.Now()
err := fileutil.Fdatasync(w.tail().File)
duration := time.Since(start)
if duration > warnSyncDuration {
	plog.Warningf("sync duration of %v, expected less than %v", duration, warnSyncDuration)
}
```

**fsync 调用时间超过 1s 会告警**，磁盘 IO 有波动了 or 不满足要求

# boltdb apply delay warning

wal 写完，raft 协议走通，可同步数据后 apply 数据到本地存储

```go
s.applySnapshot(ep, apply)
st := time.Now()
s.applyEntries(ep, apply)
d := time.Since(st)
entriesNum := len(apply.entries)
if entriesNum != 0 && d > time.Duration(entriesNum)*warnApplyDuration {
	plog.Warningf("apply entries took too long [%v for %d entries]", d, len(apply.entries))
	plog.Warningf("avoid queries with large range/delete range!")
}
```

平均 apply 一个 entry 耗时 100ms，**如果 apply 总时间超过 n * 100ms 则告警**

比如 put 请求，最后调到 kvstore.go 的 put 方法，kvindex (B tree) 中搜索一把，再用 boltdb tx 写入一把，kvindex 增加一把，有 lease 的加 lease

当然上述的都是耗时，只不过 boltdb put 的耗时一般而言比其他的操作都大

# leader send out heartbeat delay warning

在 r.sendMessages(rd.Messages) 方法中，也会打印延时告警日志

```go
// a heartbeat message
if ms[i].Type == raftpb.MsgHeartbeat {
	// exceed maxDuration time
	ok, exceed := r.td.Observe(ms[i].To)
	if !ok {
		// TODO: limit request rate.
		plog.Warningf("failed to send out heartbeat on time (exceeded the %v timeout for %v)", r.heartbeat, exceed)
		plog.Warningf("server is likely overloaded")
	}
}
```

这个地方的算法，是超过 2*hearbeat 时间作为 exceed 时间

leader 将这些 Message 先行发送给 followers，如果是心跳消息，则计算当前时间 - 上次记录的时间是否超过了 2*hearbeat，如果是，则打印超过的值；需注意该值如果接近或超过了 election timeout 时间，则会引发其他成员发起选举，导致集群不稳定

一般这个告警，是由 wal fsync delay 诱发的，而 wal fsync delay 又与磁盘 IO 有关；另外 apply 不是也有 delay 的 warning ？为啥它的影响不大，答：因为 apply 会走 fifo 的调度，是异步的；当然也是有影响的，总会影响整体时延

```go
case ap := <-s.r.apply():
	f := func(context.Context) { s.applyAll(&ep, &ap) }
    sched.Schedule(f)
```

放入队列就跑

```go
// Schedule schedules a job that will be ran in FIFO order sequentially.
func (f *fifo) Schedule(j Job) {
	...
	f.pendings = append(f.pendings, j)
	...
}
```

# the clock difference againset peer is too high warning

peer 间计算时差大于 1s 告警，ps: 当前 peer 比对端 peer 时间大

etcd 会将其每个 peer 加入到 probe 中，定时发起 get 请求，一方面可以探测 peer health 另一方面通过其返回值，计算 peer 之间的时间差；没发现该 warning 会对业务造成影响；还没过代码，和时间相关的实现也就 lease 了，暂且推测 lease 用的是逻辑时钟，所以没影响

```go
func monitorProbingStatus(s probing.Status, id string) {
	...
	if s.ClockDiff() > time.Second {
		plog.Warningf("the clock difference against peer %s is too high [%v > %v]", id, s.ClockDiff(), time.Second)
	}
	rtts.WithLabelValues(id).Observe(s.SRTT().Seconds())
	...
}
```

probe (4s) 及 monit (30s) 周期

```go
proberInterval           = ConnReadTimeout - time.Second (5 - 1)
statusMonitoringInterval = 30 * time.Second
```

开始记录值，start 为本次开始 probe 的时间，hh.Now 为对端 peer 返回的时间

```go
α = 0.125
s.record(time.Since(start), hh.Now)
```

时差计算方法

```go
// srtt init 0
func (s *status) record(rtt time.Duration, when time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.total += 1
	s.health = true
	s.srtt = time.Duration((1-α)*float64(s.srtt) + α*float64(rtt))
	s.clockdiff = time.Now().Sub(when) - s.srtt/2
	s.err = nil
}
```

大概来说就是 local time 减掉 peer time，再减修正时间
