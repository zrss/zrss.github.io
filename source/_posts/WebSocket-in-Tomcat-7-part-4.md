---
title: WebSocket in Tomcat 7 (part 4)
abbrlink: 2413e37b
date: 2018-07-08 11:21:05
tags:
    - WebSocket
---

现在我们知道 Server 端会首先进入 onOpen 状态，随后会持续从 socket 中获取 WebSocket Frame 组装成 Message 后，回调业务层 onMessage 方法

而 Client 端在接收到 101 status code 之后，也会进入 onOpen 状态，典型的 Client 端实现如下

```java
// Create WebSocket connection.
const socket = new WebSocket('wss://remoteAddress:443');
// Connection opened
socket.addEventListener('open', function (event) {
    socket.send('Hello Server!');
});
// Listen for messages
socket.addEventListener('message', function (event) {
    console.log('Message from server ', event.data);
});
```

https://developer.mozilla.org/en-US/docs/Web/API/WebSocket

而我遇到的问题是，web terminal 一般实现，会在 onOpen 中发送一个设置 terminal size 的 message，例如 k8s 中可以发送如下消息

```javascript
// Connection opened
socket.addEventListener('open', function (event) {
    socket.send('4{"Width":80,"Height":20}');
});
```

该消息不能被立即发送，若立即发送，则会导致 Tomcat side ServerEndpoint onMessage 一直未被调用

而后端 k8s side 的数据能推送至 Client side，具体来说 Client side 能接收到 k8s side 推送回来的初始化空数据，而 Client side 发送的数据帧 ServerEndpoint onMessage 一直未被调用

说明 WebSocket 链接是没问题的，于是乎 Client 发送的数据帧被发送到了哪里？

之前的几篇讨论中，其实我是判定如果 ServerEndpoint onOpen stuck 住，会出现该问题。然而实际情况可以说明，既然后端的数据可以推送至客户端，证明 onOpen 已经执行结束

ServerEndpoint onOpen 时执行的逻辑如下

```java
static hashmap frontEndWsSessionMap;
static hashmap backEndWsSessionMap;
onOpen(session) {
    wsBackEndSession = connectToBackEnd(...);
    backEndWsSessionMap.put(wsBackEndSession.getId(), session);
    frontEndWsSessionMap.put(session.getId(), wsBackEndSession);
}
```

而通过查看代码知道 connectToBackEnd，即 Server side 实现 WebSocket 请求时，用了两个新的线程，其中一个用于接收数据，另一个用于获取数据

```java
// Switch to WebSocket
WsRemoteEndpointImplClient wsRemoteEndpointClient = new WsRemoteEndpointImplClient(channel);
WsSession wsSession = new WsSession(endpoint, wsRemoteEndpointClient,
        this, null, null, null, null, null, extensionsAgreed,
        subProtocol, Collections.<String,String>emptyMap(), secure,
        clientEndpointConfiguration);
WsFrameClient wsFrameClient = new WsFrameClient(response, channel,
        wsSession, transformation);
// WsFrame adds the necessary final transformations. Copy the
// completed transformation chain to the remote end point.
wsRemoteEndpointClient.setTransformation(wsFrameClient.getTransformation());
endpoint.onOpen(wsSession, clientEndpointConfiguration);
registerSession(endpoint, wsSession);
/* It is possible that the server sent one or more messages as soon as
 * the WebSocket connection was established. Depending on the exact
 * timing of when those messages were sent they could be sat in the
 * input buffer waiting to be read and will not trigger a "data
 * available to read" event. Therefore, it is necessary to process the
 * input buffer here. Note that this happens on the current thread which
 * means that this thread will be used for any onMessage notifications.
 * This is a special case. Subsequent "data available to read" events
 * will be handled by threads from the AsyncChannelGroup's executor.
 */
wsFrameClient.startInputProcessing();
```

链接建立之后，会立即调用 wsFrameClient.startInputProcessing(); 处理当前 response 中的数据，即调用 ClientEndpoint onMessage 方法

后续的数据处理由线程池中的读线程完成

```java
onMessage(String message, session) {
    frontEndSession = backEndWsSessionMap.get(session.getId());
    frontEndSession.getBasicRemote.sendText(message);
}
```

大致流程也是类似的，从 socketOutput 中持续获取数据，组装 okay 之后，回调 ClientEndpoint onMessage 方法

综上，上述逻辑 okay，并不是在 onOpen 中 stuck

至此与问题现象对比之后，可以认为如果问题出现 Tomcat 侧，则仅可能为 onDataAvailable 之后，一直未能从 socketInputStream 中获取到数据

如果可以抓包分析的话，抓包最为简单，之所以费这么大劲儿分析 Tomcat WebSocket 的实现，实际上是因为全是 TLS 流量，so 抓到的全是 tcp 包，根本没法区分

尝试过导入 Nginx 的私钥，也没法解，听 Nginx 的同事说是 Nginx 与 Server 之间还会动态协商一个私钥 … 醉了

如果能确定 Client 的 WebSocket 包都发送到达 Tomcat 了，这也可以确认是 Server side 的问题，然鹅

绝望 … so sad
