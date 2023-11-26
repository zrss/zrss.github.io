---
title: H800
abbrlink: ac031db9
date: 2023-11-26 11:00:00
---

# Terms

* SXM: Server PCI Express Module, a high bandwidth socket solution for connecting Nvidia Compute Accelerators to a system
* NVL: NVLink is a wire-based serial multi-lane near-range communications link developed by Nvidia. Unlike PCI Express, a device can consist of multiple NVLinks, and devices use mesh networking to communicate instead of a central hub.
* PCIe: PCI Express (Peripheral Component Interconnect Express), officially abbreviated as PCIe or PCI-e,[1] is a high-speed serial computer expansion bus standard

from Wikipedia

# H800 vs H100

> 1. https://resources.nvidia.com/en-us-tensor-core/nvidia-tensor-core-gpu-datasheet
>
> 1. NVIDIA H100 Tensor Core GPU
>
> 1. H800 没找到 NVIDIA 官网 Specification, 只能从代理商和一些B站UP主看到的数据

|     | H800 SXM | H100 SXM |
| -------- | ------- |------- |
| FP64  |   1 teraFLOPS  | 34 teraFLOPS    |
| FP64 Tensor Core |   1 teraFLOPS   | 67 teraFLOPS     |
| FP32    |   67 teraFLOPS | 67 teraFLOPS    |
| TF32 Tensor Core    |  989 teraFLOPS   | 989 teraFLOPS    |
| BFLOAT16 Tensor Core    |  1,979 teraFLOPS   | 1,979 teraFLOPS    |
| FP16 Tensor Core    |   1,979 teraFLOPS  | 1,979 teraFLOPS    |
| FP8 Tensor Core    |  3,958 teraFLOPS   | 3,958 teraFLOPS    |
| INT8 Tensor Core    |  3,958 TOPS   | 3,958 TOPS    |
| GPU memory    |  80GB   | 80GB    |
| GPU memory bandwidth    |  3.35TB/s   | 3.35TB/s    |
| Interconnect    |  NVLink 400GB/s PCIe Gen5: 128GB/s   | NVLink 900GB/s PCIe Gen5: 128GB/s    |

* H800 FP64 算力限制

# Driver

https://resources.nvidia.com/en-us-tensor-core/gtc22-whitepaper-hopper

https://www.nvidia.com/content/dam/en-zz/Solutions/gtcs22/data-center/h100/PB-11133-001_v01.pdf

Software Specifications

|  Specification   | Description |
| -------- | ------- |
| Driver support  | Linux: R520 or later |

# CUDA

> https://docs.nvidia.com/datacenter/tesla/drivers/index.html#cuda-arch-matrix

|  Architecture   | CUDA Capabilities | First CUDA Toolkit Support |
| -------- | ------- |------- |
| Hopper | 9.0 | CUDA 11.8<br>CUDA 12.0|

# TensorFlow

https://www.tensorflow.org/install/source#tested_build_configurations

|  Version   | Python version | Compiler | Build tools | cuDNN | CUDA |
| -------- | ------- |------- |------- |------- |------- |
| tensorflow-2.15.0  |   3.9-3.11  | Clang 16.0.0    | Bazel 6.1.0 | 8.8  | 12.2 |
| tensorflow-2.14.0  |   3.9-3.11  | Clang 16.0.0    | Bazel 6.1.0 | 8.7  | 11.8 |
| tensorflow-2.13.0  |   3.8-3.11  | Clang 16.0.0    | Bazel 5.3.0 | 8.6  | 11.8 |
| tensorflow-2.12.0  |   3.8-3.11  | GCC 9.3.1    | Bazel 5.3.0 | 8.6  | 11.8 |
| tensorflow-2.11.0  |   3.7-3.10  | GCC 9.3.1    | Bazel 5.3.0 | 8.1  | 11.2 |
| tensorflow-2.6.0  |   3.6-3.9  | 	GCC 7.3.1    | Bazel 3.7.2 | 8.1  | 11.2 |

candidates on H800

* \>= tensorflow-2.12.0

[docker images](https://hub.docker.com/r/tensorflow/tensorflow/tags)

```shell
docker pull tensorflow/tensorflow:2.14.0-gpu
docker pull tensorflow/tensorflow:2.13.0-gpu
docker pull tensorflow/tensorflow:2.12.0-gpu
```

# PyTorch

https://pytorch.org/get-started/previous-versions/

|  Version | CUDA |
| -------- | ------- |
| v1.13.1 | 11.6, 11.7 |
| v2.0.0 | 11.7, 11.8 |
| v2.0.1 | 11.7, 11.8 |
| v2.1.0 | 11.8, 12.1 |
| v2.1.1 | 11.8, 12.1 |

candidates on H800

* \>= v2.0.0, with cuda 11.8 support

[docker images](https://hub.docker.com/r/pytorch/pytorch/tags?page=1)

```shell
docker pull pytorch/pytorch:2.1.0-cuda11.8-cudnn8-devel
docker pull pytorch/pytorch:2.1.0-cuda11.8-cudnn8-runtime

docker pull pytorch/pytorch:2.0.1-cuda11.7-cudnn8-devel
docker pull pytorch/pytorch:2.0.1-cuda11.7-cudnn8-runtime
```
