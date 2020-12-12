---
title: WebSocket in Tomcat 7 (part 5)
abbrlink: 3d08d23a
date: 2018-07-15 11:24:39
tags:
    - k8s
---

Final, cheers !~

通过 part-1/2/3/4 的分析，可以确认 Server 这边的逻辑 ok，那么现在的确认问题的手段只能沿着网络路径逐级抓包了。此篇重点讲述如何在 Wireshark https://www.wireshark.org/download.html 中分析 WebSocket 流量

当然网上有挺多介绍，这里还是再说一遍，是为啥？因为其他文章大多数都是讲解的 ws:// 的，而现在我们面临的是 wss:// 的，显然有很大的不同

所以呢，简单在 display filter 中输入 websocket 是没法过滤出 WebSocket 流量的，毕竟 TLS encrypted 之后看到的全是 TCP 流量

# ENV

```
Wireshark: 2.6.1
OS: macOS Sierra 10.12.6
WebSocketSite: https://www.websocket.org/echo.html
```

# SSL decryted in WireShark

official doc：https://wiki.wireshark.org/SSL#Usingthe.28Pre.29-Master-Secret

step by step guide: https://jimshaver.net/2015/02/11/decrypting-tls-browser-traffic-with-wireshark-the-easy-way/

照着链接二配置一下即可

# Capture network trafic through WireShark

```
export SSLKEYLOGFILE=/Users/zrss/Documents/BrowserSSLKeyLog/sslkeylog.log
open -a "Google Chrome"
wireshark
```

访问 https://www.websocket.org/echo.html，loading ok 之后

开启 Wireshark 捕获当前网卡流量

单击 Connect 连接 Server WebSocket，连接建立后，发送 Rock it with HTML5 WebSocket 消息，如下图所示

![echo WebSocket](./uploads/websocket-echo.png)

停止 Wireshark 捕获，display filter 中输入 http，寻找到 info 中有 101 Web Socket Protocol Handshake 字样的报文，右键 Follow 选中 SSL Stream 即可查看 WebSocket 的流量，如下图所示

![websocket traffic](./uploads/websocket-link.png)

可见 WebSocket 为 TCP 之上与 HTTP 同层的应用层协议

* TCP 三次握手建立 TCP 连接
* SSL 握手协商加密机制
* WebSocket 握手 (HTTP Upgrade) 建立 WebSocket 连接
* 客户端 send MASKED WebSocket 上行报文
* 服务端 echo WebSocket 下行报文

另外需要注意的是在 SSL 握手协商加密机制时，服务器端选择的加密套件为 TLS_RSA_WITH_AES_128_CBC_SHA (在 Server Hello 报文中可见)

为啥提到这个算法，因为在测试的时候，一开始是使用 https://socket.io/demos/chat/ 测试的，从 Chrome F12 控制台中可以看到有两个 WebSocket 请求，然而 Wireshark 似乎只能 decrypt 其中一个请求，而该请求服务器端选择的加密套件为 TLS_AES_128_GCM_SHA256

另外一个请求 (实际上的 chat 请求) 未能 decrypt，呃，不过不知道为啥，反复尝试了几次后，啥都 decrypt 不了了

# Best Practice

所以这个 decrypt 实际上不一定靠谱，主要还是需要在生产环境上使用 tcpdump 工具抓取来自特定源 IP 的流量，然后通过与正常情况下的流量相比，识别出为 WebSocket 的流量，逐级排查，找到在哪一级组件上 WebSocket 报文丢掉即可

注意到 WebSocket RFC https://tools.ietf.org/html/rfc6455 中提到每个 WebSocket 请求均要求建立一个连接，另外从 Tomcat 7 WebSocket 实现上，可知每个 WebSocket 连接均会建立一个新的 socket 连接

因此在 Wireshark 中首先过滤出 SSL 的 Client Hello 报文

再通过 Client Hello 报文中的 srcport 字段过滤报文 (或者右键 Follow -> SSL Stream)，正常的 WebSocket 报文模式，如下

* SSL Handshake
* HTTP Upgrade
* HTTP Continuation

当然需要客户端构造容易识别的 WebSocket 流量模式，我在测试时，一般会持续输入某个字符，因此会有持续的 HTTP Continuation 报文

# Summary

WebSocket 在生产环境中使用，最好不复用 HTTPS 443 端口，即 WebSocket 使用独立的网络架构，不复用之前 HTTP 的网络架构。毕竟 HTTP 的网络路径，一路上有各种防火墙，可得小心了

另外还发现了一个有趣的项目 noVNC https://github.com/novnc/noVNC，提供了在界面上远程登录主机的功能，而我们知道大多数 VNC Server 也支持 WebSocket 协议，因此 noVNC 也使用了 WebSocket 协议传输数据，要不支持的 Server，noVNC 有一个子项目：websockify https://github.com/novnc/websockify，将 WebSocket 流量转为 Socket 流量，以兼容不支持 WebSocket 协议的 VNC Server，有时间再研究一下了

The end of WebSocket in Tomcat 7 series

# Other Ref

http://jsslkeylog.sourceforge.net/
