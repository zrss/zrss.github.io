---
title: k8s minikube setup
abbrlink: b8d588f2
date: 2018-06-24 12:09:06
tags:
    - k8s
---

最近在着手实现 Console k8s workload upgrade 相关的任务，然而 mock 数据不直观，使用完整的集成环境，又存在不稳定性，经常与其他任务冲突（比如测试要开始搞破坏了）。遂重新开始折腾 k8s cluster setup

当然 k8s 发展到今天 local up 已经做的相对简单（可能对于自由的网络环境来说，不自由的就求爷爷告奶奶了）

这里 local up k8s cluster 使用的是 minikube 方案 https://v1-9.docs.kubernetes.io/docs/getting-started-guides/minikube/

此篇适用下述两条背景

* 非阿里 minikube 版本
* 解决 minikube docker proxy not work 问题

# Environment

* OS: macOS Sierra 10.12.6
* minikube: v0.25.0
* VM Driver: virtualbox
* ISO version: minikube-v0.25.1.iso

# Install

macOS 安装 minikube 可以说很简单了

> 已安装 homebrew

homebrew install minikube

```
brew cask install minikube
```

# Network

国内的困难主要是这个

我使用的方案是 Shadowsocks + privoxy，相关的资料非常多，不赘述了

privoxy 的配置如下 cat /usr/local/etc/privoxy/config

```
listen-address 0.0.0.0:1081
forward-socks5 / 127.0.0.1:1080 .
```

1080 端口为 socks5 的监听端口（即 Shadowsocks），privoxy 监听 1081 端口，将 1081 端口的 http 请求转发至 1080 socks5 监听端口上，这样就能让 http 请求也经过 socks5 转发了

测试一下 privoxy 是否正常工作

```bash
# check process
ps -ef | grep privoxy
# curl port
curl http://127.0.0.0:1081
# netstat (recommended)
netstat -an | grep 1081
# lsof
lsof -i:1081
```

# Minikube start

使用上一步搭建好的 privoxy http 代理

我使用的终端为 iTerm，理论上系统自带 Terminal 也 ok

设置 http / https 代理

```bash
export http_proxy=http://127.0.0.1:1081
export https_proxy=https://127.0.0.1:1081
```

启动 minikube

```bash
minikube start
```

# Docker proxy

minikube 下载完成 iso 后，再 bootstrap k8s cluster，cluster 起来之后，会启动一些 system 组件，比如 kube-addon-manager-minikube/ dashboard / dns 等，然而不幸的是这些 pod 会一直处于 ContainerCreating 的状态

## 查看 events

```bash
kubectl describe po kube-addon-manager-minikube -nkube-system
```

None

## 查看 kubelet 日志

```bash
minikube logs kubelet
```

发现端倪

gcr.io/google_containers/pause-amd64:3.0，pause 容器无法 pull 下来

继续搜索得知 minikube 可配置 docker proxy https://github.com/kubernetes/minikube/blob/v0.25.0/docs/http_proxy.md

遂停止 minikube 并以新参数启动之

```bash
minikube start --docker-env HTTP_PROXY=http://127.0.0.1:1081 --docker-env HTTPS_PROXY=https://127.0.0.1:1081
export no_proxy=$no_proxy,$(minikube ip)
```

呃，然而事实证明并不 work，遂登陆 vm

```bash
minikube ssh
```

尝试 curl 该 1081 端口

```bash
curl http://127.0.0.1:1081
>> curl: (7) Failed to connect to 127.0.0.1 port 1081: Connection refused
```

可见 vm 中该端口并不通

稍加思索，解决的思路应为在 virtualbox vm 中如何 connect back to host，因为 privoxy 实际上监听的是 host 的 1081 端口。几番搜索后，发现在 virtualbox vm 中可通过 10.0.2.2 IP connect back to host https://superuser.com/questions/310697/connect-to-the-host-machine-from-a-virtualbox-guest-os，登陆 vm

```bash
curl http://10.0.2.2:1081
```

果然能通了

于是再次尝试修改 minikube 启动命令

```bash
minikube start --docker-env HTTP_PROXY=http://10.0.2.2:1081 --docker-env HTTPS_PROXY=https://10.0.2.2:1081
```

糟糕的是，仍然不 work …，所以问题集中到了 http_proxy 未生效上

登陆 vm 查看 docker version / info，希望能获取到一些线索

```bash
# version
docker version
Client:
 Version:      17.09.0-ce
 API version:  1.32
 Go version:   go1.8.3
 Git commit:   afdb6d4
 Built:        Tue Sep 26 22:39:28 2017
 OS/Arch:      linux/amd64
Server:
 Version:      17.09.0-ce
 API version:  1.32 (minimum version 1.12)
 Go version:   go1.8.3
 Git commit:   afdb6d4
 Built:        Tue Sep 26 22:45:38 2017
 OS/Arch:      linux/amd64
 Experimental: false
# info
docker info
Containers: 0
Running: 0
Paused: 0
Stopped: 0
Images: 0
Server Version: 17.09.0-ce
Storage Driver: overlay2
 Backing Filesystem: extfs
 Supports d_type: true
 Native Overlay Diff: true
Logging Driver: json-file
Cgroup Driver: cgroupfs
Plugins:
 Volume: local
 Network: bridge host macvlan null overlay
 Log: awslogs fluentd gcplogs gelf journald json-file logentries splunk syslog
Swarm: inactive
Runtimes: runc
Default Runtime: runc
Init Binary: docker-init
containerd version: 06b9cb35161009dcb7123345749fef02f7cea8e0
runc version: 3f2f8b84a77f73d38244dd690525642a72156c64
init version: N/A (expected: )
Security Options:
 seccomp
  Profile: default
Kernel Version: 4.9.64
Operating System: Buildroot 2017.11
OSType: linux
Architecture: x86_64
CPUs: 2
Total Memory: 1.953GiB
Name: minikube
ID: 6RR3:WAF4:FIGA:TTEG:5UE6:V3RD:JNQV:WQQ4:ER3T:ETKJ:ZVP4:2Z7M
Docker Root Dir: /var/lib/docker
Debug Mode (client): false
Debug Mode (server): false
Registry: https://index.docker.io/v1/
Labels:
 provider=virtualbox
Experimental: false
Insecure Registries:
 10.96.0.0/12
 127.0.0.0/8
Live Restore Enabled: false
```

然而似乎和问题并没有什么关联，http_proxy 和 docker daemon 有关，和 docker 没啥关系，所以在 version / info 中都未见 http_proxy 相关配置 https://github.com/docker/distribution/issues/2397#issuecomment-330079118

追溯到这里，只能看看 minikube 代码中是如何使用 docker-env 这个传入参数的了

# how does minikube start

overall

* startHost
* startK8S

startHost

* create virtualbox driver with boot2docker iso
* waiting docker set up

step by step 的过程省略，最后找到如下代码片段，显示 docker-env 实际上并不会生效

https://github.com/kubernetes/minikube/blob/v0.25.0/cmd/minikube/cmd/start.go#L157

```go
start := func() (err error) {
    host, err = cluster.StartHost(api, config)
    if err != nil {
        glog.Errorf("Error starting host: %s.\n\n Retrying.\n", err)
    }
    return err
}
```

https://github.com/kubernetes/minikube/blob/v0.25.0/pkg/minikube/machine/client.go#L114-L135

```go
return &host.Host{
    ConfigVersion: version.ConfigVersion,
    Name:          driver.GetMachineName(),
    Driver:        driver,
    DriverName:    driver.DriverName(),
    HostOptions: &host.Options{
        AuthOptions: &auth.Options{
            CertDir:          api.certsDir,
            CaCertPath:       filepath.Join(api.certsDir, "ca.pem"),
            CaPrivateKeyPath: filepath.Join(api.certsDir, "ca-key.pem"),
            ClientCertPath:   filepath.Join(api.certsDir, "cert.pem"),
            ClientKeyPath:    filepath.Join(api.certsDir, "key.pem"),
            ServerCertPath:   filepath.Join(api.GetMachinesDir(), "server.pem"),
            ServerKeyPath:    filepath.Join(api.GetMachinesDir(), "server-key.pem"),
        },
        EngineOptions: &engine.Options{
            StorageDriver: "aufs",
            TLSVerify:     true,
        },
        SwarmOptions: &swarm.Options{},
    },
}, nil
```

可见默认 SwarmOptions 是个空对象，其中值得注意的是 IsSwarm 的值为 false

https://github.com/kubernetes/minikube/blob/v0.25.0/pkg/minikube/cluster/cluster.go#L243-L250

```go
h, err := api.NewHost(config.VMDriver, data)
if err != nil {
    return nil, errors.Wrap(err, "Error creating new host")
}
h.HostOptions.AuthOptions.CertDir = constants.GetMinipath()
h.HostOptions.AuthOptions.StorePath = constants.GetMinipath()
h.HostOptions.EngineOptions = engineOptions(config)
```

将 docker-env 赋值与 h.HostOptions.EngineOptions.Env

https://github.com/kubernetes/minikube/blob/v0.25.0/vendor/github.com/docker/machine/libmachine/provision/boot2docker.go#L232

```go
provisioner.SwarmOptions = swarmOptions
provisioner.AuthOptions = authOptions
provisioner.EngineOptions = engineOptions
swarmOptions.Env = engineOptions.Env
```

最后将 docker-env 传与 swarmOptions.Env，而我们又知道 IsSwarm 的值为 false，因此实际上该配置并不会生效 … 社区真是给处于不自由网络地区的童鞋埋了个大坑 …

# Back to Docker proxy

回到如何在 minikube 中配置 Docker proxy 的问题，实际上可以参考 Docker 官方的文档配置，使用 systemd

https://docs.docker.com/config/daemon/systemd/#httphttps-proxy

```bash
minikube ssh
sudo mkdir -p /etc/systemd/system/docker.service.d
sudo vi /etc/systemd/system/docker.service.d/http-proxy.conf
```

输入如下内容并保存退出

```bash
[Service]
Environment="HTTP_PROXY=http://10.0.2.2:1081" "HTTPS_PROXY=https://10.0.2.2:1081"
```

Flush changes & Restart Docker

```bash
sudo systemctl daemon-reload
sudo systemctl restart docker
```

Verify that the configuration has been loaded

```bash
systemctl show --property=Environment docker
```

执行结束之后，此时在 vm 中

```bash
docker pull gcr.io/google_containers/pause-amd64:3.0
```

终于可以正常 pull image 了，system pod 也可以正常 running 起来了

```bash
NAME                                    READY     STATUS    RESTARTS   AGE
kube-addon-manager-minikube             1/1       Running   4          12h
kube-dns-54cccfbdf8-wfnxm               3/3       Running   3          12h
kubernetes-dashboard-77d8b98585-t59gj   1/1       Running   1          12h
storage-provisioner                     1/1       Running   1          12h
```

不过因为该改动并未固化到 iso 中，因此 minikube stop 之后改动会丢失 … 另外一个折中的办法

# Another method for Docker proxy (recommended)

> workaround

之前我们知道，在 terminal 中 export http_proxy 之后，minikube 即可使用 proxy 访问网络资源，而在 minikube –help 中发现 minikube 可以 cache image，所以我们可以 cache 需要使用的 image 资源，如

```bash
export http_proxy=http://127.0.0.1:1081
export no_proxy=$no_proxy,$(minikube ip)
minikube cache add gcr.io/google_containers/pause-amd64:3.0
```

也可以解决问题，比如我目前 cache 的 image

```bash
minikube cache list
gcr.io/google-containers/kube-addon-manager:v6.5
gcr.io/google_containers/pause-amd64:3.0
gcr.io/k8s-minikube/storage-provisioner:v1.8.1
k8s.gcr.io/k8s-dns-dnsmasq-nanny-amd64:1.14.5
k8s.gcr.io/k8s-dns-kube-dns-amd64:1.14.5
k8s.gcr.io/k8s-dns-sidecar-amd64:1.14.5
k8s.gcr.io/kubernetes-dashboard-amd64:v1.8.1
```

cache 这些 image 之后，就可以使得 kube-system 下面的 pod 都 running 了

# minikube logs healthcheck error

使用 minikube 过程中发现其 logs 中一直有如下错误日志

```bash
Jun 23 18:15:15 minikube localkube[3034]: E0623 18:15:15.392453    3034 healthcheck.go:317] Failed to start node healthz on 0: listen tcp: address 0: missing port in address
```

查看了相关代码，似乎是正常现象，不过这个实现也是太奇怪了 … 可参考如下 issue，https://github.com/kubernetes/minikube/issues/2609#issuecomment-399701288
