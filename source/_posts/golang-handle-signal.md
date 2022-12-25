---
title: golang handle signals
tags:
  - golang
abbrlink: fee9442e
date: 2022-12-25 15:00:00
---

https://pkg.go.dev/os/signal#hdr-Default_behavior_of_signals_in_Go_programs

https://pkg.go.dev/os/signal#hdr-Changing_the_behavior_of_signals_in_Go_programs


> By default, a synchronous signal is converted into a run-time panic. A SIGHUP, SIGINT, or SIGTERM signal causes the program to exit. 
>
> Notify disables the default behavior for a given set of asynchronous signals and instead delivers them over one or more registered channels. Specifically, it applies to the signals SIGHUP, SIGINT, SIGQUIT, SIGABRT, and SIGTERM. 

但是别忘了会有 race 的情况, 下边通过 bash shell 脚本来启动 golang 进程做一个示例

test-signal

```golang
package main

import (
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	signalCh := make(chan os.Signal, 2)
	signal.Notify(signalCh, syscall.SIGINT, syscall.SIGTERM)
	fmt.Printf("notify signals\n")

	go func() {
		sig := <- signalCh
		fmt.Printf("receive signal %v\n", sig)
	}()

	fmt.Printf("wait signal\n")
	time.Sleep(time.Minute)
}
```

test1.sh

```shell
./test-signal &
pid=$!

echo "test-signal pid: $pid"

kill $pid
wait $pid

exit_code=$?
echo "test-signal exit_code: $exit_code"
```

test2.sh

```shell
./test-signal &
pid=$!

echo "test-signal pid: $pid"

# important
sleep 1
#

kill $pid
wait $pid

exit_code=$?
echo "test-signal exit_code: $exit_code"
```

test1.sh 的执行结果

```
test-signal pid: 4878
test1.sh: line 7:  4878 Terminated: 15          ./test-signal
test-signal exit_code: 143
```

test2.sh 的执行结果

```
test-signal pid: 4880
notify signals
wait signal
receive signal terminated
```

# Summary

1. golang 程序处理 TERM 信号的默认行为是退出, 且退出码为 143 (128 + 15), 15 为 TERM
2. 使用 signal.Notify 可以修改 golang 程序处理 TERM 信号的默认行为; 但是如果 golang 程序启动后过快接收到 TERM 信号 (在 signal.Notify 执行完成之前), 则会导致程序直接退出 (默认行为)
