---
title: MiniMax M2 Series 技术报告阅读
tags:
  - llm
  - moe
  - rl
categories: 笔记
abbrlink: 55b4e23b
date: 2026-06-04 23:20:00
---

MiniMax M2 系列技术报告的标题是 [The MiniMax-M2 Series: Mini Activations Unleashing Max Real-World Intelligence](https://arxiv.org/abs/2605.26494)。

NVIDIA 也有一篇部署侧性能文章：[MiniMax M2.7 Advances Scalable Agentic Workflows on NVIDIA Platforms for Complex AI Applications](https://developer.nvidia.com/blog/minimax-m2-7-advances-scalable-agentic-workflows-on-nvidia-platforms-for-complex-ai-applications/)。

一句话概括：M2 系列不是单纯把模型参数做大，而是在尝试把 **低激活 MoE backbone、agent 数据管线、agent-native RL 系统 Forge、长上下文推理优化** 组合成一套面向真实 agent workflow 的训练和部署方案。

本文主要整理四类信息：

- 模型参数和结构；
- pre-training / post-training 用了哪些技术；
- Forge 这套 RL 工程系统是什么；
- M2.7 的指标到底提升在哪里。

## 模型参数

先看 M2 backbone 的基本配置。

| 项目 | 报告口径 |
| --- | ---: |
| 架构 | decoder-only Transformer + MoE |
| 总参数 | 229.9B |
| 每 token 激活参数 | 9.8B |
| 层数 | 62 |
| hidden size | 3072 |
| vocab size | 200064 |
| MoE experts | 256 fine-grained experts |
| 每 token 激活专家数 | 8 |
| attention | full attention |
| query heads | 48 |
| KV heads | 8, GQA |
| position embedding | RoPE |
| native context | 192K tokens |
| pre-training tokens | 29.2T |

这个配置体现出一个明确取舍：总参数很大，但每 token 激活参数控制在 10B 左右。agent task 的 token 消耗通常较高，多轮工具调用、长上下文、观察结果、文件内容都会增加 context 长度。因此，每 token 激活成本会直接影响推理和 RL rollout 成本。

因此，M2 的参数信息需要同时看 total params 和 activated params：**229.9B total params / 9.8B activated params**。

## MoE 结构

M2 的 FFN 层使用 MoE。报告里强调了三个设计：

- fine-grained experts；
- sigmoid gating；
- expert bias。

fine-grained experts 的意思是使用更多、更小的 experts。M2 使用 256 个 experts，每 token 激活 8 个。这样增加了 expert 组合的多样性，也可以降低不同设备之间 expert utilization 的方差。

sigmoid gating 和常见 softmax top-k gating 的区别在于：softmax 有 zero-sum constraint，一个 expert 得分高，其他 expert 得分就会相对被压下去；sigmoid 则是每个 expert 独立打分。报告认为这样可以让多个 expert 同时以较高置信度被激活，routing dynamics 更平滑。

expert bias 则是在 gating score 上加入 per-expert learnable bias，用来改善 load balancing，并减少对 auxiliary load-balancing loss 的依赖。

报告给了一个小规模消融实验：17.8B total params，2B activated params，500B training tokens。

| 配置 | MATH | MMLU | ARC-C | KorBench | HumanEval |
| --- | ---: | ---: | ---: | ---: | ---: |
| baseline | 19.6 | 39.8 | 27.4 | 14.1 | 29.7 |
| + MTP | 21.3 | 39.7 | 27.5 | 15.0 | 30.1 |
| + fine-grained experts | 24.1 | 40.2 | 27.8 | 14.8 | 32.5 |

这里 HumanEval 和 MATH 的提升比较明显。

## Attention: full attention

M2 使用 full attention，而不是 hybrid SWA、linear attention 或 sparse attention。

这里的 full attention 需要和 causal attention 分开理解。M2 是 decoder-only language model，所以 attention 仍然是 causal 的：当前位置只能看过去和当前位置，不能看未来。full attention 指的是在 causal mask 下，每个 token 可以看完整历史 token，而不是只看一个局部 sliding window。

也就是：

```text
causal full attention:
token t can attend to token 1 ... t

causal sliding-window attention:
token t can attend to token max(1, t - W) ... t
```

报告提到，MiniMax 对 hybrid SWA 做了多组继续预训练实验，包括 SWA/full attention 比例、RoPE 设置、layer 内和 layer 间混合、sink token 等。但在 retrieval、多跳推理、in-context learning 和长上下文 agent task 上，SWA variant 有明显损失。

预训练阶段的一组对比：

| Benchmark | full attention | hybrid SWA |
| --- | ---: | ---: |
| HELMET ICL | 75.8 | 72.7 |
| MMLU | 85.5 | 85.6 |
| MATH | 60.3 | 60.3 |
| RULER 128K CWE | 90.0 | 72.0 |
| RULER 128K MQ | 99.0 | 93.0 |
| RULER 32K CWE | 99.0 | 99.0 |
| RULER 32K MQ | 99.0 | 99.0 |
| MTOB K-e Bleurt | 60.0 | 45.0 |
| MTOB e-k ChrF | 44.8 | 27.2 |

从这组数据看，32K 内部分任务中 SWA 与 full attention 差距不大；到 128K retrieval 和 long-context ICL 时，局部窗口的覆盖限制开始体现出来。

对于 agent 任务，长上下文通常包含任务描述、工具输出、失败尝试、文件内容、之前的 reasoning state 等信息。如果 attention 机制不能可靠访问完整历史，后续 planning 和 self-correction 会受到影响。

## MTP

M2 使用 Multi-Token Prediction。预训练阶段先使用单个 MTP module，K = 1，MTP loss weight 从 0.3 anneal 到 0.1。

在 continued pre-training 的 decay phase，M2 把 MTP module 扩展到 K = 3，用于 multi-step speculative decoding。扩展时不是随机初始化，而是从 main model 复制权重初始化。报告里的解释是：

- copy initialization 收敛更快；
- 随机初始化会带来较高 loss，并短暂干扰 main model；
- 先冻结 main model 训练 MTP modules，loss 稳定后再 joint training。

所以 MTP 在 M2 里有两层作用：

- 训练阶段提供更丰富的预测信号；
- 推理阶段作为 speculative decoding 的 draft path。

这个点和 Forge 也有关。RL rollout 期间 policy 在持续更新，如果 MTP draft model 不跟着适配，acceptance rate 会下降。报告提到 Forge 里 MTP modules 会通过 top-K KL divergence loss 和 RL policy 一起 co-train，从而维持 speculative decoding 的效果。

## Pre-training 数据

预训练总量是 29.2T tokens。

报告把它分成：

- constant phase: 19.9T tokens；
- decay phase: 9.3T tokens。

数据来源包括 web documents、academic literature、books、programming code、structured QA。code、math、STEM 会相对自然分布上采样。

长上下文扩展是多阶段完成的：

```text
8K -> 32K -> 192K
```

长上下文数据主要来自：

- high-quality code concatenation；
- naturally long-form PDF documents；
- thematically related document packing。

从报告结构看，M2 的 pre-training 不只服务于通用 base model 能力，也为后续 agent post-training 提供 192K context backbone。

## Post-training 数据

报告真正花篇幅的地方其实是 post-training data collection。

M2 系列的 post-training data 不是普通 chat 数据，而是大量带 workspace、tool、environment、verifiable reward 或 artifact-aligned feedback 的 agent trajectories。

主要分几类：

- Agentic Coding；
- Agentic Cowork；
- Reasoning-intensive tasks；
- General conversation and writing；
- Role-play and persona coherence。

但是这里有一个需要注意的点：**报告没有披露 post-training 的具体数据规模**。

也就是说，论文写了很多 pipeline 和数据类型，但没有给出类似下面这样的硬数字：

- SFT tokens 数；
- RL tokens 数；
- agent trajectories 数；
- SWE/AppDev/Terminal/Cowork 各域样本量；
- rejection sampling 前后 pass rate；
- 每个 stage 的 domain mixing ratio。

报告使用的是 large-scale、corpus、trajectories、at scale 这类描述。能看到的硬规模数字主要集中在 pre-training：29.2T tokens，其中 constant phase 19.9T tokens，decay phase 9.3T tokens。

因此，post-training 部分可确认的信息是：**M2 披露了 post-training 数据构造方法和验证信号，但没有披露各类 post-training data 的样本规模和 token budget**。

### Agentic Coding

Agentic Coding 又分 SWE、AppDev、Terminal-Gym。

SWE pipeline 从 GitHub PR 和 issue 出发，过滤 merged PR、有测试的 PR，再由 agent 构建 Docker environment。之后按 PR 类型做 task routing，比如 bug fix、feature addition、performance optimization、test/refactor 等。

这里最重要的是 reward construction。不同任务类型用不同的验证信号：

- bug fix: F2P / P2P tests；
- feature addition: newly added test points；
- performance optimization: stable and significant performance difference；
- code review: secondary LLM consistency check。

AppDev 则是从零构建应用。它用 expert-in-the-loop 生成 meta queries 和 system prompts，再通过 Agent-as-a-Verifier 做 rejection sampling。AaaV 分三层验证：

- execution layer: 文件、依赖、构建、服务启动、JS error；
- interaction layer: Playwright 检查核心交互；
- visual aesthetics layer: 布局、层次、配色、现代 UI 质量。

Terminal-Gym 则从 Stack Overflow 出发，筛选 terminal-compatible、scriptable、verifiable、Docker-relevant 的任务，然后生成 Dockerfile 和 test script，再做 query evolution 和 difficulty calibration。

这几个 pipeline 的共同点是：数据不只包含最终答案，还包含可执行环境，使结果能够被测试、运行或交互验证。

### Agentic Cowork

Cowork 覆盖的东西更接近知识工作者任务：

- deep search and open-web research；
- knowledge-worker office tasks；
- financial analysis and spreadsheet operations；
- slide generation and editing。

这部分的 reward 更复杂。有些任务可以 deterministic check，比如 spreadsheet cell value match、formula recalculation；有些任务需要 rubric-based judge，比如 report、slides、open-ended financial reasoning。

这个方向是 M2.7 相比 M2.5 提升很明显的地方。后面的指标表里，GDPval-AA、MEWC v2、Finance Modeling Pro 都涨得很大。

### Reasoning 和 general data

Reasoning data 主要强调 scaling：

- query-side scaling: 扩展题目覆盖；
- response-side scaling: 一个 query 采多个正确解法；
- training-side scaling: 在固定计算预算下调 query expansion / response expansion 比例；
- QA: query、verifier、answer、response 多阶段质量控制。

General conversation and writing 则用于保持通用对话、写作、多轮理解，以及 tool-augmented / tool-free 两种能力。

## SFT: interleaved thinking

M2 的 SFT 目标之一是训练 interleaved thinking。

普通 long CoT 往往是：

```text
thinking -> final answer
```

Agent 场景更像：

```text
thinking -> tool call -> observation -> thinking -> tool call -> observation -> final answer
```

报告把它称为 Plan-Act-Reflect loop。关键点是 reasoning state persistence：前一轮的 thinking block 会保留在 history 里，进入下一轮上下文。

这和 stateless per-turn reasoning 不一样。如果每轮工具调用后都把之前的 reasoning 丢掉，模型就要反复重新推导状态，长程任务里容易 drift。

这个地方也能解释为什么 M2 更坚持 full attention：如果 thinking、action、observation 都保留在 192K context 里，模型必须能可靠地访问完整历史。

## Forge 是什么

Forge 是 M2 系列的 agent-native RL training system。

它不是模型结构，也不是单个 RL 算法，而是一套让长程 agent trajectories 能进入 RL 训练闭环的工程系统。

普通 RLHF 或 response-level RL 常见输入是：

```text
prompt -> response -> reward
```

Agent RL 的输入则像：

```text
task
-> reasoning
-> tool call
-> observation
-> reasoning
-> tool call
-> observation
-> artifact / test result / final answer
-> reward
```

轨迹可能有几十 K 到 192K tokens，中间还有工具调用、Docker、browser、spreadsheet、file system、context management、sub-agent delegation。这要求训练系统处理长序列、异步环境和复杂状态转移。

Forge 的系统拆分为：

```text
Agent Side
  run agent loop
  manage context
  call tools / envs
  produce trajectories

Middleware
  Gateway Server
  Data Pool

Training / Inference Side
  Rollout Engine
  Train Engine
```

Agent Side 只负责跑任务和记录轨迹。Rollout Engine 负责高吞吐生成。Train Engine 负责策略更新。Gateway 和 Data Pool 把二者解耦。

一个重要抽象是：Forge 把 LLM generation interface 作为 policy 边界，边界之外的 tool execution、context management、memory access、agent harness 都视为 environment dynamics。

这样它就可以支持两类 agent：

- white-box agent: 训练系统知道它怎么做 context management；
- black-box agent: 训练系统只看到每次发给模型的 state 和模型输出。

black-box support 很重要。因为真实 agent scaffold 往往各有各的 context rewrite、memory、sub-agent、tool protocol。如果要求所有 agent 都白盒接入，系统扩展性会很差。

## Forge 的 RL 算法和 reward

M2 系列 RL 使用 CISPO，Clipped Importance Sampling Policy Optimization。报告里给了 objective 和 importance sampling ratio 的 clipped form。

我先不展开公式，抓几个工程上更重要的点：

第一，训练样本是 `(state, action)` pair。一个 action 是一次 LLM completion，可以包含 reasoning、tool invocation、context operation、sub-agent communication 等。

第二，credit assignment 仍然按完整 episode 做。也就是说，每个 step 的 advantage 要结合整条 trajectory 的结果。

第三，reward 不是只有最终 outcome，而是 composite reward：

```text
r_t = alpha * process_reward_t
    + beta * speed_reward_t
    + performance_reward_t
```

process reward 用于中间行为，比如工具调用格式、语言混杂、reasoning 结构。

speed reward 用于 wall-clock completion time。这个点很 agent：两个 trajectory 都完成任务，但一个串行慢慢跑，一个并行调用工具，后者对产品更有价值。

performance reward 则是最终任务质量，比如测试通过、artifact 正确、rubric score。

第四，使用 mixed-domain RL。每个 stage 同时混合 reasoning、coding、agent、general 四类数据。这样可以降低单一 agent task RL 造成的 catastrophic forgetting。

## Windowed FIFO

Agent rollout 有一个很现实的问题：任务完成时间差异巨大。

```text
simple API task: seconds
coding task: minutes
ML engineering task: hours
```

如果严格 FIFO，训练会被长任务卡住。  
如果谁先完成就训练谁，前期 batch 会被短任务和简单任务主导，后期才出现长任务和难任务，训练分布会漂。

Forge 用 Windowed FIFO 做折中：

```text
queue = [T0, T1, T2, T3, T4, T5, ...]
window = [T0, T1, T2, T3]
```

只允许训练系统消费 window 内已经完成的 trajectories。window 内可以乱序取，window 外即使已经完成也不能提前进入训练。

论文里举的窗口大小例子是 `W = 0.3N`。这个策略牺牲一点点绝对吞吐，换来更稳定的数据分布。

## Prefix tree merging

Prefix tree merging 是 Forge 里最有工程味的优化之一。报告称它最高能带来 40x training speedup，并降低显存占用。

Agent RL 训练中，很多 samples 共享长前缀。例如同一个 rollout group 里可能有：

```text
sample 1 = long context + response A
sample 2 = long context + response B
sample 3 = long context + response C
```

或者同一条 agent trajectory 被拆成多个 step：

```text
s1 -> a1
s2 = s1 + a1 + obs1 -> a2
s3 = s2 + a2 + obs2 -> a3
```

如果每个 sample 独立 forward，`long context` 或历史轨迹会被反复计算。

Prefix tree merging 把这些序列组织成一棵 prefix tree：

```text
long shared context
├── response A
├── response B
└── response C
```

或者：

```text
context
└── action1 + obs1
    └── action2 + obs2
        └── action3 + obs3
```

共享 prefix 只 forward 一次。到分叉点后，再分别计算 branch。forward 结束后，根据元数据把 tree 拆回原始 sample，loss 仍然按 sample 独立计算。

它成立的原因是 causal attention：prefix token 的 hidden states 不依赖后续 branch tokens。后面的 token 可以看前面，前面的 token 不会看后面。

概念伪代码：

```python
samples = [
    ctx + resp_a,
    ctx + resp_b,
    ctx + resp_c,
]

tree = build_prefix_tree(samples)

def forward_node(node, parent_state):
    state = model_forward_segment(
        tokens=node.tokens,
        parent_state=parent_state,
    )

    for child in node.children:
        forward_node(child, state)

forward_node(tree.root, None)

loss = 0
for sample in samples:
    logits = reconstruct_logits(sample, tree)
    loss += compute_loss(logits, sample.labels)

loss.backward()
```

真实实现会复杂很多，要处理 attention mask、position ids、loss mask、MoE routing、activation checkpointing、分布式并行和 backward graph。但核心就是把训练 batch 从独立 sequence list 改成共享前缀树。

这个优化和普通 sequence packing 不同。sequence packing 主要减少 padding；prefix tree merging 则是避免重复计算公共历史。对于 192K context 的 agent RL，这类重复计算会带来较高开销。

## Rollout 侧推理优化

Forge 还做了几类 inference acceleration。

### MTP speculative decoding

M2 的 MTP modules 可以生成 draft tokens，再由 main model 验证。RL 期间 policy 会更新，所以 MTP modules 也要跟着 co-train，否则 draft acceptance rate 会下降。

### Prefill-decode disaggregation

把 prefill 和 decode 分开调度。MoE 模型里 prefill 和 decode 的计算形态不同，混在一起容易互相干扰。拆开后可以分别采用更适合的 parallelism 策略。

### Global L3 KV cache pool

Agent 多轮交互里有大量共享 prefix。Forge 使用分布式 KV cache pool，提高 prefix cache hit rate。router 会在 queue delay 和 cache migration cost 之间做权衡。

从报告描述看，Forge 里的 rollout engine 不只是离线采样服务，而是包含长上下文、KV cache、MoE serving、speculative decoding、prefill/decode separation、多版本权重同步等能力的推理系统。

## 性能数据

M2 系列报告里有几类性能数据，但分布比较散。

第一类是 Forge 训练系统性能。

报告明确给出的硬数字是：prefix tree merging 最高可以达到 **40x training speedup**，同时降低 memory consumption，使更长 sequence 和更大 batch size 成为可能。

其他 Forge 优化更多是定性描述，比如：

- Windowed FIFO 用于在 rollout throughput 和 distributional consistency 之间折中；
- MTP speculative decoding 用于提升 rollout generation throughput；
- prefill-decode disaggregation 用于提升 global throughput 并降低 tail latency；
- global L3 KV cache pool 用于提升 prefix cache hit rate。

但是论文没有给出这些优化各自的 ablation 表，比如没有列出 Windowed FIFO 前后吞吐、GPU utilization、tail latency、KV hit rate、MTP acceptance rate 等数字。

第二类是 agent task 的运行设置，这些不是系统吞吐，但可以反映任务成本：

- agent trajectories 最长可到 192K tokens，并可能包含 thousands of intermediate actions；
- rollout completion time 从 seconds 到 hours；
- Terminal-Bench 2.0 使用 8 vCPU / 16GB sandbox，2 小时 wall-clock timeout，4 trials；
- MLE Bench Lite 对 22 个 competitions 运行，每个 competition 在 single-A30 sandbox 中跑 24 小时，最终取 3 个 independent 24-hour trials 的平均 medal rate；
- VIBE-Pro、HyperTask、MM Claw、MEWC v2、Finance Modeling Pro 等多项 agent / artifact benchmark 使用 3 trials。

第三类是 self-evolution 的内部效率数据：

- M2.7 在 RL team workflow 中吸收 30% 到 50% 的 daily iteration workload；
- 对内部 programming scaffold 做 100-round autonomous iteration；
- 引入 loop detection 和更好的参数组合后，内部评估有 30% performance gain。

这部分属于内部系统和内部评测，不是外部可复现 benchmark。

第四类是部署侧性能数据，来自 NVIDIA 技术博客，而不是 M2 论文主体。NVIDIA 提到在 Blackwell Ultra GPU 上，针对 MiniMax M2 系列在 vLLM / SGLang 集成 QK RMSNorm kernel 和 FP8 MoE kernel 后，在 1K/1K ISL/OSL dataset 上：

- vLLM throughput 最高提升 2.5x；
- SGLang throughput 最高提升 2.7x。

这个数据属于部署工程部分，不应和 Forge 训练系统性能混在一起。Forge 是 post-training / RL infrastructure；NVIDIA 这里讲的是 open-source inference framework 的 serving optimization。

## Forge 实现架构推断

下面是基于报告描述的工程推断，不是官方源码，也不是论文披露的完整实现。

{% mermaid flowchart TB %}
  task["Task Queue<br/>prompts / env specs"]

  subgraph agent["Agent Side"]
    runner["Agent Runner<br/>agent loop<br/>context management<br/>trajectory recording"]
    tools["Tool / Env Servers<br/>Docker / browser / code runner<br/>spreadsheet / file tools"]
    runner <--> tools
  end

  subgraph middleware["Middleware"]
    gateway["Gateway Server<br/>request normalization<br/>model-version tagging<br/>white-box / black-box agent bridge"]
    pool["Data Pool<br/>trajectory storage<br/>reward / logprob metadata<br/>Windowed FIFO batching"]
  end

  subgraph infer["Training / Inference Side"]
    rollout["Rollout Engine<br/>MoE serving<br/>MTP speculative decoding<br/>prefill-decode split<br/>global KV cache"]
    train["Train Engine<br/>sample construction<br/>prefix tree merging<br/>CISPO update"]
  end

  task --> runner
  runner -- completion request --> gateway
  gateway --> rollout
  rollout -- completion --> gateway
  gateway -- action --> runner
  runner -- state / action / observation --> pool
  tools -- verification / reward signal --> pool
  pool -- training batch --> train
  train -- updated weights --> rollout
  rollout -- model version / logprobs --> pool
{% endmermaid %}

图里的关键边界是 Gateway：Agent Side 可以保持 scaffold 差异，Training / Inference Side 则通过统一的 completion 接口接收请求、记录元数据，并把 rollout 数据回流到 Data Pool。

Prefix tree merging 可以单独画成下面这个形态：

{% mermaid flowchart LR %}
  subgraph before["Before: independent samples"]
    b1["ctx + a"]
    b2["ctx + b"]
    b3["ctx + c"]
  end

  subgraph after["After: prefix tree"]
    ctx["shared ctx"]
    a["branch a"]
    b["branch b"]
    c["branch c"]
    ctx --> a
    ctx --> b
    ctx --> c
  end

  before --> after
{% endmermaid %}

共享 prefix 只做一次 forward，分叉后的 response segment 分别计算；forward 结束后再根据元数据还原到原始 sample 计算 loss。

根据 Forge 的训练需求，Data Pool 可能需要记录这些字段：

```text
trajectory_id
task_id
domain
model_version
states
actions
observations
token_ids
old_logprobs
process_rewards
final_reward
wall_clock_time
tool_calls
artifact_paths
verification_result
```

Train Engine 的处理流程可以抽象为：

```python
trajectories = data_pool.fetch_windowed_fifo_batch()

samples = []
for traj in trajectories:
    for step in traj.steps:
        samples.append({
            "input_ids": step.state_tokens,
            "target_ids": step.action_tokens,
            "old_logprobs": step.old_logprobs,
            "advantage": compute_advantage(traj, step),
        })

batch = prefix_tree_merge(samples)
loss = cispo_loss(batch)

loss.backward()
optimizer.step()

rollout_engine.sync_weights(model)
```

这里的关键是 old logprobs 和 model version。RL rollout 和 training 之间一定存在 policy lag，所以需要知道 trajectory 是哪个旧 policy 采样出来的，再通过 importance sampling ratio 做修正。

## 指标

论文 Table 4 给了 M2.7、M2.5 和几个闭源 frontier baseline 的对比。这里只摘 M2.7 和 M2.5。

| Benchmark | M2.7 | M2.5 |
| --- | ---: | ---: |
| SWE-bench Pro | 56.2 | 55.4 |
| SWE-bench Multilingual | 76.5 | 74.1 |
| Multi-SWE-bench | 52.7 | 51.3 |
| NL2Repo | 39.8 | 26.6 |
| Terminal-Bench 2.0 | 57.0 | 51.7 |
| MLE Bench Lite | 66.6 | 51.5 |
| VIBE-Pro | 55.6 | 54.2 |
| HyperTask | 67.6 | 59.4 |
| BrowseComp | 77.8 | 76.3 |
| Wide Search | 75.2 | 70.3 |
| RISE | 64.3 | 50.2 |
| GDPval-AA | 50.0 | 35.0 |
| Toolathlon | 46.3 | 38.3 |
| MM Claw | 62.7 | 57.6 |
| MEWC v2 | 63.3 | 49.8 |
| Finance Modeling Pro | 57.0 | 33.8 |
| AIME 2026 | 94.2 | 87.2 |
| GPQA-Diamond | 89.8 | 85.2 |
| SciCode | 47.0 | 43.0 |
| IFBench | 76.0 | 72.0 |
| AA-LCR | 72.0 | 65.0 |
| HLE | 28.0 | 19.0 |
| MMLU-Pro | 81.8 | 85.2 |

从表中可以看到：

- M2.7 相比 M2.5 的大幅提升集中在 agent / cowork / office / MLE；
- Finance Modeling Pro 从 33.8 到 57.0；
- GDPval-AA 从 35.0 到 50.0；
- MEWC v2 从 49.8 到 63.3；
- MLE Bench Lite 从 51.5 到 66.6；
- MMLU-Pro 从 85.2 降到 81.8。

这说明 M2.7 不是所有传统静态知识 benchmark 都提升。报告更强调的是：agent data pipeline 和 Forge RL 对真实 workflow benchmark 的提升。

## M2.7 的 self-evolution

报告里还提到 M2.7 的 self-evolution。

MiniMax 的说法是，M2.7 可以在内部 Model Iteration System 里帮助 RL 团队：

- profile ongoing runs；
- read logs；
- diagnose metric anomalies；
- debug code；
- adjust configs；
- generate reports；
- modify agent scaffold。

报告称它可以吸收 RL 团队日常 30% 到 50% 的 iteration workload。另一个例子是，M2.7 对内部 programming scaffold 做了 100-round autonomous iteration，引入 loop detection 和更好的参数组合，在内部评估上带来 30% performance gain。

这部分高度依赖内部工作流和内部评测，应视为官方披露的内部案例，而不是外部可复现实验结论。

## 总结

M2 系列报告的重点不只是单个 benchmark，而是一套完整路线：

```text
low-activation MoE backbone
-> long-context full attention
-> MTP for training signal and speculative decoding
-> verifiable agent trajectory data
-> interleaved thinking SFT
-> Forge agent-native RL
-> rollout / training / serving co-optimization
```

如果只看参数，M2 是一个 229.9B total / 9.8B activated 的 MoE 模型。  
如果看训练，它是一个围绕可验证 agent trajectories 做 post-training 的模型。  
如果看工程，Forge 才是这篇报告里很关键的东西：它把 agent loop、推理服务、轨迹存储、reward、RL trainer 和权重同步接成一个系统。

这也是 M2 系列和很多只讲模型结构的技术报告不同的地方。它把模型能力放在完整 agent workflow 里讲，重点不是“模型会不会回答”，而是“模型能不能在环境里把事情做完，并且这个训练闭环能不能规模化”。
