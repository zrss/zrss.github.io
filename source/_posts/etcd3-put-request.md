---
title: ETCD V3 如何完成一次 put 请求
abbrlink: 3869686e
date: 2017-10-04 23:00:55
tags: etcd-v3
---

etcd 完成一次写入需要经过哪些过程？

implementation of put grpc request

key.go

```go
func (s *kvServer) Put(ctx context.Context, r *pb.PutRequest) (*pb.PutResponse, error)
```

v3_server.go

```go
func (s *EtcdServer) Put(ctx context.Context, r *pb.PutRequest) (*pb.PutResponse, error)
```

v3_server.go

```go
func (s *EtcdServer) processInternalRaftRequest(ctx context.Context, r pb.InternalRaftRequest) (*applyResult, error)
```

v3_server.go

```
func (s *EtcdServer) processInternalRaftRequestOnce(ctx context.Context, r pb.InternalRaftRequest) (*applyResult, error)
```

注册一个等待 id；完成之后调用 s.w.Trigger 触发完成 or GC
ch := s.w.Register(id)

raft propose (提议写入数据)

```go
// propose PutRequest
s.r.Propose(cctx, data)
```

node.go

```
func (n *node) Propose(ctx context.Context, data []byte) error
```

n.step 往 propc 通道传入数据

node run main roop

```go
func (n *node) run(r *raft) {
    ...
  
		case m := <-propc:
			r.logger.Infof("handle propc message")
			m.From = r.id
			r.Step(m)
    ...
}
```

raft/raft.go

```go
func (r *raft) Step(m pb.Message) error {
    ...
  
	default:
		r.step(r, m)
  
  	...
}
```

r.step(r, m)

leader 和 follower 行为不同

对于 follower 来说

```go
func stepFollower(r *raft, m pb.Message) {
    ...
  
	case pb.MsgProp:
		if r.lead == None {
			r.logger.Infof("%x no leader at term %d; dropping proposal", r.id, r.Term)
			return
		}
		// forward to leader
		m.To = r.lead
		// just append to raft pb.Message ?
		r.send(m)
    
  	...
}
```

r.send(m) 只是把 message append 到 raft/raft.go 的 msgs []pb.Message 数组中，谁去消费这个 message ？

node.go

```go
func newReady(r *raft, prevSoftSt *SoftState, prevHardSt pb.HardState) Ready {
    ...
    rd := Ready{
		Entries:          r.raftLog.unstableEntries(),
		CommittedEntries: r.raftLog.nextEnts(),
		Messages:         r.msgs,
	}
  	...
}
```

Ready 又是由谁消费的？

node.go main roop

func (n node) run(r raft)

```go
func (n *node) run(r *raft) {
    ...
		if advancec != nil {
			readyc = nil
		} else {
			rd = newReady(r, prevSoftSt, prevHardSt)
			if rd.containsUpdates() {
				readyc = n.readyc
			} else {
				readyc = nil
			}
		}
  
    ...
  
        case readyc <- rd:
                  r.logger.Infof("handle ready")
                  if rd.SoftState != nil {
                      prevSoftSt = rd.SoftState
                  }
                  if len(rd.Entries) > 0 {
                      prevLastUnstablei = rd.Entries[len(rd.Entries)-1].Index
                      prevLastUnstablet = rd.Entries[len(rd.Entries)-1].Term
                      havePrevLastUnstablei = true
                  }
                  if !IsEmptyHardState(rd.HardState) {
                      prevHardSt = rd.HardState
                  }
                  if !IsEmptySnap(rd.Snapshot) {
                      prevSnapi = rd.Snapshot.Metadata.Index
                  }
                  r.msgs = nil
                  r.readStates = nil
                  advancec = n.advancec
}
```

readyc 又由谁消费呢？

实际上 readyc 是 n.readyc，所以找下 n.readyc 由谁消费即可

```
type node struct {
	...
	readyc     chan Ready
	...
}
func (n *node) Ready() <-chan Ready { return n.readyc }
```

所以我们继续追寻哪里取了 Ready() 通道

终于在

etcdserver/raft.go 中发现了

```go
func (r *raftNode) start(rh *raftReadyHandler) {
  ...
  case rd := <-r.Ready():
				if rd.SoftState != nil {
					// lead has changed
					if lead := atomic.LoadUint64(&r.lead); rd.SoftState.Lead != raft.None && lead != rd.SoftState.Lead {
						r.mu.Lock()
						r.lt = time.Now()
						r.mu.Unlock()
						// prometheus record the count of leader changes
						leaderChanges.Inc()
					}
					if rd.SoftState.Lead == raft.None {
						hasLeader.Set(0)
					} else {
						hasLeader.Set(1)
					}
					// store current seen leader
					atomic.StoreUint64(&r.lead, rd.SoftState.Lead)
					islead = rd.RaftState == raft.StateLeader
					// raft handler
					rh.updateLeadership()
				}
				if len(rd.ReadStates) != 0 {
					select {
					case r.readStateC <- rd.ReadStates[len(rd.ReadStates)-1]:
					case <-time.After(internalTimeout):
						plog.Warningf("timed out sending read state")
					case <-r.stopped:
						return
					}
				}
				raftDone := make(chan struct{}, 1)
				ap := apply{
					entries:  rd.CommittedEntries,
					snapshot: rd.Snapshot,
					raftDone: raftDone,
				}
				updateCommittedIndex(&ap, rh)
				select {
				case r.applyc <- ap:
				case <-r.stopped:
					return
				}
				// the leader can write to its disk in parallel with replicating to the followers and them
				// writing to their disks.
				// For more details, check raft thesis 10.2.1
				if islead {
					// gofail: var raftBeforeLeaderSend struct{}
					r.sendMessages(rd.Messages)
				}
				// gofail: var raftBeforeSave struct{}
				if err := r.storage.Save(rd.HardState, rd.Entries); err != nil {
					plog.Fatalf("raft save state and entries error: %v", err)
				}
				if !raft.IsEmptyHardState(rd.HardState) {
					proposalsCommitted.Set(float64(rd.HardState.Commit))
				}
				// gofail: var raftAfterSave struct{}
				if !raft.IsEmptySnap(rd.Snapshot) {
					// gofail: var raftBeforeSaveSnap struct{}
					if err := r.storage.SaveSnap(rd.Snapshot); err != nil {
						plog.Fatalf("raft save snapshot error: %v", err)
					}
					// gofail: var raftAfterSaveSnap struct{}
					r.raftStorage.ApplySnapshot(rd.Snapshot)
					plog.Infof("raft applied incoming snapshot at index %d", rd.Snapshot.Metadata.Index)
					// gofail: var raftAfterApplySnap struct{}
				}
				r.raftStorage.Append(rd.Entries)
				if !islead {
					// gofail: var raftBeforeFollowerSend struct{}
					r.sendMessages(rd.Messages)
				}
				raftDone <- struct{}{}
				r.Advance()
  ...
}
```

该部分会将 apply 的 message 放入 applc 通道中，最终由

server.go

```go
func (s *EtcdServer) run() {
  ...
  case ap := <-s.r.apply():
			f := func(context.Context) { s.applyAll(&ep, &ap) }
			sched.Schedule(f)
  ...
}
```

做持久化，并且 trigger 写入结束
