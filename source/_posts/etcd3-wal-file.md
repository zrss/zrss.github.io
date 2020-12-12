---
title: ETCD V3 中的 .wal 文件
abbrlink: 8cdb9b5c
date: 2017-10-03 22:50:39
tags: etcd-v3
---

> etcd v3.1.9

.wal 文件，即 write ahead log，wal 的实现集中在 wal 目录下

# 消息类型

其中 wal/walpb 目录下定义了 wal 中记录的两种消息类型： Record 和 Snapshot

```
message Record {
	optional int64 type  = 1 [(gogoproto.nullable) = false];
	optional uint32 crc  = 2 [(gogoproto.nullable) = false];
	optional bytes data  = 3;
}
message Snapshot {
	optional uint64 index = 1 [(gogoproto.nullable) = false];
	optional uint64 term  = 2 [(gogoproto.nullable) = false];
}
```

用 pb 比较省事儿，不用自己实现对象序列化反序列化的逻辑

# 创建方法

wal 有两个方法会创建 wal 文件，一个是 Create 方法，另一个是 cut 方法
Create 方法会创建初始 wal 文件，名称为 0000000000000000-0000000000000000.wal

```
p := filepath.Join(tmpdirpath, walName(0, 0))
```

查看 Create 创建初始 wal 文件的过程

```go
// keep temporary wal directory so WAL initialization appears atomic
tmpdirpath := filepath.Clean(dirpath) + ".tmp"
// 生成初始 wal 文件名
p := filepath.Join(tmpdirpath, walName(0, 0))
// 系统调用 LockFile
// 防止被 purge
f, err := fileutil.LockFile(p, os.O_WRONLY|os.O_CREATE, fileutil.PrivateFileMode)
if err != nil {
	return nil, err
}
// 不是很理解这个地方为何要 seek 到文件末尾
if _, err = f.Seek(0, os.SEEK_END); err != nil {
	return nil, err
}
// 预分配 wal 文件空间
// SegmentSizeBytes = 64 * 1024 * 1024
// 即 64 MB
if err = fileutil.Preallocate(f.File, SegmentSizeBytes, true); err != nil {
	return nil, err
}
...
// 将 wal 文件加入 locks slice 中
w.locks = append(w.locks, f)
// 写入初始信息 ...
if w, err = w.renameWal(tmpdirpath); err != nil {
  	return nil, err
}
```

w.renameWal(tmpdirpath) 值得抽出来说下

```go
// 删除原 wal path
if err := os.RemoveAll(w.dir); err != nil {
	return nil, err
}
// 将 tmp wal path -> wal path
if err := os.Rename(tmpdirpath, w.dir); err != nil {
	return nil, err
}
// 在这里初始化 FilePipeline
w.fp = newFilePipeline(w.dir, SegmentSizeBytes)
df, err := fileutil.OpenDir(w.dir)
w.dirFile = df
return w, err
```

初始写入 wal 内容示意如下

![initial_wal](./uploads/initial_wal.jpg)

# 预分配空间

在 unix OS 上，首先会使用系统调用 Fallocate 预分配文件空间

如果 Fallocate 失败，则 fallback 到 preallocExtendTrunc 再次尝试分配

查看 preallocExtendTrunc 的逻辑

```go
// 移动到文件的当前读写位置，返回 offset
// 一般 curOff = 0
curOff, err := f.Seek(0, os.SEEK_CUR)
if err != nil {
  	return err
}
// 从当前文件的末尾处，移动至 +sizeInBytes 位置处，返回 offset
// 一般 size = 067108864
// 即 sizeInBytes 的值 64 * 1024 *1024
size, err := f.Seek(sizeInBytes, os.SEEK_END)
if err != nil {
  	return err
}
// 移动回文件之前的读写位置，待后续写入
if _, err = f.Seek(curOff, os.SEEK_SET); err != nil {
  	return err
}
// 已分配足够空间，返回 nil
// 一般 sizeInBytes == size
if sizeInBytes > size {
  	return nil
}
// 多分配了空间，以 sizeInBytes 截断文件
// truncate 之后，文件大小才显示为 sizeInBytes 大小
return f.Truncate(sizeInBytes)
```

在 darwin OS 上，首先会调用 preallocFixed，该函数中使用了系统调用 SYS_FCNTL 预先分配文件空间

如果 preallocFixed 失败，则调用 preallocExtendTrunc 再次尝试分配

# 编码 / 解码

wal/encoder.go 实现了写入逻辑
wal/decoder.go 实现了读取逻辑

# File Pipeline

wal/file_pipeline.go 用来预创建文件，为后续生成新的 wal 文件使用

fp.Open() 在 cut 方法中被调用，cut 中的调用如下

```go
// create a temp wal file with name sequence + 1, or truncate the existing one
newTail, err := w.fp.Open()
if err != nil {
	return err
}
```

而 fp.Open() 从 fp.filec 中获取 locks file 返回

在初始化 file pipeline 方法 newFilePipeline 中启动 fp.run() 协程，查看 fp.run() 实现

```go
func (fp *filePipeline) run() {
	defer close(fp.errc)
	for {
		f, err := fp.alloc()
		if err != nil {
			fp.errc <- err
			return
		}
		select {
		// fp.filec 大小为 1
		case fp.filec <- f:
		case <-fp.donec:
			os.Remove(f.Name())
			f.Close()
			return
		}
	}
}
```

查看 fp.alloc() 方法

```go
func (fp *filePipeline) alloc() (f *fileutil.LockedFile, err error) {
	// count % 2 so this file isn't the same as the one last published
	fpath := filepath.Join(fp.dir, fmt.Sprintf("%d.tmp", fp.count%2))
	if f, err = fileutil.LockFile(fpath, os.O_CREATE|os.O_WRONLY, fileutil.PrivateFileMode); err != nil {
		return nil, err
	}
	if err = fileutil.Preallocate(f.File, fp.size, true); err != nil {
		plog.Errorf("failed to allocate space when creating new wal file (%v)", err)
		f.Close()
		return nil, err
	}
	fp.count++
	return f, nil
}
```

可见预生成了 [0-1].tmp 文件，并对该文件加了锁，待调用 fp.Open() 方法获取使用

# Cut 方法

wal 文件大小上限为 64MB

因此当写入消息之后， wal 文件大小 > 64MB 时，会调用 cut 方法

截断之前的 wal 文件，并生成新的 wal 文件用于写入

cut 的整体思路

1. 截断当前使用的 wal 文件
1. 从 file pipeline 中获取 tmp 文件
1. 向 tmp 文件中写入必要的 headers
1. 将 tmp 文件 rename to wal 文件，新文件名为 walName(w.seq()+1, w.enti+1)
1. 将新 wal 文件加入 locks slice 中，并生成 newFileEncoder 用于写入新 wal 文件

详细阅读 cut 方法（保留了原注释）

```go
// cut closes current file written and creates a new one ready to append.
// cut first creates a temp wal file and writes necessary headers into it.
// Then cut atomically rename temp wal file to a wal file.
func (w *WAL) cut() error {
       // close old wal file; truncate to avoid wasting space if an early cut
       // 从 locks slice 中取最后一个 file
       // seek 到当前读写位置
       off, serr := w.tail().Seek(0, os.SEEK_CUR)
       if serr != nil {
              return serr
       }
       // 截断至当前读写位置
       if err := w.tail().Truncate(off); err != nil {
              return err
       }
       // 系统调用 fsync 落盘
       if err := w.sync(); err != nil {
              return err
       }
	   
       // 生成新的 wal 文件名
       // seq + 1
       // index + 1
       fpath := filepath.Join(w.dir, walName(w.seq()+1, w.enti+1))
       // create a temp wal file with name sequence + 1, or truncate the existing one
       // 从 filePipeline 中获取预创建好的 [0-1].tmp 文件
       newTail, err := w.fp.Open()
       if err != nil {
              return err
       }
       // update writer and save the previous crc
       // 添加至 locks slice 末尾
       w.locks = append(w.locks, newTail)
       prevCrc := w.encoder.crc.Sum32()
       w.encoder, err = newFileEncoder(w.tail().File, prevCrc)
       if err != nil {
              return err
       }
  
       // 写入之前 wal 的 crc
       if err = w.saveCrc(prevCrc); err != nil {
              return err
       }
       // 写入 metadata
       if err = w.encoder.encode(&walpb.Record{Type: metadataType, Data: w.metadata}); err != nil {
              return err
       }
       // 写入 raft HardState
       if err = w.saveState(&w.state); err != nil {
              return err
       }
       // atomically move temp wal file to wal file
       // fsync 落盘
       if err = w.sync(); err != nil {
              return err
       }
		
       // 获取当前位置 offset
       off, err = w.tail().Seek(0, os.SEEK_CUR)
       if err != nil {
              return err
       }
       
       // 同一个文件系统相当于 mv
       if err = os.Rename(newTail.Name(), fpath); err != nil {
              return err
       }
       // fsync 父目录
       if err = fileutil.Fsync(w.dirFile); err != nil {
              return err
       }
	   
       // 关闭 filePipeline 打开的 newTail
       newTail.Close()
		
       // 重新加锁
       if newTail, err = fileutil.LockFile(fpath, os.O_WRONLY, fileutil.PrivateFileMode); err != nil {
              return err
       }
       
       // off, err = w.tail().Seek(0, os.SEEK_CUR)
       // 重新设置下次读写位置为当前位置
       if _, err = newTail.Seek(off, os.SEEK_SET); err != nil {
              return err
       }
       w.locks[len(w.locks)-1] = newTail
       
       // 莫名，直接使用之前的 prevCrc 不可以么
       prevCrc = w.encoder.crc.Sum32()
       w.encoder, err = newFileEncoder(w.tail().File, prevCrc)
       if err != nil {
              return err
       }
       plog.Infof("segmented wal file %v is created", fpath)
       return nil
}
```

所以 cut 方法初始写入 wal 的内容示意如下

![cut_wal](./uploads/cut_wal.jpeg)

# Sync 方法

在 wal 中有如下几个地方使用了 sync 方法

1. func (w *WAL) Save(st raftpb.HardState, ents []raftpb.Entry) error {}
1. func (w *WAL) cut() error {}
1. func (w *WAL) SaveSnapshot(e walpb.Snapshot) error {}
1. func (w *WAL) Close() error {}

sync 直接来说是使用了系统调用 fsync，确保数据写入磁盘持久化

```go
func (w *WAL) sync() error {
	if w.encoder != nil {
		if err := w.encoder.flush(); err != nil {
			return err
		}
	}
	// 记录开始时间
	start := time.Now()
    
	// 底层是系统调用
	err := fileutil.Fdatasync(w.tail().File)
	
	// 计算 fsync 耗时
	duration := time.Since(start)
	// 大于 1s 告警
	if duration > warnSyncDuration {
		plog.Warningf("sync duration of %v, expected less than %v", duration, warnSyncDuration)
	}
	syncDurations.Observe(duration.Seconds())
	return err
}
```

重点看下 func (w *WAL) Save(st raftpb.HardState, ents []raftpb.Entry) error 方法，毕竟它调用频率较高

```go
func (w *WAL) Save(st raftpb.HardState, ents []raftpb.Entry) error {
	...
	mustSync := mustSync(st, w.state, len(ents))
	//func mustSync(st, prevst raftpb.HardState, entsnum int) bool {
	//	return entsnum != 0 || st.Vote != prevst.Vote || st.Term != prevst.Term
	//}
	...
	curOff, err := w.tail().Seek(0, os.SEEK_CUR)
	if err != nil {
		return err
	}
	if curOff < SegmentSizeBytes {
		if mustSync {
			return w.sync()
		}
		return nil
	}
	return w.cut()
}
```

从上： vote / term 变化，或有 entries 要写入时，调用 w.sync
