---
title: WebSocket in Tomcat 7 (part 3)
abbrlink: 6b5275bc
date: 2018-07-08 11:09:28
tags:
    - WebSocket
---

回答上篇末尾的调用时序问题

Tomcat 7 默认使用 BIO Http11Protocol

注意到在 Http11Protocol 的 process 方法中（AbstractProtocol）有如下逻辑

```java
do {
    // ...
    else if (processor.isUpgrade()) {
        // Init WebSocket OPEN_READ processor httpUpgradeHandler is null
        // And when the second round came, upgradeDispatch will dispatch OPEN_READ status
        // ha, upgradeServletInputStream.onDataAvailable() will be called
        state = processor.upgradeDispatch(status);
        // but, pay attention to that fact
        // WsFrameServer.onDataAvailable is a for loop so it will remain in it
        // that's the reason why we can't see the state of Upgraded return
    } else {
        // Init WebSocket OPEN_READ will go through here
        state = processor.process(wrapper);
        // Finally adapter.service(request, response) will be called in processor.process
        // then the request will go through filter
        // Once it arrives the WsFilter
        // and it will call upgrade method with a WsHttpUpgradeHandler in WsFilter
        // That will instance a WsHttpUpgradeHandler and call action Upgrade hook
        // That's the time httpUpgradeHandler be set to WsHttpUpgradeHandler and no more null value
        // So isUpgrade() return true and state will become
        // SocketState.UPGRADING
        // And it will create a new processor named upgradeProcessor to replace previous processor
        // in the state of SocketState.UPGRADING in following code
    }
    if (getLog().isDebugEnabled()) {
        getLog().debug("Socket: [" + wrapper +
                "], Status in: [" + status +
                "], State out: [" + state + "]");
        // it means that if it is a WebSocket Request
        // it turns out to be once debug info
        // Status in: OPEN_READ, State out: UPGRADING
    }
} while (state == SocketState.UPGRADING);
// ...
if (state == SocketState.UPGRADING) {
    // Get the HTTP upgrade handler
    HttpUpgradeHandler httpUpgradeHandler =
            processor.getHttpUpgradeHandler();
    // Release the Http11 processor to be re-used
    release(wrapper, processor, false, false);
    // Create the upgrade processor
    processor = createUpgradeProcessor(
            wrapper, httpUpgradeHandler);
    // Mark the connection as upgraded
    wrapper.setUpgraded(true);
    // Associate with the processor with the connection
    connections.put(socket, processor);
    // Initialise the upgrade handler (which may trigger
    // some IO using the new protocol which is why the lines
    // above are necessary)
    // This cast should be safe. If it fails the error
    // handling for the surrounding try/catch will deal with
    // it.
    httpUpgradeHandler.init((WebConnection) processor);
}
```

所以 Tomcat 7 WebSocket 实现上的时序是正确的，大致的请求处理流程如下

* Client 与 OS 特定端口建立 Connection …
* Http11Protocol.process 被调用，传入 OPEN_READ status
* processor.process(wrapper) 被调用
* WsFilter 被调用，发现为 HTTP Upgrade to websocket request，设置 httpUpgradeHandler 为 WsHttpUpgradeHandler
* processor.process(wrapper) 返回 UPGRADING state
* Http11Protocol.process 创建新的 upgradeProcessor 以代替之前的 processor
* 调用 WsHttpUpgradeHandler.init 方法
* init 方法执行
    * 在 sos 上注册 WsWriteListener 方法
    * 调用 onOpen 方法
    * 在 sis 上注册 WsReadListener 方法
* status 仍然为 OPEN_READ
* processor.upgradeDispatch(status) 被调用，for loop socketInputStream

上述过程均在同一线程中执行，Tomcat 7 Http11Protocol 实现的是简单的处理模型，Acceptor 获取 socket，当有新的 socket 连接时，使用一个新线程去处理。

现在我们可以给出 WebSocket ServerEndpoint 的精确时序了

* SocketState OPEN_READ 后 ServerEndpoint onOpen 被调用
* WsFrameServer onDataAvailable 被调用
* onDataAvailable 组装好 Message 后 ServerEndpoint onMessage 被调用

因此即使 onOpen 执行时间过长，数据也只是被累积在 socket 输入缓冲区中，一旦执行结束后，依然能触发 onDataAvailable，从而回调 ServerEndpoint onMessage

另一方面也说明了，onOpen 首先被执行，onMessage 其次被执行的时序

值得注意的是 WebSocket 一旦成功 upgradeDispatch(OPEN_READ) state 后，逻辑将会停留在循环从 socketInputStream 获取数据上

而我们知道 WebSocket 为双工协议，那么 OPEN_WRITE 状态什么时候被 upgradeDispatch ? 这不被 upgradeDispatch 的话，Server side 就没法向 Client side 推送数据了？

WsRemoteEndpointImplServer onWritePossible

从 byteBuffers 中读取字节，并写入 socketOutputStream 中，byteBuffers 读取 complete 发送完成后，循环退出

这仅是 onWritePossible 自身的逻辑

而实际上如果是 upgradeDispatch(OPEN_WRITE) trigger onWritePossible(useDispatch: false)

WsRemoteEndpointImplServer doWrite trigger onWritePossible(useDispatch: true)

耐人寻味

注意到我们使用 wsSession.getBasicRemote().sendText() 发送消息，实际上最后调用的为 doWrite 方法，所以逻辑就清晰了，实际上并不一定需要 upgradeDispatch(OPEN_WRITE) 才能写入，只不过在实现上，通过 upgradeDispatch(OPEN_WRITE) 执行的 doWrite 与在 onOpen / onMessage 中使用 wsSession 直接写入的 doWrite 传入参数不同，均能完成写入

* upgradeDispatch(OPEN_WRITE): onWritePossible(useDispatch: false)
* wsSession.getBasicRemote().sendText(…): onWritePossible(useDispatch: true)

# summary

这块逻辑看的还不是特别清晰，主要是为了没有 OPEN_WRITE state 也是可以写入的这个结论

所以完整的 WebSocket 请求流程

* 客户端发起 WebSocket 请求时，需要新建一个链接
* Tomcat 接收到 socket 链接后，按通用处理流程处理之
* WebSocket 的第一个请求为 HTTP GET Upgrade 请求，这个请求在通用处理流程中经过 WsFilter
* WsFilter 识别到该请求为 WebSocket 请求，随后设置 WsHttpUpgradeHandler 为其 httpUpgradeHandler，调用 upgrade 方法，并 preInit WsHttpUpgradeHandler
* Tomcat 发现当前 socket state 变为 UPGRADING，因此创建 upgradeProcessor 以替换之前的 http processor，此时会执行 WsHttpUpgradeHandler init 方法
* WsHttpUpgradeHandler init 方法中会回调 **ServerEndpoint onOpen** 方法
* Tomcat 继续处理时发现 processor 为 upgradeProcessor，因此调用 upgradeDispatch(OPEN_READ)
* 这时触发 WsHttpUpgradeHandler.onDataAvailable()，随即继续调用至 WsFrameServer.onDataAvailable()
* WsFrameServer.onDataAvailable() 尝试获取对象锁之后，进入 for loop 获取 socketInputStream 输入逻辑，组装好数据后，回调 **ServerEndpoint onMessage** 方法，即业务层此时可以感知到 Client 发送的数据
* 到这里当前线程就一直在干读取 socket 中的数据并调用 onMessage 这件事儿了
