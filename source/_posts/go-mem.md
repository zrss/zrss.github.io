---
title: golang memory model
tags:
  - golang
date: 2021-12-26 21:39:00
abbrlink: dfdab12d
---

https://go.dev/ref/mem

> Note that a read *r* may observe the value written by a write *w* that happens concurrently with *r*. Even if this occurs, it does not imply that reads happening after *r* will observe writes that happened before *w*.

```golang
var a, b int

func f() {
	a = 1
	b = 2
}

func g() {
	print(b)
	print(a)
}

func main() {
	go f()
	g()
}
```

it can happen that g prints 2 and then 0.

> A send on a channel happens before the corresponding receive from that channel completes.

```golang
var c = make(chan int, 10)
var a string

func f() {
	a = "hello, world"
	c <- 0 // send on c
}

func main() {
	go f()
	<-c
	print(a)
}
```

is guaranteed to print "hello, world". The write to *a* happens before the send on *c*, which happens before the corresponding receive on *c* completes, which happens before the *print*.

The closing of a channel happens before a receive that returns a zero value because the channel is closed.

In the previous example, replacing `c <- 0` with `close(c)` yields a program with the same guaranteed behavior.

> A receive from an unbuffered channel happens before the send on that channel completes.

```golang
var c = make(chan int)
var a string

func f() {
	a = "hello, world"
	<-c
}

func main() {
	go f()
	c <- 0
	print(a)
}
```

is also guaranteed to print "hello, world". The write to a happens before the receive on *c*, which happens before the corresponding send on *c* completes, which happens before the *print*.

If the channel were buffered (e.g., c = make(chan int, 1)) then the program would not be guaranteed to print "hello, world". (It might print the empty string, crash, or do something else.)

> The kth receive on a channel with capacity C happens before the k+Cth send from that channel completes.

This program starts a goroutine for every entry in the work list, but the goroutines coordinate using the limit channel to ensure that at most three are running work functions at a time.

```golang
var limit = make(chan int, 3)

func main() {
	for _, w := range work {
		go func(w func()) {
			limit <- 1
			w()
			<-limit
		}(w)
	}
	select{}
}
```
