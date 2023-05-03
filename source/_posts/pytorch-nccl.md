---
title: pytorch 1.13 and nccl
abbrlink: f3995990
date: 2023-05-03 12:27:15
---

* windows 11
* wsl2
    * ubuntu 18.04
    * nvidia driver 531.68
    * cuda 11.6.2

# pytorch 1.13.1 docker image

docker image

```
docker pull pytorch/pytorch:1.13.1-cuda11.6-cudnn8-runtime
```

view nccl version of pytorch

```
docker run -ti --rm pytorch/pytorch:1.13.1-cuda11.6-cudnn8-runtime bash

python -c "import torch;print(torch.cuda.nccl.version())"
```

# pytorch 1.13.1

https://github.com/pytorch/pytorch/tree/v1.13.1

https://github.com/pytorch/pytorch/tree/v1.13.1#from-source

https://github.com/pytorch/pytorch/blob/v1.13.1/CONTRIBUTING.md#tips-and-debugging

https://zrss.github.io/archives/5a3d0ab7.html

```
conda create -n pytorch-dev python=3.8

conda activate pytorch-dev

conda install astunparse numpy ninja pyyaml setuptools cmake cffi typing_extensions future six requests dataclasses
conda install -c pytorch magma-cuda116
conda install mkl mkl-include

export CMAKE_PREFIX_PATH=${CONDA_PREFIX:-"$(dirname $(which conda))/../"}

CUDACXX=/usr/local/cuda/bin/nvcc MAX_JOBS=8 python setup.py develop
```

如果 setup 过程中出现如下日志

```
Building wheel torch-1.13.0a0+git49444c3
-- Building version 1.13.0a0+git49444c3
Could not find any of CMakeLists.txt, Makefile, setup.py, LICENSE, LICENSE.md, LICENSE.txt in /root/projects/pytorch/third_party/ios-cmake
Did you run 'git submodule update --init --recursive --jobs 0'?
```

可以重新 update submodule，再做尝试

```
git submodule deinit -f .
git clean -xdf
python setup.py clean
git submodule update --init --recursive --jobs 0
```

如果 setup 过程中出现如下日志，可以减小 jobs 数（例如上述的 case 为 8），再做尝试

```
FAILED: third_party/fbgemm/CMakeFiles/fbgemm_avx2.dir/src/FbgemmI8DepthwiseAvx2.cc.o
/usr/bin/c++ -DFBGEMM_STATIC -I/root/projects/pytorch/third_party/cpuinfo/include -I/root/projects/pytorch/third_party/fbgemm/third_party/asmjit/src -I/root/projects/pytorch/third_party/fbgemm/include -I/root/projects/pytorch/third_party/fbgemm -I/root/projects/pytorch/cmake/../third_party/benchmark/include -isystem /root/projects/pytorch/cmake/../third_party/googletest/googlemock/include -isystem /root/projects/pytorch/cmake/../third_party/googletest/googletest/include -isystem /root/projects/pytorch/third_party/protobuf/src -isystem /root/tools/miniconda3/envs/pytorch-dev/include -isystem /root/projects/pytorch/third_party/gemmlowp -isystem /root/projects/pytorch/third_party/neon2sse -isystem /root/projects/pytorch/third_party/XNNPACK/include -Wno-deprecated -fvisibility-inlines-hidden -DUSE_PTHREADPOOL -fopenmp -Wall -Wextra -Werror -Wno-deprecated-declarations -O3 -DNDEBUG -fPIC -fvisibility=hidden -m64 -mavx2 -mf16c -mfma -std=c++14 -Wno-uninitialized -MD -MT third_party/fbgemm/CMakeFiles/fbgemm_avx2.dir/src/FbgemmI8DepthwiseAvx2.cc.o -MF third_party/fbgemm/CMakeFiles/fbgemm_avx2.dir/src/FbgemmI8DepthwiseAvx2.cc.o.d -o third_party/fbgemm/CMakeFiles/fbgemm_avx2.dir/src/FbgemmI8DepthwiseAvx2.cc.o -c /root/projects/pytorch/third_party/fbgemm/src/FbgemmI8DepthwiseAvx2.cc
c++: internal compiler error: Killed (program cc1plus)
```

# nccl v2.14.3-1

https://github.com/NVIDIA/nccl/tree/v2.14.3-1

make (generate header)

```
cd nccl
make -j 8 src.build
```

如果 make 过程中出现如下日志，可以减小 make 所使用的核数（例如上述的 case 为 8 核），再做尝试

```
g++: internal compiler error: Killed (program cc1plus)
```

将 `build/include/nccl.h` 文件拷贝至 `src` 目录下

## vscode nccl in wsl

1. config wsl for vscode

https://code.visualstudio.com/docs/cpp/config-wsl

2. install cuda toolkit in wsl

https://docs.nvidia.com/cuda/wsl-user-guide/index.html#cuda-support-for-wsl-2

https://developer.nvidia.com/cuda-11-6-2-download-archive?target_os=Linux&target_arch=x86_64&Distribution=WSL-Ubuntu&target_version=2.0&target_type=deb_local

3. add includePath for vscode

`/usr/local/cuda/targets/x86_64-linux/include/`
