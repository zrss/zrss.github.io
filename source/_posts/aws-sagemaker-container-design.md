---
title: Deep Learning Training Container Design
tags:
  - AWS
  - SageMaker
  - Azure
abbrlink: 11c28430
---

# AWS SageMaker

> AWS SageMaker 训练容器镜像设计体验

不是优点的优点: 看起来只支持同构资源，训练资源分配模型为单节点单容器，理解上简单

## 优势

* 容器镜像功能层次丰富，每个层次都有文档描述如何实施，Level 0 对容器镜像约束最少，自定义程度最高
  * Level 0: 完全自定义容器镜像，容器镜像指定 Entrypoint，Entrypoint 命令能处理 train 参数即可 [link](https://docs.aws.amazon.com/sagemaker/latest/dg/your-algorithms-training-algo-dockerfile.html)
  * Level 1: 改造已有容器镜像，使得其可利用 SageMaker Toolkits 来进行训练与推理（即把已有镜像改造为 SageMaker 镜像）[link](https://docs.aws.amazon.com/sagemaker/latest/dg/adapt-training-container.html)
  * Level 2: 使用预置的 SageMaker 容器镜像
  * Level 3: 使用扩展的预置 SageMaker 容器镜像（基于预置的容器镜像扩展功能）
* 训练启动脚本 (Training Toolkits) 开源，并且可通过 `pip install sagemaker-training` 直接安装，常用深度学习引擎有独立的 toolkits，均包含在 training toolkits 中 [link](https://docs.aws.amazon.com/sagemaker/latest/dg/docker-containers-adapt-your-own.html)
* 可在 Notebook 中直接构建容器镜像
* 可在 local machine 测试容器镜像基本功能（可能仅限单机训练？)

## 主打场景

AI 开发者：文档详细且丰富（技术向），容器镜像可玩度高（约束少）

# Azure Machine Learning

https://docs.microsoft.com/en-us/azure/machine-learning/how-to-train-with-custom-image

Azure 与 `conda` 结合，有个 `Environment` 的概念，对容器镜像有如下约束

* Ubuntu 16.04 or greater.
* Conda 4.5.# or greater.
* Python 3.5+.

当然如果不使用 `Environment`，也就无上述约束

https://docs.microsoft.com/en-us/azure/machine-learning/how-to-train-tensorflow#distributed-training

资源分配模式看起来也是单节点单容器

https://github.com/Azure/MachineLearningNotebooks/tree/master/how-to-use-azureml/ml-frameworks/tensorflow/distributed-tensorflow-with-horovod

TODO ...
