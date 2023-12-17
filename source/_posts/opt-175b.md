---
title: the spark of OPT-175B
date: 2023-11-26 16:08:00
abbrlink: 9b7ac1f7
---

> 近期的一些杂项

infra decouple from kind of internal production system

重点并不是 infra 如何帮忙自动恢复, 只是略有提到; 重点还是训练的调参

famous uncorrectable ECC error

we just restart the run

try to make run stable (数学上的稳定)

FP16

Lost GPU
CUDA errors
Job hanging
NCCL error
Job Slowdown

High DRAM correctable errors etc.
blob storage issues

when we are training these models, we kind of just stare at tensorboard all day

in general the mixture of hardware issues, training like numerical converting issues

~30days change the hyperparameter to try to get through

56days, 53 - 54 restarts, OPT-175B survived 143K steps

Andrej Karpathy

LLM

LAMA-2-70B

fp16, 2bytes, 70B

2 * 70B = 140B bytes = 140 * 1,000,000,000 bytes = 140,000,000,000 bytes = 140 gigabytes (bytes, kbytes, mbytes, gbytes)

140GB

tokenize

encoder, 将字符串转换为整数编码
decoder, 将整数编码转为字符串
