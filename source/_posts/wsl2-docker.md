---
title: wsl2 docker
abbrlink: '50758925'
date: 2023-05-03 11:32:15
---

1. 参考 https://docs.docker.com/engine/install/binaries/#install-static-binaries 使用二进制方式安装 docker engine 18.09.9
2. 参考 https://learn.microsoft.com/en-us/windows/wsl/wsl-config#systemd-support 开启 wsl2 支持 systemd
3. 参考 https://docs.docker.com/engine/install/linux-postinstall/#configure-docker-to-start-on-boot-with-systemd 配置 docker engine systemd, systemd 配置文件 https://github.com/moby/moby/tree/master/contrib/init/systemd
4. 参考 https://docs.docker.com/config/daemon/systemd/#httphttps-proxy 配置 docker daemon proxy


完成上述配置后发现 `docker info` 非常慢，并且尝试 `docker run` 容器镜像会有如下报错

```
docker: Error response from daemon: all SubConns are in TransientFailure, latest connection error: connection error: desc = "transport: Error while dialing dial unix:///run/containerd/containerd.sock: timeout": unavailable.
```

参考 https://github.com/sous-chefs/docker/issues/1062 发现疑似 master 分支的 systemd 配置引入了不兼容修改，导致使用 master 分支的 systemd 配置，无法完全启动 docker engine 18.09.9。修改 systemd 配置为 https://github.com/moby/moby/tree/v18.09.9/contrib/init/systemd 后，`docker info` 以及 `docker run` 功能恢复正常
