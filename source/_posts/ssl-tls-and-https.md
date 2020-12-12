---
title: ssl tls and https
abbrlink: b3b02fd2
date: 2017-12-03 16:46:00
tags:
    - ssl
    - tls
    - https
---

> 安全方面的姿势，掌握略有不足，趁着空闲；另外也是为了不仅仅知道，curl 命令访问 https 接口的时候，需要携带三个证书，如此模糊的解释而努力
to be cont.

搜索了一下网上已有很多现有资料，这里就重新回顾一下，当做我自己的姿势了

https://github.com/denji/golang-tls

首先看下 go 语言中，如何实现 server 端 HTTPS/TLS

http://tonybai.com/2015/04/30/go-and-https/

```go
package main
import (
    // "fmt"
    // "io"
    "net/http"
    "log"
)
func HelloServer(w http.ResponseWriter, req *http.Request) {
    w.Header().Set("Content-Type", "text/plain")
    w.Write([]byte("This is an example server.\n"))
    // fmt.Fprintf(w, "This is an example server.\n")
    // io.WriteString(w, "This is an example server.\n")
}
func main() {
    http.HandleFunc("/hello", HelloServer)
    err := http.ListenAndServeTLS(":443", "server.crt", "server.key", nil)
    if err != nil {
        log.Fatal("ListenAndServe: ", err)
    }
}
```

443 为知名的 HTTPS 服务端口，那么 server.crt、server.key 这两个文件又是如何作用，哪来的呢？

首先解释哪来的问题

使用 openssl 生成私钥

```bash
# Key considerations for algorithm "RSA" ≥ 2048-bit
openssl genrsa -out server.key 2048
```

or 使用另外一种算法生成的私钥

```bash
# Key considerations for algorithm "ECDSA" ≥ secp384r1
# List ECDSA the supported curves (openssl ecparam -list_curves)
openssl ecparam -genkey -name secp384r1 -out server.key
```

私钥生成好之后，使用私钥生成公钥（x509 自签发 crt）

> Generation of self-signed(x509) public key (PEM-encodings .pem|.crt) based on the private (.key)

```bash
openssl req -new -x509 -sha256 -key server.key -out server.crt -days 3650
```

所以呢，server.key 是私钥，server.crt 是公钥，生成之后，就可以用来初始化 TLS server 了
