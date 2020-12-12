---
title: aws sagemaker
abbrlink: 6722211e
date: 2019-10-20 10:23:09
tags: dl
---

没实际玩儿过 … 家里一直登陆不上 … 以下全凭看文档与代码

以 EC2 为基石设计，以镜像作为运行环境，完全面向镜像的设计

支持的 EC2 实例类型

https://amazonaws-china.com/sagemaker/pricing/instance-types/

性能最好的实例类型当前为

```
ml.p3dn.24xlarge
vCPU: 96  
GPUs: 8xV100  
Mem(GiB): 768 
GPU Mem(GiB): 256 
Networking Performance: 100 Gigabit
```

EC2 对应的实例类型为

```
p3dn.24xlarge   
GPUs: 8   
vCPU: 96  
Mem(GiB): 768 
GPU Mem(GiB): 256 
GPU P2P: NVLink  
Storage(GB): 2 x 900 NVMe SSD    
Dedicated EBS Bandwidth: 14 Gbps 
Networking Performance: 100 Gigabit
```

100 Gigabit 由 AWS efa 提供，提供 OS-bypass 通信能力，应该就是 Infiniband 网络

启动训练过程 (Script Mode)

* 上传本地代码至 S3
* 调用 Sagemaker 创建训练作业接口
    * 创建 EC2 实例
    * 在 EC2 实例上启动 Sagemaker 系统进程
    * 下载数据集
    * 启动容器 (镜像)
    * 下载训练代码
    * 启动训练代码

https://github.com/aws/sagemaker-containers

下载

https://github.com/aws/sagemaker-containers/blob/master/src/sagemaker_containers/_files.py#L112

上传

https://github.com/aws/sagemaker-python-sdk/blob/master/src/sagemaker/fw_utils.py#L322

因此完整流程

创建作业/版本
