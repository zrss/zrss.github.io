---
title: the cache of request
abbrlink: e830320c
date: 2018-05-13 14:09:52
tags:
    - browser
---

最近遇到个意外的情况：在未知情况下，Chrome 浏览器会对部分 GET 请求缓存，即该请求的 SIZE 指示为 from disk cache，且 cache 返回的状态码为 410

查看 MDN 上对 HTTP 410 的解释为，Gone 服务器返回该状态码，指示该请求资源在服务器上已不可用，而且这个不可用可能是永久的。如果服务器不清楚该资源的丢失是临时的或者是永久的，那么应返回 404，即 Not Found

另外 410 response 是可被缓存的

考虑到实际我们项目中的开发流程，有 Dev / Alpha / Production 环境，各个环境的访问需要切换 proxy 访问，可能存在 CORS (Cross-Origin-Resource-Sharing) 问题，具体如

Alpha 环境域名为 A，因此若访问 Alpha 环境，则将 A domain 配置至主机 hosts 文件中，静态解析 A domain，使其对应 IP 为 Alpha 环境 IP

Production 环境域名也为 A，访问 Production 环境，可以直接公网访问

对于浏览器来说，访问 Alpha / Production 环境的最大不同，为 Remote Address 不同 (域名实际相同)

那么是否有可能为成功的请求访问的 Alpha 环境，而不成功的请求 (被 cache 410 的请求) 访问的为 Production 环境？

顺着这个可疑点开始搜索相关资料，了解到

# Prefight request

客户端在发起 COR 请求时，会首先发起 prefight 请求，检查是否对端 Server 接受 COR 请求

client option request

```
OPTIONS /resource/foo 
Access-Control-Request-Method: DELETE 
Access-Control-Request-Headers: origin, x-requested-with
Origin: https://foo.bar.org
```

if server accept this request then it will response a reponse body like

```
HTTP/1.1 200 OK
Content-Length: 0
Connection: keep-alive
Access-Control-Allow-Origin: https://foo.bar.org
Access-Control-Allow-Methods: POST, GET, OPTIONS, DELETE
Access-Control-Max-Age: 86400
```

好了，看到这，发现调查的方向有点偏了，切换 proxy 并不会导致 CORS 问题。切换代理之后，会导致后续请求由代理 A 切换至代理 B 转发，仅此而已

# Can it be cache by accidently ?

查看代码后，发现后端部分请求在某一时段，的确返回了 410 错误，而 410 错误时，会返回一个 html 页面结果，是否 nginx 对这个结果，设置了有效的 cache-control 导致，浏览器缓存了发生该错误时的请求？

查看 Nginx 的文档后发现，Nginx add_header 仅在特定的 http status code 生效

```
Adds the specified field to a response header provided that the response code equals 200, 201 (1.3.10), 204, 206, 301, 302, 303, 304, 307 (1.1.16, 1.0.13), or 308 (1.13.0). The value can contain variables.
```

所以如果特定 http 请求，本应返回正常的 json 结构体，然而后台报错，抛出异常，而该异常又未被捕获，因此 http 请求最后获取到的是 tomcat 的 exception 页面，比如 410 的错误页面

又因为未指定默认的 cache 方式，因此该返回没有 cache 相关的 http header，因此全凭浏览器的启发式 cache 策略，意外将该错误的 http 请求返回结果缓存下来

为解决这个问题，可以在 `conf/web.xml` 中配置

```xml
<security-constraint>
    <web-resource-collection>
        <web-resource-name>HTTPSOnly</web-resource-name>
        <url-pattern>/*</url-pattern>
    </web-resource-collection>
    <user-data-constraint>
        <transport-guarantee>CONFIDENTIAL</transport-guarantee>
    </user-data-constraint>
</security-constraint>
```

即可，这样默认每个请求的返回头都会加上

```
Cache-Control: private
Expires: Thu, 01 Jan 1970 00:00:00 GMT
```

至于为何后端会概率性返回 410，那又是另外一个问题了，后续有机会再说

# 回顾

因此问题是这样的，对于返回“正常”的请求 Nginx 设置了如下

```
Cache-Control: no-cache, no-store, must-revalidate
Pragma: no-cache
X-Content-Type-Options: nosniff
X-Download-Options: noopen
X-Frame-Options: SAMEORIGIN
X-XSS-Protection: 1; mode=block;
Strict-Transport-Security: max-age=31536000; includeSubdomains;
```

请求头

对于静态资源文件，如 .html/.css/.js 等，Nginx 使用了 Expires 指令

```
Cache-Control: max-age=604800
Expires: Sun, 27 May 2018 10:28:04 GMT
X-Content-Type-Options: nosniff
X-Download-Options: noopen
X-Frame-Options: SAMEORIGIN
X-XSS-Protection: 1; mode=block;
Strict-Transport-Security: max-age=31536000; includeSubdomains;
```

因此增加或修改了

```
Cache-Control: max-age=604800
Expires: Sun, 27 May 2018 10:28:04 GMT
```

返回请求头

对于非“正常”的请求，使用 Tomcat CONFIDENTIAL 配置，使其返回请求头中默认携带

```
Cache-Control: private
Expires: Thu, 01 Jan 1970 00:00:00 GMT
```

因此浏览器不会缓存错误的返回结果。当然这么配置之后，实际上是所有返回头均有上述字段，一般来说 Tomcat 前端会有 LB，最常见的如 Nginx，Nginx 对资源文件默认设置了 Expires，该指令会修改 Cache-Control / Expires，因此从通用的角度来说，足以解决缓存带来的各种烦人问题，又不至于太影响性能

# 参考

https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/410

https://developer.mozilla.org/en-US/docs/Glossary/cacheable

https://developer.mozilla.org/en-US/docs/Glossary/Preflight_request

https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS

https://lists.w3.org/Archives/Public/www-archive/2017Aug/0000.html

https://bugs.chromium.org/p/chromium/issues/detail?id=260239

https://stackoverflow.com/questions/21829553/tomcat-security-constraint-impact-cache
