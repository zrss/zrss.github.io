---
title: Performance of golang (etcd)
abbrlink: bdc66cb7
date: 2018-08-12 15:20:27
tags: go
---

golang profiling (即剖析)，golang 原生提供了 pprof 性能分析工具

前段时间分析了一个 apiserver 处理请求性能较低的问题，正是使用了 pprof 确定了问题点，从而解决了该问题

这次使用 etcd https://github.com/coreos/etcd 来举个例子，关于 pprof 的使用及可视化，Ref 中提到了 golang 性能分析大名鼎鼎的几篇 blog，建议先行参考，看了之后会对 golang 性能分析有个 overall 的思路

此篇并无太多 creative 之处

# Show time

之前提到 golang 中自带了 pprof 采集代码，而且启用它们也非常简单

如果是一个 web server 的话，仅需要 import _ "net/http/pprof"，则会注册 pprof 相关的 handler

```go
import _ "net/http/pprof"
func main() {
    go func() {
        log.Println(http.ListenAndServe("localhost:6060", nil))
    }()
}
```

web server 启动后，即可调用 pprof 接口获取数据

```
wget http://localhost:6060/debug/pprof/profile -O profile-data
```

当然 curl 也行

```
curl http://localhost:6060/debug/pprof/profile -o profile-data
```

对于 etcd 来说，pprof 也已经集成，可通过启动参数指定开启

```
./etcd --enable-pprof
```

当然对于非 web server 类的 app，也可以使用 runtime/pprof 包中的方法输出 pprof 数据

# go tool pprof

> 以 etcd v3.1.9 为例子, go1.10

采样 10s cpu profile 数据

```
curl http://localhost:2379/debug/pprof/profile?seconds=10 -o etcd-profile-10
```

使用 go tool pprof 分析

```bash
bash-3.2$ go tool pprof $GOPATH/src/github.com/coreos/etcd/bin/etcd etcd-profile-10
File: etcd
Type: cpu
Time: Aug 12, 2018 at 11:45am (CST)
Duration: 10s, Total samples = 40ms (  0.4%)
Entering interactive mode (type "help" for commands, "o" for options)
```

注意传入对应的二进制文件，否则可能无法找到相应的方法

go tool pprof 常用命令 top / list，其中 list 方法是正则匹配的，能显示匹配上的方法的 profile 信息

# Secure of pprof

注意到之前均使用的是 http 的 Protocol 访问 pprof 接口，如果 server 是 https 该怎么办？

搜索得知 golang 很快便会支持 go tool pprof with client certificates 了

cmd/pprof: add HTTPS support with client certificates: https://github.com/golang/go/issues/20939

Support HTTPS certs, keys and CAs: https://github.com/google/pprof/pull/261

当然如果 server 不要求 client certificates 的话，可以如此使用 go tool pprof 获取数据（注意 https+insecure）

```bash
go tool pprof -seconds 5 https+insecure://192.168.99.100:32473/debug/pprof/profile
```

如果要求 client certificates 的话，亦或是日常使用时，其实也没必要直接用 go tool pprof 获取数据，使用 wget / curl 同样可以下载，下载之后再使用 go tool pprof 或者是 go-torch 分析好了

而 curl 显然是支持传入 ca.crt / tls.crt / tls.key 的

```bash
curl --cacert ca.crt --cert ./tls.crt --key tls.key https://192.168.99.100:32473/debug/pprof/profile -O profile-data
```

# Visual pprof

go tool pprof 命令行模式，并不是特别直观，如果可以图形化的展示各个方法的消耗情况，那么将能更快的确定问题所在

* graphviz

```bash
brew install graphviz
```

安装 ok graphviz 之后

```bash
bash-3.2$ go tool pprof $GOPATH/src/github.com/coreos/etcd/bin/etcd etcd-profile-10
File: etcd
Type: cpu
Time: Aug 12, 2018 at 11:45am (CST)
Duration: 10s, Total samples = 40ms (  0.4%)
Entering interactive mode (type "help" for commands, "o" for options)
(pprof) web
```

即可在浏览器中显示 .svg 文件，浏览器中 Ctrl+s 保存到本地，即可传阅

![web-pprof](./uploads/web-pprof.svg)

* go-torch

大名鼎鼎的火焰图 (flame-graph)

```
go get github.com/uber/go-torch
```

clone brandangregg 的火焰图生成脚本

```
git clone git@github.com:brendangregg/FlameGraph.git
```

生成火焰图

```bash
bash-3.2$ export PATH=$PATH:$GOPATH/src/github.com/brendangregg/FlameGraph
bash-3.2$
bash-3.2$ $GOPATH/bin/go-torch --file "torch.svg" etcd-profile-10
INFO[13:12:17] Run pprof command: go tool pprof -raw -seconds 30 etcd-profile-10
INFO[13:12:17] Writing svg to torch.svg
```

浏览器打开 torch.svg 即可

![torch](torch.svg)

个人觉得 flame-graph 更为直观，横向为各个方法消耗占比，纵向为调用栈上的各个方法消耗占比，一目了然，对应分析消耗较大的方法即可

# Ref

golang pprof https://blog.golang.org/profiling-go-programs

pprof tools http://colobu.com/2017/03/02/a-short-survey-of-golang-pprof/
