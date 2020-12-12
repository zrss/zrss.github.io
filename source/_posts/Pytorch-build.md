---
title: install PyTorch 1.8 from source
tags:
  - PyTorch
categories: Issues
abbrlink: 5a3d0ab7
date: 2020-11-15 11:47:00
---

本地复现一个 `TcpStore` 的测试用例问题，修改了部分代码，因此需要源码编译 PyTorch

# 环境信息

* macOS 10.15.7
* XCode 12.2 (12B45b)

# 源码信息

master latest commit (2020-11-14): `f8248543a13b0144a6f5d0a549f72b1e470d88aa`

```
commit f8248543a13b0144a6f5d0a549f72b1e470d88aa (github/master, github/gh/ljk53/194/base, github/HEAD, master)
Author: Rohan Varma <rvarm1@fb.com>
Date:   Sat Nov 14 13:36:31 2020 -0800
```

# 构建

> (1) https://github.com/pytorch/pytorch#from-source
>
> (2) https://github.com/pytorch/pytorch/blob/master/CONTRIBUTING.md#c-development-tips

## glog

```
brew install glog
```

## conda

```bash
conda create -n pytorch-dev python=3.6

conda activate pytorch-dev

conda install numpy ninja pyyaml mkl mkl-include setuptools cmake cffi typing_extensions future six requests dataclasses

# Add these packages if torch.distributed is needed
conda install pkg-config libuv
```

## build and install

uninstall 

```
conda uninstall torch
pip uninstall torch

rm -rf build/
```

then reinstall

```bash
export CMAKE_PREFIX_PATH=${CONDA_PREFIX:-"$(dirname $(which conda))/../"}
MACOSX_DEPLOYMENT_TARGET=10.9 CC=clang CXX=clang++ MAX_JOBS=8 BUILD_CAFFE2=0 BUILD_CAFFE2_OPS=0 USE_GLOG=1 USE_DISTRIBUTED=1 USE_MKLDNN=0 USE_CUDA=0 USE_FBGEMM=0 USE_NNPACK=0 USE_QNNPACK=0 USE_XNNPACK=0 python setup.py develop
```

Quad-Core Intel Core i7 ~ 45min

# 测试

```
Python 3.6.12 |Anaconda, Inc.| (default, Sep  8 2020, 17:50:39)
[GCC Clang 10.0.0 ] on darwin
Type "help", "copyright", "credits" or "license" for more information.
>>> import torch
>>> torch.__version__
'1.8.0a0+f1a8a82'
```

## TcpStore

```
python test/distributed/test_c10d.py

Python 3.6.12 |Anaconda, Inc.| (default, Sep  8 2020, 17:50:39)
[GCC Clang 10.0.0 ] on darwin
Type "help", "copyright", "credits" or "license" for more information.
>>> import torch.distributed as dist
>>> server_store = dist.TCPStore("127.0.0.1", 18668, 1, True)
```

or

```
./build/bin/TCPStoreTest
```
