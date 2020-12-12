---
title: conda-dl
abbrlink: ee6e3d9f
date: 2019-06-02 10:33:37
tags: hpc
---

[managing python version](https://conda.io/projects/conda/en/latest/user-guide/getting-started.html#managing-python)

```bash
conda create --name dl python=3.6
```

activate your env [dl]

```bash
conda info --envs
conda activate dl
```

PyCharm with anaconda

[build the latest openmpi](https://www.open-mpi.org/faq/?category=building#easy-build)

```bash
# download the openmpi-v4.0.0.tar.gz from the official website
# untar and run configure
./configure --prefix=/usr/local/openmpi --enable-orterun-prefix-by-default
# make and install
make -j $(nproc) all
make install
```

verify openmpi

```bash
mpirun -np 4 --bind-to none --map-by slot hostname
```

install tensorflow

```bash
/anaconda3/envs/dl/bin/pip --proxy http://127.0.0.1:1081 install tensorflow==1.13.1
```

install horovod

```bash
HOROVOD_WITH_TENSORFLOW=1 /anaconda3/envs/dl/bin/pip install -v --no-cache-dir horovod==0.16.2
```

ref [horovod Dockerfile](https://github.com/horovod/horovod/blob/master/Dockerfile)
