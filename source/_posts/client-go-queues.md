---
title: client go queues
abbrlink: 8a17de67
date: 2018-09-16 14:12:30
tags:
    - k8s
    - go
---

最近看了看 `knative-build-controller` 中使用的 workqueue，不得不说是个设计复杂

而且对于 controller 来说，非常好用的一个东西。因为 controller 中会使用到 `informer`，而 `informer` 产生的待 `reconcile` key 可以放入 workqueue 中，等待 controller 逐一处理

workqueue 的实现是由 `client-go` https://github.com/kubernetes/client-go 库提供的，目录位于 `util/workqueue`

其中 knative-build-controller 使用的为 `rate_limitting_queue.go`，也就是通过

```go
func NewRateLimitingQueue(rateLimiter RateLimiter) RateLimitingInterface {
    return &rateLimitingType{
        DelayingInterface: NewDelayingQueue(),
        rateLimiter:       rateLimiter,
    }
}
```

创建出来的 queue

使用 `default_rate_limiters.go`，也就是通过

```go
func DefaultControllerRateLimiter() RateLimiter {
    return NewMaxOfRateLimiter(
        NewItemExponentialFailureRateLimiter(5*time.Millisecond, 1000*time.Second),
        // 10 qps, 100 bucket size.  This is only for retry speed and its only the overall factor (not per item)
        &BucketRateLimiter{Limiter: rate.NewLimiter(rate.Limit(10), 100)},
    )
}
```

创建出来的 limiter，用来计算限流时间的，会取 `NewItemExponentialFailureRateLimiter` 和 `BucketRateLimiter` 中限流时间的大者

咱们重点看 queue 的实现

RateLimitingQueue 提供了 rate limit (限流) 的功能，而我们知道 knative-build-controller (当然 k8s 中许多其他的 controller 也是如此模型) 的处理模型为循环从 queue 中获取 item，并 reconcile 之

从 api 来看，`rate_limitting_queue` 组合了 `DelayingInterface` 接口，并提供了

* AddRateLimited
* Forget
* NumRequeues

方法

其中 `DelayingInterface` 接口又组合了 `Interface` 接口，并提供了

* AddAfter

方法

最后 `Interface` 接口提供基本的 queue 功能

* Add
* Len
* Get
* Done
* Shutdown
* ShuttingDown

# RateLimittingQueue

> 限流队列

## AddRateLimited

实际上是调用了限流算法，根据重试次数计算出当前限流时间，在该时间之后，再将 item 加入 queue 中

```go
func (q *rateLimitingType) AddRateLimited(item interface{}) {
    q.DelayingInterface.AddAfter(item, q.rateLimiter.When(item))
}
```

因此这个实现依赖于 DelayingQueue 的 AddAfter 方法

## Forget

这个方法有点儿特殊，Forget 是啥语义？忘了？我 item 好端端的，为啥要忘了我

😂 一开始我也是一脸懵逼，不过想想呐，咱们调用了 AddRateLimited，而这个方法在计算限流时间时，需要使用到 item 的重试次数的，没有这个重试次数，当然计算限流时间就没有意义了

所以 Forget 呢，实际上是清除 item 的重试次数，这样下次再将这个 item AddRateLimited 时，就不会受限流的影响了

Forget 在 `ItemExponentialFailureRateLimiter` 中的实现

```go
func (r *ItemExponentialFailureRateLimiter) Forget(item interface{}) {
    r.failuresLock.Lock()
    defer r.failuresLock.Unlock()
    delete(r.failures, item) // 从重试统计次数表中删除 item
}
```

以及计算限流时间的实现

```go
func (r *ItemExponentialFailureRateLimiter) When(item interface{}) time.Duration {
    r.failuresLock.Lock()
    defer r.failuresLock.Unlock()
    exp := r.failures[item] // 当 item 不在表中时，exp 为 0
    // 将重试次数设置为 1，也就是每次递增 1
    r.failures[item] = r.failures[item] + 1
    // 使用指数算法计算限流时间
    backoff := float64(r.baseDelay.Nanoseconds()) * math.Pow(2, float64(exp))
    if backoff > math.MaxInt64 {
        return r.maxDelay
    }
    calculated := time.Duration(backoff)
    if calculated > r.maxDelay {
        return r.maxDelay
    }
    return calculated
}
```

# DelayingQueue

如此我们首先查看 `DelayingInterface` 接口的实现之一 `delaying_queue.go`

我们看，这个 queue 想实现如何的功能？

AddAfter ? 所谓的在 n time 之后的再将 item 加入 queue 的功能

为了实现这个功能，首先要考虑 AddAfter 是同步的，亦或是异步的方法 ?

当前实现是异步的方法

## AddAfter

计算出 readyAt 时间，将该时间与 item 一并存入 waitingForAddCh，这个 ch 的大小为 1000，也就是说未达到 1000 时，AddAfter 是不会被阻塞的

细心的同学可能会问，如果 AddAfter 的时间为 0 甚至为负怎么办，当然这种情况直接加入 queue 即可，就不需要再加入 waitingForAddCh 了

## waitingLoop

当然为了实现 AddAfter 这个功能，免不了 queue 需要做一些额外的维护事情，最重要的就是 queue 初始化时，开始用协程执行 waitingLoop 方法

这个方法是实现 `delaying_queue` 功能的核心逻辑

注意到待加入 queue 的 item 位于 `waitingForAddCh` 中，`waitingLoop` 当可以从 `waitingForAddCh` 获取到 item 时

```go
case waitEntry := <-q.waitingForAddCh:
    if waitEntry.readyAt.After(q.clock.Now()) {
        insert(waitingForQueue, waitingEntryByData, waitEntry)
    } else {
        q.Add(waitEntry.data)
    }
    drained := false
    for !drained {
        select {
        case waitEntry := <-q.waitingForAddCh:
            if waitEntry.readyAt.After(q.clock.Now()) {
                insert(waitingForQueue, waitingEntryByData, waitEntry)
            } else {
                q.Add(waitEntry.data)
            }
        default:
            drained = true
        }
    }
}
```

首先会判断这个 item 是否可以加入 queue 了，如果时候还没到，那么将该 item 加入以 readyAt 为排序关键的优先队列中。若时候到了，则加入 queue。处理完第一个 item 之后，会将 `waitingForAddCh` 中剩余的 item 均按照相同的逻辑处理之

这个 item 加入优先队列时，还有一个讲究的地方，注意到下述代码

```go
// insert adds the entry to the priority queue, or updates the readyAt if it already exists in the queue
func insert(q *waitForPriorityQueue, knownEntries map[t]*waitFor, entry *waitFor) {
    // if the entry already exists, update the time only if it would cause the item to be queued sooner
    existing, exists := knownEntries[entry.data]
    if exists {
        if existing.readyAt.After(entry.readyAt) {
            existing.readyAt = entry.readyAt
            heap.Fix(q, existing.index)
        }
        return
    }
    heap.Push(q, entry)
    knownEntries[entry.data] = entry
}
```

如果加入的 item 已经存在，并且新加入 item 的 readyAt 时间比已经存在的 item 的时间晚，那么不好意思哈，这个 item 会被直接丢弃。只有新加入的 item 的 readyAt 时间比已存在的 item 时间要早，才会更新已存在的 item 的 readyAt 时间，并调整 item 在优先队列中的位置

所以看到这里，delaying_queue 实际上还有**去重**功能

回到 waitingLoop 的 loop 来，loop 首先要执行的操作，即为从优先队列中依次 Peek item，即不断从优先队列中取出第一个 item，这个 item 最有可能到触发时间了

```go
// Add ready entries
for waitingForQueue.Len() > 0 {
    entry := waitingForQueue.Peek().(*waitFor)
    if entry.readyAt.After(now) {
        break
    }
    entry = heap.Pop(waitingForQueue).(*waitFor)
    q.Add(entry.data)
    delete(waitingEntryByData, entry.data)
}
```

显然如果到达了 Add 时间，那么就将其加入 queue 中，并执行一些清理工作。若终于遍历到未到触发时间的 item 了，这个时候可以退出遍历优先队列的循环了

因为这个时候，所有当前可以 Add queue 的 item 都已经处理完了，所以接下来，可以执行一段优化的逻辑，加快 item 的处理

```go
// Set up a wait for the first item's readyAt (if one exists)
nextReadyAt := never
if waitingForQueue.Len() > 0 {
    entry := waitingForQueue.Peek().(*waitFor)
    nextReadyAt = q.clock.After(entry.readyAt.Sub(now))
}
```

这个有点意思，都处理完了是吧，那我选优先队列中的第一个 item，用它的 readyAt 时间设置一个定时器，这样的话，一旦到达需要 Add 的时间，waitLoop 就会处理了 (当然用户态的程序，定时上都有些许偏差，不会特别特别精确)

都准备好之后，waitLoop 就进入等待数据/事件的逻辑了

```go
select {
case <-q.stopCh:
    return
case <-q.heartbeat.C():
    // continue the loop, which will add ready items
    // 这里是心跳，所谓的最大等待时间，目前是 10s，即如果 10s 内啥都没发生的话，也会执行一般 waitLoop 中的循环逻辑
case <-nextReadyAt:
    // continue the loop, which will add ready items
    // 这里是优先队列的第一个 item 的定时器触发了
case waitEntry := <-q.waitingForAddCh:
    // 这是我们说的，首先判断第一个 item 是否可以加入 queue
    if waitEntry.readyAt.After(q.clock.Now()) {
        insert(waitingForQueue, waitingEntryByData, waitEntry)
    } else {
        q.Add(waitEntry.data)
    }
    // 接下来会处理仍然处于 waitingForAddCh 中的 item，与上述逻辑一致
    drained := false
    for !drained {
        select {
        case waitEntry := <-q.waitingForAddCh:
            if waitEntry.readyAt.After(q.clock.Now()) {
                insert(waitingForQueue, waitingEntryByData, waitEntry)
            } else {
                q.Add(waitEntry.data)
            }
        default:
            drained = true
        }
    }
}
```

ok，至此 delaying_queue 的要点就说完了，下面提几点使用的时候的注意点，避免踩坑

* AddAfter 为异步方法，所以现象为调用 AddAfter 之后，item 并不会立即被加入到 queue 中
* AddAfter 会做去重处理，在 queue 中依然有相同的 item 时，如果新加入 item 的 readyAt time 靠后的话，新加入的 item 会被丢弃

# Queue

代码实现位于 queue.go 中

好了，在经过 DelayQueue 的延时加入策略之后，最终 item 还是被加入 queue 中的，而 queue 的实现也多有讲究，来一探究竟吧

queue 内部有两个重要的数据结构

* processing set
* dirty set

有一个比较特殊的方法

* Done

首先来看一下 queue 的 Add 方法

## Add

代码不多，直接上了

```go
func (q *Type) Add(item interface{}) {
    // cond 加锁
    q.cond.L.Lock()
    defer q.cond.L.Unlock()
    if q.shuttingDown {
        return
    }
    // 如果在 dirty set 中，那么该 item 被忽略
    if q.dirty.has(item) {
        return
    }
    q.metrics.add(item)
    // dirty set 标记
    q.dirty.insert(item)
    // 如果当前 item 仍然在处理中，则被忽略
    if q.processing.has(item) {
        return
    }
    // 加入 queue
    q.queue = append(q.queue, item)
    // 通知 cond lock 的协程
    q.cond.Signal()
}
```

## Get

> queue 的出口

```go
func (q *Type) Get() (item interface{}, shutdown bool) {
    // cond 加锁
    q.cond.L.Lock()
    defer q.cond.L.Unlock()
    // 如果 queue 为空，并且 queue 未关闭，则等待
    // 即 Get 方法在这种情况下，是阻塞的
    for len(q.queue) == 0 && !q.shuttingDown {
        q.cond.Wait()
    }
    // 这种情况是 queue 关闭的时候
    if len(q.queue) == 0 {
        // We must be shutting down.
        return nil, true
    }
    // 取 queue 中第一个 item 返回
    item, q.queue = q.queue[0], q.queue[1:]
    q.metrics.get(item)
    // 标记 item 为处理中
    q.processing.insert(item)
    // 去除 item dirty 标记
    q.dirty.delete(item)
    return item, false
}
```

看了 Add 与 Get 实现后，我们得到几个结论

* queue 也实现了去重: Add 相同 item，若该 item 未被 Get，那仅会被加入 queue 一次
* queue.Get 方法在 queue 中没数据时，是阻塞的，即你可以这写

```go
for {
    obj := queue.Get()
    // obj 一定存在
    // blabla
}
```

## Done

```go
func (q *Type) Done(item interface{}) {
    q.cond.L.Lock()
    defer q.cond.L.Unlock()
    q.metrics.done(item)
    q.processing.delete(item)
    if q.dirty.has(item) { // 如果 item 被标记为 dirty，则重新加入 queue 中
        q.queue = append(q.queue, item)
        q.cond.Signal()
    }
}
```

Done 方法会去掉 item 的 processing 标记，并且如果 item 被标记为 dirty，那会再将 item 加入 queue。有这个逻辑那我们应该如何使用 queue ?

我们首先来考虑这种场景

itemA 被 Add queue，此时 X 协程 Get 时，获取到了 itemA，在这种情况下，itemA 被标记为 processing，而没有 dirty 的标记，若此时另一 Y 协程又再次调用 Add 方法将 itemA Add queue，这时 itemA 就被标记为 dirty 了，并且因为有 processing 标记，所以并不会被加入 queue 中

过了一些时间后，X 协程执行 ok 了，调用 Done(itemA) 方法，去除 itemA 的 processing 标记，因为 itemA 为 dirty，所以将其重新加入 queue 中，等待被 Get 并处理

所以在这种场景下就好理解多了，实际上 queue 还有个特性，即 queue 中不会有重复的 item，但是仅允许 item 被 Get 之后，Done 之前，被 Add 一次，在这种情况下，Done 的时候，会重新将 item 加入 queue 中

可以理解为如果这个 item 正在被处理时，queue 允许至多缓存一次相同的 item

所以再总结一次 queue 的特性

* 添加 item 调用 Add 方法
* 获取 item 调用 Get 方法
* 处理 item 之后调用 Done 方法。否则再次 Add 相同 item 时，若该 item 仍未被 Get 则直接被忽略。若该 item 已被 Get，则被打上 dirty 标记，在其被调用 Done 时，该 item 才会被重新加入 queue 中
* 本质上 queue 中不会有重复的 item

# Summary

在看了这几种 queue 的实现之后，是否更了解 rate_limmiting_queue.go 该如何使用了？

例如在 knative-build-controller 中它被如此初始化 (天下代码一大抄)

```go
workqueue.NewNamedRateLimitingQueue(workqueue.DefaultControllerRateLimiter(), "Builds"),
```

具体使用时

```go
func (c *Controller) processNextWorkItem() bool {
    // 从 queue 中取 item
    obj, shutdown := c.workqueue.Get()
    if shutdown {
        return false
    }
    if err := func(obj interface{}) error {
        // 处理结束之后，需要调用 Done
        defer c.workqueue.Done(obj)
        
        key, ok := obj.(string)
        if !ok {
            c.workqueue.Forget(obj) // Fatal 错误，调用 Forget，没有重试的必要
            runtime.HandleError(fmt.Errorf("expected string in workqueue but got %#v", obj))
            return nil
        }
        
        if err := c.syncHandler(key); err != nil {
            // 处理失败时，不调用 Forget，增加 item 的重试次数
            return fmt.Errorf("error syncing '%s': %s", key, err.Error())
        }
        // 处理成功调用 Forget，清除 item 的重试次数，使得下次相同的 item 不受 rate limit 影响
        c.workqueue.Forget(obj)
        c.logger.Infof("Successfully synced '%s'", key)
        return nil
    }(obj); err != nil {
        runtime.HandleError(err)
    }
    return true
}
```

所以再说一遍浓缩用法

* 添加 item 调用 Add 方法
* 获取 item 调用 Get 方法
* 处理 item 之后调用 Done 方法
* 不增加 item 重试次数调用 Forget 方法

再说一遍 rate limit queue 重点，切莫踩坑

* Add 是异步方法
* Add 有去重功能
    * 先经过 DelayQueue 去重处理，对于新加入的 item，在其优先队列中依然有相同的 item 时，如果新加入 item 的 readyAt time 较原 item 的 readyAt 时间靠后的话，新加入的 item 会被丢弃
    * 再经过 Queue 去重处理，如果 queue 中有相同 item 则直接被丢弃。若 queue 中没有相同 item，但是 item 处于被处理中，即未被调用 Done 时，会将 item 标记为 dirty，待 item 被调用 Done 时，重新加入 queue
* 处理 item 结束之后，无论如何调用 Done，标识该 item 已被处理结束
* 若不需要增加 item 的重试次数，则结束之后调用 Forget 方法，清除该 item 的重试次数统计
* 如果需要调用 Forget，则先调用 Forget 再调用 Done，确保再次 Add 的时候不受限流影响

之所以关注到这个问题，是因为在写 build-controller 一个 bugfix 的 ut 时，各种坑，遂研究了下 workqueue 的细节，关于这个 bugfix 的讨论看这个链接 [Timeout of build may have problem](https://github.com/knative/build/issues/332)

Thanks for your time 😁
