---
title: use docker container in modelarts training service
tags:
  - docker
date: 2022-06-12 15:06:00
abbrlink: e3ce3305
---

目标：构建有如下软件的容器镜像，并使用华为云 ModelArts 训练服务运行

* ubuntu-18.04
* cuda-10.2
* python-3.7.13
* pytorch-1.8.1

# 1. 准备 context 文件夹

```shell
mkdir -p context
```

## 1.1. 准备文件

### 1.1.1. pip.conf

> 使用华为云开源镜像站 pypi 配置
> 
> https://mirrors.huaweicloud.com/home

文件内容如下

```shell
[global]
index-url = https://repo.huaweicloud.com/repository/pypi/simple
trusted-host = repo.huaweicloud.com
timeout = 120
```

### 1.1.2. torch*.whl

> https://pytorch.org/get-started/previous-versions/#v181

在该地址上 https://download.pytorch.org/whl/torch_stable.html 搜索并下载如下 whl

* torch-1.8.1+cu102-cp37-cp37m-linux_x86_64.whl
* torchaudio-0.8.1-cp37-cp37m-linux_x86_64.whl
* torchvision-0.9.1+cu102-cp37-cp37m-linux_x86_64.whl

### 1.1.3. Miniconda3

> https://docs.conda.io/en/latest/miniconda.html
>
> Miniconda3-py37_4.12.0-Linux-x86_64.sh

使用该地址 https://repo.anaconda.com/miniconda/Miniconda3-py37_4.12.0-Linux-x86_64.sh, 下载 miniconda3 安装文件

## 1.2. context 文件夹内容

将上述文件放置在 context 文件夹内

```shell
context
├── Miniconda3-py37_4.12.0-Linux-x86_64.sh
├── pip.conf
├── torch-1.8.1+cu102-cp37-cp37m-linux_x86_64.whl
├── torchaudio-0.8.1-cp37-cp37m-linux_x86_64.whl
└── torchvision-0.9.1+cu102-cp37-cp37m-linux_x86_64.whl
```

# 2. 编写容器镜像 Dockerfile 文件

在 context 文件夹内新建名为 **Dockerfile** 的空文件，并将下述文件内容写入其中

```dockerfile
# 容器镜像构建主机需要连通公网

# 基础容器镜像, https://github.com/NVIDIA/nvidia-docker/wiki/CUDA
# 
# https://docs.docker.com/develop/develop-images/multistage-build/#use-multi-stage-builds
# require Docker Engine >= 17.05
#
# builder stage
FROM nvidia/cuda:10.2-runtime-ubuntu18.04 AS builder

# 基础容器镜像的默认用户已经是 root
# USER root

# 使用华为开源镜像站提供的 pypi 配置
RUN mkdir -p /root/.pip/
COPY pip.conf /root/.pip/pip.conf

# 拷贝待安装文件到基础容器镜像中的 /tmp 目录
COPY Miniconda3-py37_4.12.0-Linux-x86_64.sh \
     torch-1.8.1+cu102-cp37-cp37m-linux_x86_64.whl \
     torchvision-0.9.1+cu102-cp37-cp37m-linux_x86_64.whl \
     torchaudio-0.8.1-cp37-cp37m-linux_x86_64.whl \
     ./tmp

# https://conda.io/projects/conda/en/latest/user-guide/install/linux.html#installing-on-linux
# 安装 Miniconda3 到基础容器镜像的 /home/ma-user/miniconda3 目录中
RUN bash /tmp/Miniconda3-py37_4.12.0-Linux-x86_64.sh -b -p /home/ma-user/miniconda3

# 使用 Miniconda3 默认 python 环境 (即 /home/ma-user/miniconda3/bin/pip) 安装 torch*.whl
RUN cd /tmp && \
    /home/ma-user/miniconda3/bin/pip install --no-cache-dir \
    /tmp/torch-1.8.1+cu102-cp37-cp37m-linux_x86_64.whl \
    /tmp/torchvision-0.9.1+cu102-cp37-cp37m-linux_x86_64.whl \
    /tmp/torchaudio-0.8.1-cp37-cp37m-linux_x86_64.whl

# 构建最终容器镜像
FROM nvidia/cuda:10.2-runtime-ubuntu18.04

# 安装 vim / curl 工具（依旧使用华为开源镜像站）
RUN cp -a /etc/apt/sources.list /etc/apt/sources.list.bak && \
    sed -i "s@http://.*archive.ubuntu.com@http://repo.huaweicloud.com@g" /etc/apt/sources.list && \
    sed -i "s@http://.*security.ubuntu.com@http://repo.huaweicloud.com@g" /etc/apt/sources.list && \
    apt-get update && \
    apt-get install -y vim curl && \
    apt-get clean && \
    mv /etc/apt/sources.list.bak /etc/apt/sources.list

# 增加 ma-user 用户 (uid = 1000, gid = 100)
# 注意到基础容器镜像已存在 gid = 100 的组，因此 ma-user 用户可直接使用
RUN useradd -m -d /home/ma-user -s /bin/bash -g 100 -u 1000 ma-user

# 从上述 builder stage 中拷贝 /home/ma-user/miniconda3 目录到当前容器镜像的同名目录
COPY --chown=ma-user --from=builder /home/ma-user/miniconda3 /home/ma-user/miniconda3

# 设置容器镜像预置环境变量
# 请务必设置 PYTHONUNBUFFERED=1, 以免日志丢失
ENV PATH=$PATH:/home/ma-user/miniconda3/bin \
    PYTHONUNBUFFERED=1

# 设置容器镜像默认用户与工作目录
USER ma-user
WORKDIR /home/ma-user
```

# 3. 构建容器镜像

context 文件夹内容如下

```shell
context
├── Dockerfile
├── Miniconda3-py37_4.12.0-Linux-x86_64.sh
├── pip.conf
├── torch-1.8.1+cu102-cp37-cp37m-linux_x86_64.whl
├── torchaudio-0.8.1-cp37-cp37m-linux_x86_64.whl
└── torchvision-0.9.1+cu102-cp37-cp37m-linux_x86_64.whl
```

执行如下命令构建容器镜像

```shell
# 执行构建容器镜像命令之前，请务必切换到 context 目录内
cd context

# 执行构建容器镜像命令
docker build . -t swr.cn-north-4.myhuaweicloud.com/deep-learning-demo/pytorch:1.8.1-cuda10.2
```

容器镜像构建成功后，可通过如下命令查询到对应的容器镜像地址

```shell
docker images | grep pytorch | grep 1.8.1-cuda10.2
```

# 3. pytorch verification code

https://pytorch.org/get-started/locally/#linux-verification

验证示例代码：pytorch-verification.py

```python
import torch
import torch.nn as nn

x = torch.randn(5, 3)
print(x)

available_dev = torch.device("cuda") if torch.cuda.is_available() else torch.device("cpu")
y = torch.randn(5, 3).to(available_dev)
print(y)
```

# 4. boot command in modelarts training service

```shell
/home/ma-user/miniconda3/bin/python ${MA_JOB_DIR}/code/pytorch-verification.py
```

cpu 训练作业日志显示示例

```shell
tensor([[ 0.8945, -0.6946,  0.3807],
        [ 0.6665,  0.3133,  0.8285],
        [-0.5353, -0.1730, -0.5419],
        [ 0.4870,  0.5183,  0.2505],
        [ 0.2679, -0.4996,  0.7919]])
tensor([[ 0.9692,  0.4652,  0.5659],
        [ 2.2032,  1.4157, -0.1755],
        [-0.6296,  0.5466,  0.6994],
        [ 0.2353, -0.0089, -1.9546],
        [ 0.9319,  1.1781, -0.4587]])
```

gpu 训练作业日志显示示例

```shell
tensor([[-0.2874, -0.3475,  0.1848],
        [-0.1660, -0.5038, -0.5470],
        [ 0.1289, -0.2400,  2.0829],
        [ 1.6870, -0.0492,  0.1189],
        [ 0.4800, -0.3611, -0.9572]])
tensor([[-0.6710,  0.4095, -0.7370],
        [ 1.4353,  0.9093,  1.7551],
        [ 1.3477, -0.0499,  0.2404],
        [ 1.7489, -1.0203, -0.7875],
        [-1.2104,  0.4593,  1.1365]], device='cuda:0')
```
