---
title: WebSocket in Tomcat 7 (part 1)
abbrlink: 5964173e
date: 2018-07-06 20:22:57
tags:
    - WebSocket
---

> 又是一部折腾史

之前提到了最近在基于 WebSocket 协议实现 WebTerminal 特性，无奈生产环境遇到了一个 weired bug，百思不得其解，只好看看 WebSocket 在 Tomcat 7 中是如何实现的

> 环境/版本信息

```
OS: macOS Sierra 10.12.6
Tomcat: 7.0.88
Intellij: 2016.2
```

> jenv 管理 java 版本

```
> jenv versions
  system
* 1.6.0.65 (set by /Users/zrss/.jenv/version)
  1.7.0.181
  1.8.0.172
```

> 当前 java 版本

```
> jenv global
1.6.0.65
```

> ant 版本

```
> ant -version
Apache Ant(TM) version 1.9.12 compiled on June 19 2018
```

# Set up Tomcat src code in Intellij

参考如下官方构建指南即可

> http://tomcat.apache.org/tomcat-7.0-doc/building.html

第一步当然是下载源码 http://tomcat.apache.org/download-70.cgi#7.0.88
，当前源码地址 http://mirrors.hust.edu.cn/apache/tomcat/tomcat-7/v7.0.88/src/apache-tomcat-7.0.88-src.tar.gz

解压后目录结论如下

```
apache-tomcat-7.0.88-src
├── BUILDING.txt
├── CONTRIBUTING.md
├── KEYS
├── LICENSE
├── NOTICE
├── README.md
├── RELEASE-NOTES
├── RUNNING.txt
├── STATUS.txt
├── bin
├── build.properties.default
├── build.xml
├── conf
├── java
├── modules
├── res
├── test
└── webapps
```

Tomcat 诞生的年代比较久远，还是用的比较古老的构建工具 ant，复制 build.properties.default 至 build.properties

```bash
cp build.properties.default build.properties
```

Tomcat7 WebSocket 依赖 java7，因此需要设置 build.properties 中的 java7 path。取消该文件中的下述定义注释（54行），并填写相应 jdk 路径

```
java.7.home=/Library/Java/JavaVirtualMachines/zulu-7.jdk/Contents/Home
```

> 如果使用 jenv 管理 java 版本，可使用如下命令查看当前 java 的 java_home path
/usr/libexec/java_home -v $(jenv version-name)

确认当前 java 版本为 1.6

```
> java -version
java version "1.6.0_65"
Java(TM) SE Runtime Environment (build 1.6.0_65-b14-468)
Java HotSpot(TM) 64-Bit Server VM (build 20.65-b04-468, mixed mode)
```

设置 JAVA_HOME（make sure it is a 1.6 java’s home）

```
> export JAVA_HOME=$(/usr/libexec/java_home -v $(jenv version-name))
> echo $JAVA_HOME
/Library/Java/JavaVirtualMachines/1.6.0.jdk/Contents/Home
```

当然国内的小伙伴还要多做一件事儿，那就是配置 proxy

```
proxy.use=on
proxy.host=127.0.0.1
proxy.port=1081
```

这个 proxy 方案也是非常常见的了，shadowsocks (socks5) + privoxy (http)

最后进入 Tomcat 源码目录执行 ant 命令构建

```
cd /Users/zrss/Documents/Code/Java/apache-tomcat-7.0.88-src
ant
```

jar 包下载顺利的话，无问题

```
BUILD SUCCESSFUL
Total time: 23 seconds
```

# Import Tomcat src to Intellij

在 Tomcat 源码目录执行，如若遇到因为 SSL 无法下载的依赖，手动下载之，并放入 testexist 路径（讲真，是个体力活儿，得有六七个包吧）

```
ant ide-eclipse
```

最后终于成功了

```
BUILD SUCCESSFUL
Total time: 1 second
```

构建 websocket eclipse

```
ant ide-eclipse-websocket
```

顺利成功

```
BUILD SUCCESSFUL
Total time: 1 second
```

到此可以开始导入 IntelliJ 了

IntelliJ 欢迎页面选择 Import Project，在弹出框中选择 Tomcat 源码根路径，一路 Next 至 Select Eclipse projects to import，勾选上 tomcat-7.0.x 继续 Next，最后 Project SDK 选择 1.6 即可

WebSocket 代码在如下路径

```
/Users/zrss/Documents/Code/Java/apache-tomcat-7.0.88-src/java/org/apache/tomcat/websocket
```

最后查看 Tomcat version 信息

```
> cd output/build/bin
> ./version.sh
Using CATALINA_BASE:   /Users/zrss/Documents/Code/Java/apache-tomcat-7.0.88-src/output/build
Using CATALINA_HOME:   /Users/zrss/Documents/Code/Java/apache-tomcat-7.0.88-src/output/build
Using CATALINA_TMPDIR: /Users/zrss/Documents/Code/Java/apache-tomcat-7.0.88-src/output/build/temp
Using JRE_HOME:        /Library/Java/JavaVirtualMachines/1.6.0.jdk/Contents/Home
Using CLASSPATH:       /Users/zrss/Documents/Code/Java/apache-tomcat-7.0.88-src/output/build/bin/bootstrap.jar:/Users/zrss/Documents/Code/Java/apache-tomcat-7.0.88-src/output/build/bin/tomcat-juli.jar
Server version: Apache Tomcat/7.0.88
Server built:   Jul 6 2018 14:30:23 UTC
Server number:  7.0.88.0
OS Name:        Mac OS X
OS Version:     10.12.6
Architecture:   x86_64
JVM Version:    1.6.0_65-b14-468
JVM Vendor:     Apple Inc.
```

至此 Tomcat 7 导入 IntelliJ 中 okay，可以愉快的查看代码了。当然查看 WebSocket 相关的实现时，在 IntelliJ Project Structure 中切换 SDK 至 1.7 即可
