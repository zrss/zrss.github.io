---
title: Web Terminal
abbrlink: 5679b106
date: 2018-06-17 13:58:33
tags:
    - k8s
---

我们知道在 k8s 集群中，可以通过 kubeclt exec -ti 命令远程登录容器，以执行命令。而要在 Console 上实现这个特性的集成，需要依赖 websocket 协议 (https://tools.ietf.org/html/rfc6455)[https://tools.ietf.org/html/rfc6455]

下面全面回顾一下集成过程中涉及到的方方面面知识

* kube-apiserver
* nginx
* tomcat
* webpack-dev-server

# exec in kube-apiserver

> to be cont.

# 404 nginx

Problem: websocket 404 through nginx

遇到的问题，本地开发完成之后，部署到环境中，websocket 请求在直接用 IP 访问时 okay，而经过了二级域名则不 okay。二级域名是由 Nginx 配置转发的。查看 Nginx 的配置

Nginx 配置为通用的配置，即 upstream / server 的配置

```
upstream console {
    ip_hash;
    server IP:PORT;
    server IP:PORT;
}
server {
    location /serviceName {
        proxy_pass https://console;
    }
}
```

http 模块有如下配置

```
http {
    map $http_upgrade $connection_upgrade {
        default upgrade;
        ''      close;
    }
}
```

参考该文档 http://nginx.org/en/docs/http/ngx_http_map_module.html 解读 map 的语义

上述语句的语义为，动态设置 $connection_upgrade 变量的值，当请求头中 upgrade 值为 ‘’ 时，则 $connection_upgrade 值为 close，当 upgrade 值非空时，其值为 upgrade

对于 websocket 请求来说，其第一个请求中会携带请求头

```
Connection: upgrade
Upgrade: websocket
```

根据 http://nginx.org/en/docs/http/websocket.html 文档说明

> As noted above, hop-by-hop headers including “Upgrade” and “Connection” are not passed from a client to proxied server

Upgrade / Connection header 并不会由 client 传递至被代理的 server，因此在 nginx 的 server 配置处需要手动增加这两 header

```
server {
    location /serviceName/ws {
        proxy_pass https://console;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
    }
}
```

之前 nginx 未这么配置，导致 ws 请求被转发至后端时，缺少了这两请求头，导致 tomcat wsservlet 没识别到这是 ws 请求，又没有其他的 filter 或 servlet 处理，因此返回了 404

# websocket in tomcat

> tomcat 7

上述问题中 nginx 为公共组件，需要更改配置的话，要走流程，为了可以先行调试，所以考虑在 webserver 侧想想办法解决请求头的问题

## 分析

在 WsFilter 中判断请求为 ws 请求的要素

* GET 请求
* header 中包含 Upgrade: websocket 值

```java
public static boolean isWebSocketUpgradeRequest(ServletRequest request,
        ServletResponse response) {
    return ((request instanceof HttpServletRequest) &&
            (response instanceof HttpServletResponse) &&
            headerContainsToken((HttpServletRequest) request,
                    Constants.UPGRADE_HEADER_NAME,
                    Constants.UPGRADE_HEADER_VALUE) &&
            "GET".equals(((HttpServletRequest) request).getMethod()));
}
```

在 WsServerContainer 中将该 Filter 加入到 servletContext 中，并设置其拦截所有请求

```java
fr.addMappingForUrlPatterns(types, true, "/*");
```

而这个地方的调用在 WsServerContainer 构造函数中发生，继续探寻而上

WsSci 实现了 ServletContainerInitializer 接口，在 onStartup 接口实现中构造了 WsServerContainer 类

https://tomcat.apache.org/tomcat-8.0-doc/servletapi/javax/servlet/ServletContainerInitializer.html

回忆在 Tomcat 的 release 版本中 tomcat7-websocket.jar 被放置于 {CATALINA_BASE}/lib 目录下

tomcat 启动后会加载

能否实现一个 filter，该 filter 拦截 ws 请求 url，对这个 url 的请求增加特定请求头？

这么实现的话，得确认 filter 的执行顺序。我们知道

> First, the matching filter mappings in the same order that these elements appear in the deployment descriptor.
>
> Next, the matching filter mappings in the same order that these elements appear in the deployment descriptor.

那么非定义在描述符中的 filter 呢？

> to be cont.

## 解决方案

实验时发现可行，所以可以认为描述符中的 filter 先于 WsFilter 执行

## 参考

https://stackoverflow.com/questions/17086712/servlet-filters-order-of-execution

# 神奇的 http-proxy-middleware

Problem: websocket hangs on pending status

遇到的问题，本地开发调试时，websocket 一直处于 pending 状态。查看 proxy 的 debug 信息，一直没有 get 请求发送，网上漫天搜索 issue / stackoverflow 无果，遂强行不懂装懂看代码

> 当然有 issue 是直接关联的，因一开始完全没经验，并未注意到实际上就是该 issue 导致的 ^_^

## 分析

团队开发 Console 使用的 dev tool 为

* webpakc-dev-server 2.2.0 (WDS)

本地开发调试依赖 WDS，该组件集成了 proxy 的功能，可以将本地的请求转发至实际的后端。例如如下的 proxy 配置

```javascript
devServer: {
    port: 8888,
    proxy: {
        "/api": {
            target: "http://127.0.0.1:50545",
            changeOrigin: true,
            secure: false,
            logLevel: "debug"
        },
    }
}
```

按上述配置，本地的 http://localhost:8888/api... 请求会被转发至 http://127.0.0.1:50545/api...。当然在实际开发调试过程中，被转发至的地址一般为后台 API 接口地址，或者是后台代理服务器地址，这样也就实现了本地 Console 开发与后端分离

websocket 协议的 proxy 需要打开 ws option，参考如下配置

```javascript
devServer: {
    port: 8888,
    proxy: {
        "/api": {
            target: "http://127.0.0.1:50545",
            changeOrigin: true,
            secure: false,
            logLevel: "debug",
            ws: true // proxy websocket
        }
    }
}
```

WDS 在启动时，会使用 express https://expressjs.com/en/4x/api.html 启动一个 web-server

express 是一个 web framework，类似 java 里的 struts，粗略来看可以定义路由被哪个 middleware 处理，以及处理逻辑

继续回到 WDS 启动时，如果 WDS 定义了 proxy 配置，则监听所有路由，将路由的处理逻辑交给 proxyMiddleware 负责

[https://github.com/webpack/webpack-dev-server/blob/v2.2.0/lib/Server.js#L196-L228)

```javascript
options.proxy.forEach(function(proxyConfigOrCallback) {
    let proxyConfig;
    let proxyMiddleware;
    if(typeof proxyConfigOrCallback === "function") {
        proxyConfig = proxyConfigOrCallback();
    } else {
        proxyConfig = proxyConfigOrCallback;
    }
    proxyMiddleware = getProxyMiddleware(proxyConfig);
    app.use(function(req, res, next) {
        if(typeof proxyConfigOrCallback === "function") {
            const newProxyConfig = proxyConfigOrCallback();
            if(newProxyConfig !== proxyConfig) {
                proxyConfig = newProxyConfig;
                proxyMiddleware = getProxyMiddleware(proxyConfig);
            }
        }
        const bypass = typeof proxyConfig.bypass === "function";
        const bypassUrl = bypass && proxyConfig.bypass(req, res, proxyConfig) || false;
        if(bypassUrl) {
            req.url = bypassUrl;
            next();
        } else if(proxyMiddleware) {
            // proxy request at here
            return proxyMiddleware(req, res, next);
        } else {
            next();
        }
    });
});
```

实际开发时，proxy 规则往往不仅仅配置一条，可能类似如下存在多条配置，其中第三条是 websocket api 请求的 proxy 配置

```javascript
devServer: {
    port: 8888,
    proxy: {
        "/api": {
            target: "http://api.company.com:50545",
            changeOrigin: true,
            secure: false,
            logLevel: "debug",
        },
        "/account": {
            target: "http://iam.company.com",
            changeOrigin: true,
            secure: false,
            logLevel: "debug",
        }
        "/exec": {
            target: "http://api.company.com:50545",
            changeOrigin: true,
            secure: false,
            logLevel: "debug",
            ws: true, // proxy websocket
        }
    }
}
```

回顾之前所说 WDS 启动时，proxy 一旦配置，会将所有路由，逐一代理给 proxyMiddleware

更具体来说对于上述例子，每一条 proxy 规则会创建一个 proxyMiddleware，而所有路由都将按 key 的字典序，逐一代理给 proxyMiddleware

对于上述 proxy 配置的处理顺序为

1) /account proxyMiddleware
2) /api proxyMiddleware
3) /exec proxyMiddleware

注意 app.use 中的 next 方法，在当前 proxyMiddleware 不处理该路由后，调用 next 交由下由 middleware 继续处理，有点类似 java servlet 里的 filter

在 WDS 中这个 proxyMiddleware 是使用 http-proxy-middleware 实现的，而 http-proxy-middleware 最终依赖 http-proxy

再继续探究 ws: true option 到底干了啥事儿，使得 WDS 可以 proxy websocket 请求？

答案在 https://github.com/chimurai/http-proxy-middleware/blob/v0.17.3/lib/index.js#L38-L50 中

可以看到这段代码，如果 proxy 中 ws: true，那么创建该 proxyMiddleware 时会调用 catchUpgradeRequest 方法

```javascript
function catchUpgradeRequest(server) {
    // subscribe once; don't subscribe on every request...
    // https://github.com/chimurai/http-proxy-middleware/issues/113
    if (!wsInitialized) {
        server.on('upgrade', wsUpgradeDebounced);
        wsInitialized = true;
    }
}
```

在 catchUpgradeRequest 方法中，使用 server 对象监听 upgrade 事件，而 wsUpgradeDebounced 调用也很简单

debounce 直译为节流：即持续操作时，不会触发，停止一段时间后才触发。多用于用户连续输入时，停止一段时间后的回调

即使用 underscore 的 debounce 方法调用 handleUpgrade

```javascript
function handleUpgrade(req, socket, head) {
    // set to initialized when used externally
    wsInitialized = true;
    if (shouldProxy(config.context, req)) {
        var activeProxyOptions = prepareProxyRequest(req);
        proxy.ws(req, socket, head, activeProxyOptions);
        logger.info('[HPM] Upgrading to WebSocket');
    }
}
```

ok，看到这，基本的逻辑都明白了，全流程走一遍

## 原因

按 websocket 协议来说，第一个请求为 connect upgrade 的请求，即为 http get 请求 (当然与一般的 http get 请求不同，实际上并不能等同认为是一个 http get 请求)，应能在 proxy debug 信息中看到这个 get 请求，而该 debug 信息是在 https://github.com/chimurai/http-proxy-middleware/blob/v0.17.3/lib/index.js#L40 及 https://github.com/chimurai/http-proxy-middleware/blob/v0.17.3/lib/index.js#L66 处被打印，L40 这处的打印非 websocket 请求，L66为 websocket 请求

L66 之所以未被打印，是因为未进入 catchUpgradeRequest 方法，而未进入该方法的原因，是因为在配置多条 proxy 规则时，如果按字典序来看，例子中的 /exec 排在最后，而普通 http 请求已被其他 proxyMiddleware 处理，那么就不会调用 next 方法交由下一个 proxyMiddleware 处理，因此 /exec 只有在发起 websocket 请求时才会经过

而如果 https://github.com/chimurai/http-proxy-middleware/blob/v0.17.3/lib/index.js#L56 未被执行，即 http-server 若未监听 upgrade 请求，则 websocket 的 upgrade 请求一直不会被处理，因此出现了 pending 中的状态

> 另外 app.use 无法拦截到 connect upgrade 请求

所以需要一个 http request warm up websocket proxy https://github.com/chimurai/http-proxy-middleware/issues/207

## 解决方案

对于例子中的 proxy 来说，浏览器中输入一个 404 未被任一 proxyMiddleware 处理的路由即可，比如 http://localhost:8888/warmup，这样这个请求会经过所有 proxyMiddleware，在经过 websocket proxy 时触发 server listen on upgrade。后续 websocket 发起 connect 请求时，proxy debug 日志中就能看到 websocket http get 的输出，并且有 [HPM] Upgrading to WebSocket 的输出，websocket 本地开发时就能正常连接了

## 参考

https://github.com/expressjs/express/issues/2594

https://github.com/chimurai/http-proxy-middleware/issues/143

https://github.com/chimurai/http-proxy-middleware/issues/112

https://github.com/chimurai/http-proxy-middleware/issues/207

https://github.com/kubernetes-ui/container-terminal
