---
title: model-ds-series
abbrlink: 2b949691
date: 2026-05-08 20:04:51
tags:
---

想着在这个时间点上回顾下模型和模型训练 infra 发展的经历，就以 DS 的技术报告为例吧。

DS 系列模型：
1. DeepSeek LLM — DeepSeek LLM 7B、DeepSeek LLM 67B Dense（2024/01/05） [arXiv:2401.02954](https://arxiv.org/abs/2401.02954)
2. DeepSeek-Coder — 1.3B / 6.7B / 33B（2024/01/25） [arXiv:2401.14196](https://arxiv.org/abs/2401.14196)
3. DeepSeekMoE — MoE 语言模型系列 2B / 16B / 145B 等（2024/01/11） [arXiv:2401.06066](https://arxiv.org/abs/2401.06066)
4. DeepSeekMath — DeepSeekMath-7B（2024/02/05） [arXiv:2402.03300](https://arxiv.org/abs/2402.03300)
5. DeepSeek-V2 — 第二代 MoE 通用大模型（2024/05/07） [arXiv:2405.04434](https://arxiv.org/abs/2405.04434)
6. DeepSeek-V2.5 — 通用与代码能力合流迭代（2024/09/06；无单独 arXiv 技术报告，架构见 V2） [官方说明](https://api-docs.deepseek.com/news/news0905)
7. DeepSeek-V3 — 第三代 MoE 通用大模型（2024/12/27） [arXiv:2412.19437](https://arxiv.org/abs/2412.19437)
8. DeepSeek-R1、DeepSeek-R1-Zero（2025/01/22） [arXiv:2501.12948](https://arxiv.org/abs/2501.12948)

继而再看框架的实现。不是之前不能做，之前这是个浩大的工程。现在借助模型不仅是代码门槛下降了，理解 sota 工作的门槛也下降了，可以抽空广泛的了解起来了，成为新时代的 “全栈” 工程师。

# DeepSeek LLM

LLaMA

2T tokens pre train

1M sft, RLHF, SFT → RM → PPO 这条经典 RLHF pipeline

DPO, 不显式训一个单独的 RM、也不做 RL 循环，直接用 *偏好对* 数据（同一条 prompt 下，人类更喜欢回答 A 而不是 B）去更新语言模型。

SFT -> DPO

模型架构

a Pre-Norm structure with RMSNorm (Zhang and Sennrich, 2019) function

using SwiGLU (Shazeer, 2020) as the activation function

 Rotary Embedding (Su et al., 2024) for positional encoding

 Grouped Query Attention (GQA)

 AdamW optimizer (Loshchilov and Hutter, 2017), with the following hyperparameters: 𝛽1 = 0.9, 𝛽2 = 0.95, and weight_decay = 0.1

 HAI-LLM = Megatron 式多并行 + Flash Attention + ZeRO-1 省优化器显存 + 通信计算重叠 + 融合 kernel；数值上用 bf16 算、fp32 攒梯度保稳；最后在 softmax/CE 上用 in-place 省 logits 显存。

# DeepSeek-Coder

代码生成和代码补全，专门进行 FIM 代码补全训练

employ HuggingFace Tokenizer library 使用 Byte Pair Encoding 技术在训练语料子集上进行训练得到

基于 DeepSeek LLM 模型架构和训练技术，decode-only transformer, RoPE, GQA, FlashAttention v2

AdamW 优化器

并行策略实现仍然用的自研的 HAI-LLM 框架

| 超参数 (Hyperparameter) | DeepSeek-Coder 1.3B | DeepSeek-Coder 6.7B | DeepSeek-Coder 33B |
| --- | --- | --- | --- |
| **隐藏层激活函数 (Hidden Activation)** | SwiGLU | SwiGLU | SwiGLU |
| **隐藏层维度 (Hidden size)** | 2048 | 4096 | 7168 |
| **中间层维度 (Intermediate size)** | 5504 | 11008 | 19200 |
| **隐藏层数 (Hidden layers number)** | 24 | 32 | 62 |
| **注意力头数 (Attention heads number)** | 16 | 32 | 56 |
| **注意力机制 (Attention)** | Multi-head | Multi-head | Grouped-query (8) |
| **批次大小 (Batch Size)** | 1024 | 2304 | 3840 |
| **最大学习率 (Max Learning Rate)** | $5.3 \times 10^{-4}$ ($5.3\text{e-}4$) | $4.2 \times 10^{-4}$ ($4.2\text{e-}4$) | $3.5 \times 10^{-4}$ ($3.5\text{e-}4$) |

DeepSeek-Coder 主系列（1.3B / 6.7B / 33B）：from scratch pt 2T -> Base（[技术报告](https://arxiv.org/abs/2401.14196)：pre-training 含 FIM、context 扩至 16K；[DeepSeek-Coder 仓库 README](https://github.com/deepseek-ai/DeepSeek-Coder) Model Training 两阶段 1.8T@4K + 200B@16K）；SFT 2B -> Instruct

DeepSeek-Coder-v1.5（仅 7B）：CPT from DeepSeek-LLM 7B，2T@4K（next-token，无 FIM/16K）

# DeepSeekMoE

更小（多）的专家 + 共享专家

2B 实验

# DeepSeekMath

# DeepSeek-V2

# DeepSeek-V2.5

# DeepSeek-V3

# DeepSeek-R1

