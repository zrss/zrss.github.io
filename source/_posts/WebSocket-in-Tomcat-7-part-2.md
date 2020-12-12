---
title: WebSocket in Tomcat 7 (part 2)
abbrlink: 724944fd
date: 2018-07-06 20:28:07
tags:
    - WebSocket
---

接着上一篇，来分析一下 Tomcat 7 中 WebSocket 的实现

# WsFilter

WebSocket 的实现入口处为 WsFilter，该 Filter 检查 HTTP header 中是否包含下述字段

```
Upgrade: websocket
```

且为 HTTP GET 请求。若符合 WebSocket Handshake 要求，则从 WebSocketContainer 中查找请求路径是否有 filter 拦截，若没有则继续后续的 filter，若有则进入 UpgradeUtil.doUpgrade 方法

# WsServerContainer

回头来看 WsServerContainer 的初始化，当然最为重要的是注册了 WsFilter

```java
FilterRegistration.Dynamic fr = servletContext.addFilter(
        "Tomcat WebSocket (JSR356) Filter", new WsFilter());
fr.setAsyncSupported(true);
EnumSet<DispatcherType> types = EnumSet.of(DispatcherType.REQUEST,
        DispatcherType.FORWARD);
fr.addMappingForUrlPatterns(types, true, "/*");
```

可见 WsFilter 拦截所有请求，当遇到 HTTP Upgrade to websocket 协议的请求时执行 doUpgrade 逻辑

# UpgradeUtil.doUpgrade

doUpgrade 在各种检查后，可以接受 Client Upgrade 请求时，需向 Client 端返回的 HTTP 报文头中添加如下字段（Sec-WebSocket-Protocol / Sec-WebSocket-Extensions 可选）

```
Upgrade: websocket
Connection: upgrade
Sec-WebSocket-Accept: [key]
Sec-WebSocket-Protocol: [subProtocol]
Sec-WebSocket-Extensions: [extensions]
```

当然还需要初始化 ServerEndpoint 实例（@ServerEndpoint 注解）

```java
Endpoint ep;
try {
    Class<?> clazz = sec.getEndpointClass();
    if (Endpoint.class.isAssignableFrom(clazz)) {
        ep = (Endpoint) sec.getConfigurator().getEndpointInstance(
                clazz);
    } else {
        ep = new PojoEndpointServer();
        // Need to make path params available to POJO
        perSessionServerEndpointConfig.getUserProperties().put(
                PojoEndpointServer.POJO_PATH_PARAM_KEY, pathParams);
    }
} catch (InstantiationException e) {
    throw new ServletException(e);
}
```

最后向 Client 返回 HTTP Response

```java
WsHttpUpgradeHandler wsHandler =
        ((RequestFacade) inner).upgrade(WsHttpUpgradeHandler.class);
wsHandler.preInit(ep, perSessionServerEndpointConfig, sc, wsRequest,
        negotiatedExtensionsPhase2, subProtocol, transformation, pathParams,
        req.isSecure());
```

而 WsHttpUpgradeHandler 则会用于处理

```
The handler for all further incoming data on the current connection.
```

# WsHttpUpgradeHandler

WsHttpUpgradeHandler init 方法中干了很多事情

* 首先从 WebConnection 中获取输入流/输出流

```java
this.connection = connection;
AbstractServletInputStream sis;
AbstractServletOutputStream sos;
try {
    sis = connection.getInputStream();
    sos = connection.getOutputStream();
} catch (IOException e) {
    throw new IllegalStateException(e);
}
```

* 实例化 WsSession，注意 SessionId 使用一个 static AtomicLong 维护，每次增加 1
* 实例化 WsFrameServer，用于读写 Message
* 在 sos 上注册 WsWriteListener
* 调用 ServerEndpoint onOpen 方法
* 在 sis 上注册 WsReadListener

## summary

所以综上所述，每一次 HTTP Upgrade 请求均会创建一个新的 ServerEndpoint 实例，因此定义于 ServerEndpoint 中的 static 变量需注意确保线程安全

另外 ServerEndpoint 中 onOpen 和 onMessage 的执行顺序为 onOpen 必然首先执行，若 onOpen 执行时间过长，则就算 sis 中有数据等待处理，也不会触发 onMessage，因为从 WsHttpUpgradeHandler init 方法中可以看出 onOpen 调用结束后，才会在 sis 上注册 WsReadListener。接下来继续分析，如何触发 WsReadListener

# Connector

AbstractServiceInputStream.onDataAvailable() 方法中调用 listener.onDataAvailable(); 即 WsReadListener.onDataAvailable()

而 AbstractServiceInputStream.onDataAvailable() 又由 AbstractProcessor.upgradeDispatch(SocketStatus status) 调用

```java
@Override
public final SocketState upgradeDispatch(SocketStatus status)
        throws IOException {
    if (status == SocketStatus.OPEN_READ) {
        try {
            upgradeServletInputStream.onDataAvailable();
        } catch (IOException ioe) {
            // The error handling within the ServletInputStream should have
            // marked the stream for closure which will get picked up below,
            // triggering the clean-up of this processor.
            getLog().debug(sm.getString("abstractProcessor.onDataAvailableFail"), ioe);
        }
    } else if (status == SocketStatus.OPEN_WRITE) {
        try {
            upgradeServletOutputStream.onWritePossible();
        } catch (IOException ioe) {
            // The error handling within the ServletOutputStream should have
            // marked the stream for closure which will get picked up below,
            // triggering the clean-up of this processor.
            getLog().debug(sm.getString("abstractProcessor.onWritePossibleFail"), ioe);
        }
    } else if (status == SocketStatus.STOP) {
        try {
            upgradeServletInputStream.close();
        } catch (IOException ioe) {
            getLog().debug(sm.getString(
                    "abstractProcessor.isCloseFail", ioe));
        }
        try {
            upgradeServletOutputStream.close();
        } catch (IOException ioe) {
            getLog().debug(sm.getString(
                    "abstractProcessor.osCloseFail", ioe));
        }
        return SocketState.CLOSED;
    } else {
        // Unexpected state
        return SocketState.CLOSED;
    }
    if (upgradeServletInputStream.isCloseRequired() ||
            upgradeServletOutputStream.isCloseRequired()) {
        return SocketState.CLOSED;
    }
    return SocketState.UPGRADED;
}
```

Tomcat 7 默认使用 BIO，Http11Protocol.createUpgradeProcessor，其中将 socket 超时时间设置为不超时，并返回一个 Processor

因此 Tomcat 处理 WebSocket 请求的大致流程为

* JIOEndpoint accept socket and new a thread to handle it
* Worker wait for the next socket to be assigned and call handler to process socket
* Http11ConnectionHandler
* Http11Processor

客户端首先打开一个 connection，connection 建立后，向服务器端发起 WebSocket Handshake 请求，服务器接受后，返回 101 status code，双方可在当前 connection 上双工通信

当 SocketStatus 为 OPEN_READ 时，回调 readListener 的 onDataAvailable 方法，此处逻辑有 trick 的地方，值得注意的是如果 SocketStatus.OPEN_READ 时，仍未完成注册 readListener，则不会触发 listener.onDataAvailable() … 显然，因为 listener 为 null

```java
protected final void onDataAvailable() throws IOException {
    if (listener == null) { // it doesn't have a listener
        return;
    }
    ready = Boolean.TRUE;
    Thread thread = Thread.currentThread();
    ClassLoader originalClassLoader = thread.getContextClassLoader();
    try {
        thread.setContextClassLoader(applicationLoader);
        listener.onDataAvailable();
    } finally {
        thread.setContextClassLoader(originalClassLoader);
    }
}
```

在 WsFrameServer 的 onDataAvailable 方法中首先尝试获取对象锁，获取成功后，for loop 监听 Servlet 输入流，当有数据时读取数据供 WsFrameServer 处理，处理 okay 后，回调 ServerEndpoint 的 onMessage 方法，业务层即感知到从 ws 连接中获取到数据

另外 ServerEndpoint onOpen 是在 WsHttpUpgradeHandler init 方法中被回调，看看官方文档对 handler 的 init 方法的描述

> This method is called once the request/response pair where the upgrade is initiated has completed processing and is the point where control of the connection passes from the container to the HttpUpgradeHandler.

https://tomcat.apache.org/tomcat-7.0-doc/api/org/apache/tomcat/websocket/server/WsHttpUpgradeHandler.html

so 理论上要想使得 Tomcat 7 WebSocket 能正常工作的前提为

* WsHttpUpgradeHandler init 方法被调用 —— WsHttpUpgradeHandler
* 在 sos 上注册 WsWriteListener 方法结束 —— WsHttpUpgradeHandler
* SocketStatus.OPEN_WRITE —— AbstractProcessor
* onOpen 方法回调结束 —— ServerEndpoint
* 在 sis 上注册 WsReadListener 方法结束 —— WsHttpUpgradeHandler
* SocketStatus.OPEN_READ —— AbstractProcessor

接下来需要搞清楚一个问题，上述这些逻辑是单线程在跑，还是多线程，单线程的话，时序问题不大，但是多线程的情况下，就很有讲究了

To be cont. 下一遍回答上述时序问题
