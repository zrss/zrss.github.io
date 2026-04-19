---
title: model
abbrlink: d79572d9
date: 2024-02-24 18:17:00
---

https://wangcong.net/article/FPandBP.html

pathways

https://blog.research.google/2022/04/pathways-language-model-palm-scaling-to.html

> a single model that could generalize across domains and tasks while being highly efficient. An important milestone toward realizing this vision was to develop the new Pathways system to orchestrate distributed computation for accelerators.

few-shot

TPU v4 Pods

Pipelining is typically used with DCN

word to vector, This vector represents the word’s meaning and context within the given language

embedding layer, lookup table

Positional encoding

https://medium.com/@tech-gumptions/transformer-architecture-simplified-3fb501d461c8

This means that the output of a layer is added to the initial input, allowing the model to learn to only make small changes to the input

The decoder’s job is to produce the English sentence based on both the original French sentence and the bits of the English sentence it has generated so far.

Input Embedding: Just as with the Encoder, the input to the Decoder (which is the target sequence during training) is first embedded into continuous vectors. 

It’s important to note that this masking is only applied during training. During inference, the decoder can attend to all words in the target sequence, including future words.

To summarize, the Decoder in the Transformer architecture processes its input through self-attention, cross-attention with the Encoder’s output, and position-wise Feed-Forward networks, repeatedly for each stacked block, culminating in a final output sequence after the softmax operation.

https://jalammar.github.io/illustrated-transformer/

https://nlp.seas.harvard.edu/2018/04/03/attention.html

https://jalammar.github.io/illustrated-gpt2/

PPO/GRPO/重要性采样/拒绝采样

megatron 保存 ckpt 原理
