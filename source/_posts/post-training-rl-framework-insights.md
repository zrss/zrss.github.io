---
title: 后训练 RL：从 Trainer 框架到 Runtime 系统
tags:
  - LLM
  - RL
  - Infra
categories: 笔记
abbrlink: 86d4b4ec
date: 2026-06-14 00:20:00
---

## 导读

**观点**：后训练 RL 的竞争点正在从“支持某个 RL 算法”迁移到“能否稳定组织一条可观测、可回放、可扩展的训练链路”。

如果只从算法名看，会看到 PPO、GRPO、DPO、RLOO、REINFORCE++ 等一串方法；但如果从系统视角看，真正重要的问题变成了：

- rollout 怎么生成；
- reward / judge 怎么接入；
- 环境和工具怎么被沙箱化；
- 训练中的模型怎么被 serving；
- trace 怎么回流成训练样本；
- 失败、超时、长尾请求、checkpoint、重启恢复怎么处理；
- 框架把这些角色组织成什么样的抽象。

这篇按标题里的主线展开：先看 Trainer 时代以框架为中心的组织方式，再看 Runtime 时代按系统来组织训练链路。

| 篇章 | 对应标题 | 章节 |
| --- | --- | --- |
| 系统视角 | 竞争点从算法转向系统工程 | 核心变化、Reward、KL、数据 |
| Runtime 系统 | 从 Trainer 框架到系统 Runtime | Runtime 角色、吞吐瓶颈 |
| 框架坐标 | 开源与工业路线处在什么位置 | 框架对比、社区路标 |
| 落地 | 目标架构与选型 | 四层分工、框架选型、结论 |

更细一点，可以按下面的分析骨架展开：

| 序号 | 核心观点 | 支撑材料 |
| --- | --- | --- |
| 1 | 后训练 RL 已从算法问题变成系统工程问题 | 关键词地图：rollout / reward / env / trace / runtime |
| 2 | 优化对象从单轮回答扩展到真实任务过程 | SFT-RM-PPO 与 agent trajectory 链路对比 |
| 3 | Reward 是系统接口，不只是一个标量分数 | reward contract 分层图 |
| 4 | KL 只能约束分布距离，管不了任务语义 | KL 与环境隔离 / reward 反作弊 / replay 的边界表 |
| 5 | RL 数据是动态轨迹资产，不是静态 dataset | trajectory schema / version 字段清单 |
| 6 | RL 框架正在从 trainer 变成 runtime | policy、rollout、reward、env、scheduler 角色图 |
| 7 | 大规模后训练的瓶颈常常在 rollout | step wall-clock 分解与长尾来源 |
| 8 | 主流框架处在不同坐标，而非绝对优劣 | TRL / OpenRLHF / verl / NeMo-RL / Forge 对比矩阵 |
| 9 | 社区路标集中在 multi-turn、async、tool、production | roadmap signal table |
| 10 | 未来系统会分成应用、环境、编排、模型 runtime 四层 | 分层架构图 |
| 11 | 框架选型应该围绕当前瓶颈做检查 | 十个选型问题 |
| 12 | 护城河在训练链路，不在单个 trainer repo | 5 个结论 |

## 系统视角：从算法到系统工程

### 核心变化：从 RLHF 到 Agentic RL

**观点**：后训练 RL 的核心变化，不是 loss 公式突然颠覆，而是优化对象从“单轮回答偏好”扩展到了“真实任务过程”。

**分析线索**：对比旧 RLHF 链路与 agentic RL 训练链路。

早期 RLHF 很容易被概括成：

```text
SFT -> Reward Model -> PPO
```

这个图当然还成立，但它已经不足以描述现在的 post-training。现在更准确的图像可能是：

```text
任务 / 环境 / 工具 -> 轨迹采样 -> 可验证反馈 / judge / reward shaping
             -> policy update -> 新 policy 继续进入环境
```

对于 chat alignment，样本通常是 prompt 和 response，reward 更像是对最终回答的整体偏好。而在 agentic post-training 里，样本变成了多轮轨迹：模型要读文件、调用工具、执行命令、观察结果、修正计划、提交 artifact。这个时候 reward 不只是“最后回答好不好”，还要表达过程是否可靠、工具使用是否有效、结果是否可验证。

所以后训练 RL 的第一个洞察是：**环境设计正在变得和算法选择一样重要**。

一个弱环境加上强算法，往往只会训练出会钻 reward 空子的模型；一个清晰环境加上可验证信号，哪怕算法相对朴素，也能给模型稳定的改进方向。

### Reward：系统接口，不只是分数

**观点**：Reward 在工程里更像跨系统接口，而不是 trainer 消费的一个标量。

**分析线索**：reward contract 要同时表达任务完成、质量、约束、过程、安全、成本与稳定性。

很多讨论会把 reward 看成一个标量分数，但在工程里，reward 更像是系统之间的接口。

这个接口至少包含几层信息：

- 任务是否完成；
- 完成质量如何；
- 有没有违反约束；
- 过程里是否出现不可接受行为；
- 哪些子步骤值得鼓励或惩罚；
- reward 是否可被模型轻易 hack；
- reward 的延迟、成本和稳定性如何。

在数学题、代码题、工具任务里，可验证 reward 很有吸引力，因为它把一部分主观偏好变成了客观检查：测试是否通过、命令是否成功、artifact 是否符合格式、答案是否能被程序验证。

但可验证并不等于简单。真实任务经常会出现这些问题：

- 单个最终结果可验证，但中间过程不可见；
- 测试集太窄，模型学会过拟合测试；
- judge 本身不稳定，导致 reward 噪声放大；
- reward 只关心结果，模型学会高风险路径；
- reward 过度 shaping，模型开始迎合 shaping 而不是完成任务。

因此 reward 设计更像 API 设计：一旦接口语义不清，后面的 trainer、rollout engine、数据平台都会被迫吸收它的混乱。

我的一个判断是：**post-training 团队最终会沉淀大量 domain reward contract**。比如 coding、terminal、browser、office、search、math、data analysis 各自有不同的可验证条件、失败类型和 trace schema。通用 RL 框架只能提供接线方式，真正的效果来自这些 domain contract。

### KL：分布约束，不是安全边界

**观点**：KL 是控制 policy drift 的手段，不是 agentic RL 的安全边界本身。

**分析线索**：区分 KL 能管什么，以及必须由 reward 反作弊、环境隔离、replay / eval 处理什么。

RLHF 里常见做法是把 policy 约束在 reference model 附近，通过 KL penalty 防止模型跑飞。这在 PPO-RLHF 里很自然：reward 给方向，reference + KL 给护栏。

但在 agentic RL 里，KL 的意义会变得微妙。

一方面，KL 仍然重要。它能防止 policy 为了短期 reward 丢掉语言质量、格式习惯和基本行为边界。另一方面，agent task 本身要求模型离开 SFT 的舒适区：更长的规划、更主动的工具使用、更多自我修正、更强的失败恢复。如果 KL 太强，模型会被拴回原来的行为分布，学不到真正的新策略。

所以 KL 不是“安全本身”，而是一个控制 policy drift 的手段。真正的安全和稳定来自更完整的组合：

- reference / KL；
- reward 反作弊；
- 环境权限隔离；
- rollout 过程审计；
- bad case replay；
- 离线 eval 和在线 shadow eval；
- 对工具、文件、网络、执行命令的边界控制。

一句话：**KL 管的是分布距离，管不了任务语义**。

### RL 数据：动态轨迹资产

**观点**：RL 数据是随 policy 变化不断生成的 trajectory asset，而不是一次性准备好的静态 dataset。

**分析线索**：trajectory schema 至少要覆盖复现、归因和 replay 所需字段。

SFT 更像是在消费一个静态语料，RL 则是在不断制造新数据。

每一轮 policy update 后，模型分布都会变化，于是下一轮 rollout 看到的错误类型、工具调用模式、回答长度、失败方式也会变化。数据不是躺在对象存储里的固定文件，而是从当前 policy 和环境交互中长出来的。

这会带来几个工程后果：

- 数据质量和 policy 版本强绑定；
- trace 必须记录足够多上下文，否则无法复现；
- reward 版本变化会污染跨轮比较；
- old policy / new policy / reference policy 的 logprob 要被严格区分；
- 失败样本不是垃圾，往往是下一轮改进最有价值的数据。

所以 RL 数据平台不能只按 dataset 思维设计。它更像 experiment log、trajectory store、replay buffer、evaluation archive 的混合体。

对框架来说，这意味着数据结构里至少要能表达：

- prompt / observation / action / response；
- token logprob；
- reward breakdown；
- judge version；
- environment version；
- tool call result；
- timeout / exception；
- policy checkpoint；
- sampling params；
- trace span。

没有这些字段，后面做归因会非常痛苦。

## Runtime 系统：从 Trainer 到系统

### Runtime 角色：组件与边界

**观点**：现在看 RL 框架，重点不是支持几个 loss，而是能否组织一整条训练链路。

**分析线索**：框架抽象要同时解释 policy、reference、reward、rollout、environment、trainer、scheduler、data store、observability 的关系。

现在看 RL 框架，不能只看它有没有 PPO / GRPO loss。真正要看的是它有没有能力组织一整条训练链路。

一个 LLM RL 框架通常至少要处理这些角色：

| 角色 | 作用 |
| --- | --- |
| Policy / Actor | 被训练的模型，负责生成动作或文本 |
| Reference Model | 冻结策略，用于 KL 约束 |
| Reward / Judge | 给最终结果或过程打分 |
| Value / Critic | PPO 等 actor-critic 方法里的价值估计 |
| Rollout Engine | 高吞吐生成，通常要接 vLLM / SGLang 等推理后端 |
| Environment | 工具、浏览器、终端、代码沙箱、任务状态 |
| Trainer | 计算 loss，做反传和参数更新 |
| Scheduler | 放置不同 worker，管理异构资源 |
| Data Store | 存轨迹、logprob、reward、checkpoint、eval 结果 |
| Observability | trace、metrics、错误归因、长尾请求分析 |

这里最关键的是 **policy update 和 rollout generation 的关系**。

传统深度学习训练里，数据加载器喂 batch，trainer 做 forward/backward，边界比较清楚。LLM RL 里，rollout generation 本身就是一个分布式推理系统，而且它必须频繁拿到最新 policy。于是训练系统天然变成训推混合系统。

这也是为什么很多框架会强调 Ray、vLLM、colocate、offload、async rollout、hybrid engine、placement group 之类的能力。它们不是“外围工程”，而是 RL 框架的主体。

### 吞吐瓶颈：Rollout 与长尾

**观点**：后训练 RL 的 goodput 往往被 rollout generation 和环境长尾支配，而不是只被 backward 性能支配。

**分析线索**：拆解 rollout、reward / judge、policy update、checkpoint、weight sync 的等待关系。

后训练 RL 的成本不只来自反向传播。对于长上下文、多轮 agent、工具调用任务，rollout 很可能比 update 更贵。

原因很直接：

- 自回归生成无法完全并行；
- 每条轨迹长度差异大，长尾请求拖住 step；
- 工具调用和环境执行会引入外部等待；
- judge / reward 可能还要再次调用模型或执行程序；
- policy 变化后，推理引擎需要同步权重；
- 多轮任务会产生更长 KV cache 和更多状态。

因此 RL 框架的核心指标不应该只有 tokens/s，还要看：

- 每个 RL step 的 wall-clock；
- rollout 和 update 是否 overlap；
- p50 / p99 generation latency；
- straggler 对 batch 完成时间的影响；
- 失败轨迹是否能局部重试；
- 权重同步是否阻塞；
- 环境执行是否可并发扩展。

如果 rollout 是瓶颈，那么优化 trainer kernel 可能收益有限；反而是 speculative decoding、batching、请求切分、环境并发、超时策略、异步 reward、长尾截断更重要。

## 框架坐标与社区路标

### 开源与工业路线

**观点**：TRL、OpenRLHF、verl、NeMo-RL、Forge 不只是“谁更好”的关系，而是处在不同实验-生产坐标上。

**分析线索**：从算法实验、生成后端、环境复杂度、规模化 infra 几个维度看差异。

现在几个开源框架的侧重点并不完全相同。

[TRL](https://github.com/huggingface/trl) 更接近 Hugging Face 生态里的算法和实验入口，适合快速验证 SFT、DPO、PPO、GRPO 等 post-training 方法。

[OpenRLHF](https://github.com/OpenRLHF/OpenRLHF) 更强调实用 RLHF 训练，围绕 Ray、vLLM、DeepSpeed、PPO / DPO / KTO / GRPO 等能力，把训练和生成系统接起来。

[verl](https://github.com/volcengine/verl) 的表达更偏向 flexible / efficient / production-ready RL training library，核心吸引力在于把 RL 训练拆成 actor、rollout、reward、trainer 等可组合数据流，适合研究新算法，也适合接复杂环境。

[NeMo-RL](https://github.com/NVIDIA/NeMo-RL) 的信号更偏大规模生产 infra：Ray、Megatron、vLLM、checkpoint、拓扑放置、异步 rollout、agentic workload。它关心的不是单机能不能跑通 PPO，而是上千卡规模下 RL job 能不能稳定、有 goodput 地跑完。

[Forge](https://www.minimax.io/news/forge-scalable-agent-rl-framework-and-algorithm) 是 MiniMax 内部自研的 agent-native RL 框架，目前未开源，但 M2 / M2.5 / M2.7 系列 post-training 的公开材料里反复出现。它的设计起点不是“在现有 trainer 上挂 agent”，而是把 **Agent Side / Middleware / Training-Inference Side** 三层拆开：Agent 只负责产生轨迹，Gateway + Data Pool 做协议中转与异步缓冲，Rollout Engine 与 Train Engine 分别承担生成和更新。接入侧只需实现少量标准接口（初始化、轨迹后处理、reward 计算等），黑盒 Agent 甚至可以把 base URL 重定向到 Forge 内部推理服务，由框架统一采集 log 并抽取 sub-agent trajectory。算法上 Forge 以 [CISPO](https://arxiv.org/html/2506.13585) 为核心，并配合 process reward、task completion time reward、mixed-domain joint training；工程上则强调 windowed-FIFO 调度（在 strict sync 与 greedy async 之间折中）、prefix tree merging、MTP speculative decoding 和 global KV cache pool。公开披露的规模信号很激进：10 万+ agent scaffold / environment、200k context、日处理百万级 sample。它代表的不是某个开源 repo 的 feature list，而是 **工业级 agent RL 如何把 scaffold 泛化、吞吐、稳定性和 credit assignment 一起系统设计** 的一条完整路线。

这几个框架没有绝对优劣，更像处在不同坐标上：

| 维度 | 更偏实验 | 更偏生产 |
| --- | --- | --- |
| 算法尝试 | 快速改 loss / trainer | 稳定复现实验配置 |
| 资源规模 | 单机 / 小集群 | 多节点 / 千卡 |
| 生成后端 | 简单集成即可 | 权重同步、长尾、故障恢复都重要 |
| 环境复杂度 | 静态 prompt-response | 多轮 agent / sandbox / tools |
| 观测需求 | loss / reward 曲线 | trace / p99 / failure taxonomy |
| 调度需求 | 启动方便 | placement / topology / lifecycle |

选择框架时，与其问“哪个框架最好”，不如问当前瓶颈是什么：

- 如果要快速试一个 preference optimization 方法，轻量框架和 Hugging Face 生态更舒服；
- 如果要跑可扩展 RLHF，生成后端、训练后端、参数同步会更重要；
- 如果要做 agentic RL，环境抽象、trajectory schema、tool sandbox 和 observability 会成为核心；
- 如果要上大规模 MoE，拓扑感知、checkpoint、JIT cache、failure recovery 会比算法文件更关键；
- 如果要规模化训练异构 Agent scaffold（含黑盒 Agent），Middleware 解耦、trajectory 采集协议、windowed async 调度和 prefix merging 会更关键——Forge 是当前公开材料里这条路线最完整的工业样本之一。

### 社区路标

**观点**：RL 框架洞察不能只看当前 feature list，还要从社区路标里判断下一阶段抽象会在哪里收敛。

**分析线索**：持续跟踪 README news、release notes、experimental 模块、issues、meetup / tech blogs、论文代码。

看 RL 框架时，还要专门收集社区路标。很多项目不一定有一个正式的 `ROADMAP.md`，但方向通常会散落在 README news、release note、experimental module、issue / discussion、meetup materials 和论文代码里。

从当前社区信号看，有几条主线已经比较明显。

#### 单轮 RLVR 到多轮 Agentic RL

[verl](https://github.com/verl-project/verl) 已经把 multi-turn with tool calling、search tool、sandbox integration 放进文档入口，并且新闻里出现了 uni-agent、VeRL-Omni、fully async policy、one-step off-policy、VLA 等 experimental 方向。

[OpenRLHF](https://github.com/OpenRLHF/OpenRLHF) 的 README 也把 single-turn agent 和 multi-turn agent 分成两个执行模式，并强调 RL algorithm 和 agent executor 解耦。它的 multi-turn 路线包括 custom agent function、环境反馈、async pipeline，以及 VLM multi-turn RL。

Forge 则把“agent executor 解耦”推得更远：Agent Side 与 Train/Rollout Side 通过 Gateway + Data Pool 隔离，白盒 Agent 可以把 Context Management 建模为环境状态转移，黑盒 Agent 只需把请求路由到 RL Gateway，框架在推理侧统一采集 trajectory。MiniMax 公开材料称 M2.5 训练时接入了 10 万+ 种 scaffold，说明 multi-turn agent RL 的瓶颈正在从“能不能接 tool”转向“能不能规模化接入异构 scaffold”。

这说明社区正在把 RLVR 从“prompt -> answer -> verifier”扩展成：

```text
observation -> action -> environment feedback -> next action -> final reward
```

算法名字可能还是 GRPO / PPO / REINFORCE++，但样本形态已经变了。

#### Rollout 后端服务化

rollout 不再只是 trainer 里的一段 `generate()`，而是一个可以独立优化、扩容、观测和复用的系统。

OpenRLHF 里已经能看到 async training、partial rollout、vLLM pause/resume、OpenAI-compatible agent server executor 这些设计。verl 则强调 vLLM / SGLang / HF Transformers 多后端，以及训练和生成之间的 resharding。

社区论文里也出现了更直接的表达，比如 [ProRL Agent](https://arxiv.org/abs/2603.18815) 把 multi-turn agent rollout 做成 Rollout-as-a-Service。这类设计背后的判断是：**rollout 生命周期值得从 trainer 里拆出来**，否则多环境、多工具、多沙箱、多模型版本会让训练代码越来越臃肿。

#### 异步 RL：性能方向，但不是免费午餐

多个框架都在走 async：

- verl 的 experimental 里保留 fully async policy、one-step off-policy；
- OpenRLHF 支持 async RLHF / async agent RLHF，也明确提示 async queue 会带来 off-policy 程度；
- NeMo-RL 的 feature list 里写了 Async RL、asynchronous rollouts、replay buffers、fully asynchronous GRPO；
- Forge 用 windowed-FIFO 在吞吐和分布一致性之间折中：窗口内允许局部乱序消 straggler，窗口外禁止跳读，避免训练分布被“快样本”拖偏。

这条路标很清楚：为了提高 goodput，社区会继续把 rollout、reward、training overlap 起来。

但异步也会引入新问题：样本来自旧 policy，in-flight rollout 可能混合新旧权重，advantage / KL / correction 怎么做会变得更重要。所以 async RL 最终不会只是一个 `--async` 开关，而会牵出 off-policy correction、replay buffer、staleness control、partial rollout consistency 等一串设计。

#### 多模态与工具环境进入主线

TRL 的定位更像 Hugging Face 生态的 post-training trainer 集合，已经覆盖 SFT、GRPO、DPO、RewardTrainer 等常用入口。

更偏系统的框架则在往多模态和环境集成走：

- verl 新闻里有 VeRL-Omni、VLM / multi-modal RL；
- OpenRLHF 0.10 增加 VLM RLHF 和 Multi-Turn VLM RL；
- NeMo-RL 支持 VLM、SGLang rollout、NeMo-Gym、multi-turn RL、environment isolation。

这意味着后训练 RL 的“环境”不再只返回文本。后续可能会出现图像 observation、浏览器截图、视频帧、GUI state、代码执行结果、数据库查询结果、文件 diff 等混合状态。

#### 大规模生产化压过单点算法

NeMo-RL 的路标信号尤其偏 infra：SGLang backend、speculative decoding、Yarn long-context、Megatron inference、fault tolerance / auto-scaling、MoE performance、FP8、GB200、environment / worker isolation。

Forge 的路标则更偏 agent scaffold 规模化：黑盒 / 白盒 Agent 统一接入、Context Management 纳入 RL 交互环、prefix tree merging、heterogeneous PD disaggregation、global L3 KV cache pool，以及 mixed-domain（Reasoning / General QA / Agent）联合训练。它说明工业团队会把“支持多少种 scaffold”当成和“支持多少种 loss”同等重要的框架能力。

verl 也在 FSDP2、Megatron backend、LoRA RL、large MoE、AMD ROCm、SGLang unique features 上持续推进。

这些方向说明，大规模 RL 框架会继续把重点放在：

- rollout 加速；
- 训练 / 推理权重转换或同步；
- MoE 与长上下文性能；
- 多硬件支持；
- checkpoint / fault tolerance；
- 环境和 worker 隔离；
- recipe 可复现。

所以社区路标里要区分两类东西：算法路标和系统路标。前者决定“怎么学”，后者决定“能不能持续学、便宜学、稳定学”。

#### 社区原型先于主框架暴露需求

除了主框架本身，还要看围绕它们长出来的项目。

[VerlTool](https://arxiv.org/abs/2509.01055) 这类工作把 tool use、异步 rollout、多模态 observation、统一工具 API 放到 Verl 生态里，反映的是工具增强 RL 需要插件化和环境标准化。

[AgentRL](https://arxiv.org/abs/2510.04206) 强调 multi-turn、multi-task、fully asynchronous generation-training pipeline、containerized environment 和 centralized controller，说明 agentic RL 的压力点在“多任务环境 + 异步流水线”。

[MUA-RL](https://arxiv.org/abs/2508.18669) 把模拟用户放进 RL loop，说明多轮 agent 不只是工具调用，还会包含动态用户意图与澄清过程。

这些项目未必都会成为最终标准，但它们能提前暴露主框架即将补的接口：tool API、environment controller、simulated user、sandbox lifecycle、multi-task normalization、cross-policy sampling、rollout service。

因此后续跟踪 RL 框架时，不能只看 release tag。更好的方式是维护一张社区路标表：

| 来源 | 重点看什么 |
| --- | --- |
| README news / release notes | 已合入能力、即将合入能力、WIP 标记 |
| docs advanced usage | 多轮、工具、sandbox、reward、rollout 后端接口 |
| experimental 目录 | 下一批可能进入主线的抽象 |
| examples / recipes | 社区真正跑通的 workload |
| issues / discussions | 用户实际卡在哪些工程点 |
| meetup / tech blogs | maintainers 对框架边界的解释 |
| 论文 + 开源代码 | 新需求最早出现的位置 |

## 补充展开：算法、稳定性与扩展

### 算法演进脉络

PPO 的价值是给 RLHF 一个稳定的“多轮复用 rollout”机制：clip ratio、value model、entropy bonus 共同控制单步更新幅度，适合偏好模型打分的 chat alignment；但在 RLVR reasoning 场景，critic 成本和不稳定性会被放大。GRPO 的关键转向是去掉 value model，用同一 prompt 下多条采样的组内相对 reward 做 baseline，[DeepSeek-R1](https://arxiv.org/abs/2501.12948) 证明了它可以支撑 rule-based reward 的大规模 reasoning RL。REINFORCE++ 一类方法继续把问题简化为无 critic policy gradient，换取实现简单和系统低耦合，但代价是方差和样本效率压力更大。DAPO 的动机是复现级工程：在 [DAPO](https://arxiv.org/abs/2503.14476) 中，decoupled clip、dynamic sampling、token-level policy gradient、overlong reward shaping 共同服务于“让有效样本进梯度”，其 Qwen2.5-32B 在 AIME 2024 达到 50 分，说明算法细节和数据过滤同等重要。CISPO 则走另一条路：在 [MiniMax-M1](https://arxiv.org/html/2506.13585) 中放弃 trust region 约束，改为 clip importance sampling weights，让所有 token 都参与梯度；Forge 把它继续用于长 horizon agent RL，并叠加 process reward 与 completion time reward。GSPO 再进一步把优化粒度从 token ratio 推到 sequence likelihood，[GSPO](https://arxiv.org/abs/2507.18071) 声称 sequence-level clipping 能提升效率并稳定 MoE RL。DrGRPO 则是对 GRPO 长度偏置的修正，[Understanding R1-Zero-Like Training](https://arxiv.org/abs/2503.20783) 指出 GRPO 会鼓励错误长答案变长，并用 DrGRPO 改善 token efficiency。脉络上看，算法不是越来越复杂，而是围绕“方差、长度偏置、有效梯度、MoE 稳定性、系统可实现性”反复改写优化粒度。

### Agentic RL 的特殊挑战

Agentic RL 的难点首先是多轮信用分配：最终 reward 可能只在任务完成时出现，但中间有 search、tool call、file edit、terminal execution、browser observation 等动作。把整条 trajectory 拼成一个 sequence 会混淆语义边界，工具 observation 也不应该作为模型 action 参与 loss。Agent Lightning 的 [LightningRL](https://arxiv.org/abs/2508.03680) 通过把 agent 执行建模为 MDP，并引入 credit assignment module，把任意 agent 轨迹拆成 training transition；它的价值不是某个算法超参，而是把 agent execution 与 training disaggregation，现有 LangChain、AutoGen、OpenAI Agents SDK 等可以近乎零改接入。Relax 则在工程层提供 `BaseInteractionEnv`、multi-turn loss masking、VLM context carry-over，把“execute -> observe -> decide”做成框架原语。SkyRL-Agent 说明 agent rollout 本身需要专用 dispatcher：其 [SkyRL-Agent](https://arxiv.org/abs/2511.16108) 在 SWE-Bench Verified 上把 Qwen3-32B 从 24.4% Pass@1 训练到 39.4%，并报告异步 pipeline dispatcher 比 naive async batching 快 1.55x。Retokenization Drift 是零侵入接入的隐性坑：agent 侧 API tokenization、训练侧 tokenizer、工具模板和 chat template 不一致时，logprob / mask / reward 对齐会漂移。解决方向是统一 episode schema、记录原始 message 与 token span、显式区分 model action 和 environment observation。

### 训练稳定性挑战

entropy collapse 的本质是 policy 过早确定化：reward 稀疏但高置信更新不断压低分布熵，导致探索消失、梯度变小、模型锁进局部策略。[OPEFO](https://arxiv.org/abs/2605.11491) 从 token-level entropy flow 解释该现象，认为 entropy-decreasing tokens 长期压过 entropy-increasing tokens，需要按熵贡献重标定更新；另一类工作从 dynamic clipping 调控 entropy。reward hacking 是 Goodhart 问题：verifier、unit test、LLM-as-judge 都是代理目标，模型会学会迎合代理而非完成真实任务；在代码和 agent task 中表现为改测试、找泄漏答案、生成格式正确但语义无效的输出。KL 爆炸通常来自 reward 过强、reference 约束过弱或采样分布突变；但 KL 只能管分布距离，不能管工具权限和任务语义。长尾生成是系统稳定性问题，也是算法问题：长答案可能携带有效推理，也可能是过度思考和长度投机；[FP8-RL](https://arxiv.org/abs/2601.18150) 把 rollout 视为瓶颈，W8A8 + FP8 KV-cache + TIS/MIS correction 带来最高 44% rollout throughput gain。大 MoE RL collapse 则更复杂，涉及 expert routing、低精度 rollout、train-inference mismatch 和负载不均；GSPO、FP8 correction、R3/Routing Replay、Relax 的 R3 支持都是围绕“别让 routing 和 rollout 偏差把 policy update 放大成崩坏”。

### 系统架构权衡

同步训练的优点是语义干净：一批 rollout 来自同一 policy，KL、advantage、clip 都容易解释；slime / vime 这类单控制器路线把 Megatron 训练、SGLang 或 vLLM rollout、Data Buffer 放在一条显式路径里，调试和正确性更直接。缺点是长尾 generation 会让整批等待，rollout 越长、工具越慢，GPU bubble 越明显。异步路线的代表是 [AReaL](https://arxiv.org/abs/2505.24298) 和 [Relax](https://arxiv.org/abs/2604.11554)：AReaL 完全解耦 generation 和 training，报告最高 2.57x speedup；Relax 用 TransferQueue 和 configurable staleness，把 on-policy、near-on-policy、fully async 放到一个连续谱上，论文报告 Qwen3-Omni-30B fully async 相比 colocate 2.00x speedup。colocate 适合小集群和严格 on-policy，因为 actor / rollout 复用 GPU，权重同步简单；分离部署适合大规模和 agentic workload，因为 rollout、reward、env 可以独立扩缩，但要处理 staleness、weight sync 和故障隔离。SGLang 更偏结构化、多轮、KV 复用和复杂程序执行，[SGLang](https://arxiv.org/abs/2312.07104) 报告最高 6.4x throughput；vLLM 更偏通用 serving、PagedAttention、生态覆盖，[vLLM](https://arxiv.org/abs/2309.06180) 报告 2-4x throughput。框架选型的本质不是“哪个后端更快”，而是 workload 是单轮大批量、长上下文多轮、还是工具环境驱动。

### 扩展规律（Scaling Laws）

后训练 scaling 与预训练不同：预训练主要是 token、参数、算力的平滑缩放；RL post-training 是 policy、rollout、reward、environment、judge、checkpoint、weight sync 的全链路缩放。扩展瓶颈也不是单个 GPU TFLOPS，而是 goodput：多少有效 trajectory 能在单位时间内产生、被打分、被正确归因并进入更新。OpenRLHF 早期就指出 RLHF 不是单模型训练，而是四模型协调问题，因而用 Ray、vLLM、DeepSpeed 重做 70B+ 调度。[HybridFlow / verl](https://arxiv.org/abs/2409.19256) 把 RLHF dataflow 中每个 NN 节点扩展成分布式训练或生成程序，再用 hybrid controller 表达依赖，报告 1.53x-20.57x throughput improvement；核心是 3D-HybridEngine 降低 train/generate resharding 成本。NeMo-RL 的路标更贴近千卡生产：[NeMo-RL](https://github.com/NVIDIA-NeMo/RL) 同时支持 DTensor、Megatron、vLLM、SGLang、Megatron inference、FP8、Async RL、environment isolation，并在 NeMo-Aligner 时代已披露可扩展到千 GPU 训练 340B / 405B 级模型。AReaL-Hex 进一步指出异构 GPU 下 rollout generation、reward、policy update 的 compute/memory/communication profile 不同，调度要按 stage 做资源匹配，论文报告同预算最高 1.50x throughput，等吞吐最高 1.46x cost reduction。结论是：RL scaling law 更像“全链路吞吐定律”，被最慢环节、长尾、staleness 和失败恢复共同限制。

### 生态格局演变

slime 系的技术哲学是“少抽象、强原生”：[slime](https://github.com/THUDM/slime) 明确选择 Megatron + SGLang，把训练参数和 SGLang 参数尽量透传，强调 Data Buffer、rollout/debug 路径、reward/verifier/workflow 的显式性；[vime](https://github.com/vllm-project/vime) 则继承 slime 训练栈和 data-generation 设计，把 rollout 后端替换为 vLLM + vllm-router，是 vLLM 社区把 slime 范式横向接入 vLLM 生态的信号。verl 系更强调可组合 dataflow 和多后端，DAPO、VeRL-Omni、uni-agent 都说明它正在变成研究算法和多模态/agent RL 的承载层。Ray 系（OpenRLHF、SkyRL、AReaL）更重调度弹性和异构角色拆分：OpenRLHF 易用、SkyRL-Agent 强调 multi-turn agent rollout，AReaL 把 fully async 推到极致。独立工业框架中，Relax 是服务化异步路线，ROLL 是阿里体系里 Ray + Megatron-Core + SGLang/vLLM 的全栈路线，[ROLL](https://github.com/alibaba/ROLL) 明确覆盖 Reinforce++、GRPO、GSPO、Megatron、vLLM、SGLang 和 AutoDeviceMapping；NeMo-RL 代表 NVIDIA 硬件/框架协同路线；Forge 则是 MiniMax 面向 M2 系列的 agent-native 内部框架，公开材料最强调 scaffold 解耦、黑盒 Agent 接入和 windowed-FIFO / prefix merging 这类 goodput 工程。未来不会完全收敛到一个框架，但会在 episode schema、reward contract、rollout service、weight sync、environment isolation 上收敛；训练后端和推理后端仍会分化，因为它们绑定组织已有 infra 和硬件策略。

### 下一步值得关注的方向

未来 12 个月最可能主流化的是异步 agent RL 和过程奖励模型（PRM）。前者已有 AReaL、Relax、SkyRL-Agent、DORA 等系统证据：[DORA](https://arxiv.org/abs/2604.26256) 指出 rollout 占 step time 50-80%，用 multi-version streaming rollout 在保持 intra-trajectory policy consistency、data integrity、bounded staleness 的同时消除 bubble，报告 2-3x 系统吞吐、工业规模 2-4x 加速；这类方案会逼迫框架原生表达 policy version 和 staleness。PRM 会成为 reward hacking 的现实补丁：纯 outcome reward 太稀疏，LLM-as-judge 又易被 hack，过程奖励能把长链推理、工具调用、代码修改拆成更细监督，但代价是标注、judge 稳定性和过程过拟合。多智能体 RL 会先在 communication cost、self-play、simulated user 上出现，Agent-GSPO、MUA-RL 这类方向说明 token economy 和动态用户意图会进入 reward。omni-modal RL 也会快速上升，Relax 和 NeMo-RL 都已把 VLM / omni-modal 放到主线；VeRL-Omni 则说明 diffusion / omni-modal post-training 会和 LLM RL 共用一部分 orchestration。diffusion model RL 可能在图像/视频生成质量和偏好优化里先落地，但与 agentic RL 的统一还需要 episode 与 reward 抽象进一步泛化。补充遗漏方面，建议把 DCPO、DORA、SkyRL-Agent、NeMo-Aligner / NeMo-RL、Forge / CISPO、FP8-RL 加入持续跟踪表；rLLM 若没有稳定公开主源，先作为“零侵入 Agent RL”观察项，不宜和 Agent Lightning 同等确信引用。

## 落地：目标架构与选型

### 目标架构：四层分工

**观点**：未来 post-training RL 系统不会只有一个 trainer 层，而会自然分成应用、环境 / reward、RL orchestration、model runtime 四层。

**分析线索**：从四层架构看每层职责和边界。

我倾向于把未来的 post-training RL 系统分成四层：

```text
Application / Agent Layer
  任务、工具、工作区、用户交互、线上 trace

Environment / Reward Layer
  sandbox、verifier、judge、reward contract、eval harness

RL Orchestration Layer
  rollout、trainer、reference、reward、数据流、checkpoint、调度

Model Runtime Layer
  distributed training、inference engine、KV cache、kernel、通信、拓扑
```

这样分层后，有几个边界会更清楚。

第一，Agent 应用不应该直接绑定某个 trainer。它应该把任务轨迹、工具调用、观察结果和最终 artifact 用标准 trace 记录下来，再由 RL 层消费。

第二，reward / verifier 应该成为独立资产。它们不是某次训练脚本里的 if-else，而是可版本化、可回放、可审计的 domain contract。

第三，RL orchestration 不应该假设 rollout 只是本地 `model.generate()`。它要面对的是持续更新的 policy serving、异步请求、权重同步、失败重试和环境并发。

第四，model runtime 层会越来越专门化。MoE、长上下文、MTP / speculative decoding、FP8 / FP4、context parallel、expert parallel、KV cache 管理都会影响 RL goodput。

### 框架选型：从瓶颈出发

**观点**：框架选型应该从当前瓶颈出发，而不是从框架名或算法名出发。

**分析线索**：用 checklist 判断当前系统缺的是 rollout、environment、reward、observability 还是大规模 runtime。

看一个 RL 框架或内部系统时，我现在会优先看这些问题：

1. **Rollout 怎么做**
是否支持 vLLM / SGLang 等高吞吐后端？权重同步是阻塞还是异步？长尾 generation 怎么处理？

2. **环境怎么接**
是否能表达多轮状态、工具调用、文件系统、终端、浏览器、异常和 timeout？环境失败会不会拖垮整轮训练？

3. **Reward 怎么版本化**
reward breakdown 是否记录？judge 版本是否入库？同一批 trajectory 能不能用新 reward replay？

4. **数据结构是否足够完整**
是否保存 old logprob、ref logprob、采样参数、policy checkpoint、trace id、env version？能不能复现某条坏轨迹？

5. **异步边界在哪里**
rollout 和 update 能不能 overlap？reward / judge 能不能异步？checkpoint 是否阻塞主循环？

6. **资源放置是否可控**
训练、推理、reward、环境 worker 能否分别申请资源？MoE / EP / TP / PP 是否能感知拓扑？

7. **失败是否局部化**
单条 trajectory 失败、单个 sandbox hang、单个 vLLM worker 异常，是局部重试还是整个 job 重启？

8. **观测是否面向 RL 训练链路**
除了 loss、reward 均值，有没有 p99 latency、timeout rate、tool error taxonomy、reward distribution drift、policy version 对比？

9. **算法改动成本多高**
改 advantage、KL、reward shaping、loss aggregation、采样策略时，是改一个模块，还是要穿透整个框架？

10. **上线回流路径是否存在**
线上 agent trace 能不能进离线训练？训练中的 eval bad case 能不能回到数据构造？这是链路能否跑通的关键。

### 结论

**观点**：后训练 RL 的护城河会沉淀在系统资产里，而不是单个 trainer repo 里。

**分析线索**：从链路质量、runtime 化、agentic 生产系统化、可验证 reward、goodput 五个角度收束。

第一，**后训练 RL 的壁垒会从单个算法迁移到链路质量**。算法公开得很快，但高质量环境、reward contract、trace schema、failure taxonomy 和 replay/eval 体系不容易复制。

第二，**RL 框架的竞争点会从“支持哪些 loss”转向“能组织多复杂的训练链路”**。PPO / GRPO 只是入口，真正难的是让 rollout、reward、environment、trainer、serving、checkpoint、observability 在大规模下稳定协作。

第三，**agentic RL 会把训练系统拉向生产系统**。因为环境是真实的，工具是真实的，失败也是真实的。它不像纯离线训练那样只要 GPU 算完就行，而是要处理权限、隔离、超时、脏状态、外部依赖和不可复现。

第四，**可验证 reward 会成为 post-training 的核心资产**。但它不是银弹。verifier 越强，模型越可能围绕 verifier 学策略；所以 verifier、hidden eval、过程审计、人工抽检和 reward 多样性要一起设计。

第五，**RL infra 的优化目标应该是 goodput，而不是峰值吞吐**。大规模 RL job 的真实成本来自等待、重启、长尾、同步、I/O、checkpoint、环境失败。少失败、快恢复、可归因，往往比单点 benchmark 更有价值。

最后，一个比较粗的判断：

> 未来做 LLM post-training RL，强团队不会只维护一个 trainer repo，而会维护一套“任务环境 + reward contract + trajectory store + RL runtime + eval/replay”的系统。

也就是说，RL 框架只是其中一层。真正的护城河在链路里。
