---
title: PPO
abbrlink: 5982b47d
date: 2026-04-18 23:35:53
katex: true
toc:
  number: false
tags:
---

## PPO

[Proximal Policy Optimization Algorithms](https://arxiv.org/abs/1707.06347)

**两阶段循环**

为什么可以“多轮”

通常情况下，如果对同一批数据进行多轮优化，策略会因为更新过头而崩溃。但 PPO 引入了 **Clipped Objective（裁剪目标函数）**：

* **安全护栏**：在每一轮优化中，PPO 会计算新策略和采样时的旧策略的概率比。如果这个比值超出了设定的范围（比如 $0.8 \sim 1.2$），梯度就会被“截断”。
* **效果**：这确保了即使在这一批数据上反复“薅羊毛”优化，新策略也不会跑得离旧策略太远，从而保证了训练的稳定性。

### 1. 采样阶段 (Sampling Phase)

* **动作**：让当前的策略 $\pi_{\theta_{old}}$ 在环境中运行一段时间。
* **产出**：收集一批轨迹数据（包括状态 $s$、动作 $a$、奖励 $r$ 等）。
* **性质**：这些数据是“新鲜”的，反映了当前策略的行为模式。

在这个阶段，神经网络的参数是固定不动的（即 $\theta_{old}$）。Actor (策略网络)：在环境中根据概率分布选择动作。数据收集：把 $(s_t, a_t, r_t, s_{t+1})$ 存入一个临时的 Buffer。目标：收集足够数量的轨迹（比如 2048 个时间步）。

#### 1.1. 计算“标签” (Preprocessing)

在开始训练前，利用收集到的数据计算两个关键值：
* $\hat{A}_t$ (Advantage)：优势函数，用来衡量这个动作比平均水平好多少。
* $R_t$ (Returns)：这一步动作带来的累积奖励。

注意到

* $r_t(\theta)$：新旧策略概率比（用于 Actor）。
* $\hat{A}_t$：优势估计（用于 Actor，决定更新方向）。
* $R_t$：回报目标值（用于 Critic，提升估值精度）。

如果只用即时奖励 $r_t$ 作为目标，Critic 就会变得非常“短视”。即时奖励 $r_t$：只代表当前这一秒好不好。回报目标 $R_t$：代表了“做出这个动作后，直到最后我一共拿了多少分”。目的：我们希望 Critic 能够预判未来。所以我们要让 $V(s_t)$ 去拟合这个 $R_t$。

$$R_t = \hat{A}_t + V(s_t)$$

$R_t$ (Returns)：作为 Critic 网络的监督信号（标签）。
* 计算逻辑：通过 $\hat{A}_t$（优势）与采样时旧的 $V(s_t)$ 相加得到：$R_t = \hat{A}_t + V(s_t)$。
* 物理意义：它代表了在当前策略下，从状态 $s_t$ 开始预期能获得的折现总奖励。Critic 的优化目标就是让预测值 $V_\theta(s_t)$ 尽可能接近这个 $R_t$。

这意味着：
1. 先用 GAE 算出了优势估计 $\hat{A}_t$。
2. 通过 $\hat{A}_t + V(s_t)$，你就反向推导出了这一步动作对应的“目标回报” $R_t$。
3. 价值损失 (Value Loss) 就变成了：$MSE(V_{new}(s_t), R_t)$。

##### 总结

* Actor：利用 $\hat{A}_t$（相对好坏）来决定 $\theta$ 的更新方向。
* Critic：利用 $R_t$（绝对得分）来修正自己对世界的认知。

### 2. 优化阶段 (Optimization Phase)

**多轮优化 (Several Epochs)**：
* **动作**：将刚才采样的这一批数据反复输入神经网络进行多次梯度更新。
* **关键点**：在传统的 On-policy 算法（如普通的策略梯度）中，这批数据更新**一次**就必须扔掉。但 PPO 允许你在同一批数据上跑 3 轮、5 轮甚至 10 轮（Epochs）。

要把 Buffer 里的数据，分成更小的 Mini-batches，重复训练 $K$ 个 Epochs（比如 $K=10$）。在每一个 Epoch 里的微观操作：计算概率比 $r_t(\theta)$：用当前正在更新的 $\theta$ 计算动作概率，除以采样时的 $\theta_{old}$ 计算的概率。应用裁剪 $CLIP$：如果 $r_t(\theta)$ 偏离 1 太远（比如超过 20%），就强行截断。梯度更新：通过反向传播更新参数 $\theta$。

为什么 $r_t(\theta)$ 允许“多轮更新”。PPO 能够从 On-policy 转向近乎 Off-policy 的理论支柱，PPO 本质上是利用了重要性采样技术。
* 理论背景：我们想优化新策略 $\pi_\theta$，但手里只有旧策略 $\pi_{\theta_{old}}$ 采到的数据。
* 补偿机制：通过概率比率 $r_t(\theta)$，我们修正了数据分布的偏差。
* 约束：重要性采样要求两个分布不能差太远，否则方差会爆炸。这正是 $L^{CLIP}$ 存在的根本原因——它在数学上维护了重要性采样的有效区间。

#### 2.1. 优势估计

通常采用 GAE (Generalized Advantage Estimation)。

简单来说，优势函数 $\hat{A}_t$ 的目标是回答：“在状态 $s_t$ 下采取动作 $a_t$，比平均情况（即 Baseline）好多少？”

##### 2.1.1. 计算时序差分残差（Temporal Difference Error）

首先计算每一个时间步的即时偏差 $\delta_t$。它衡量了“实际观测到的奖励 + 下一步的估值”与“当前估值”之间的差距：

$$\delta_t = r_t + \gamma V(s_{t+1}) - V(s_t)$$

* $r_t$：当前步获得的奖励。
* $V(s_{t+1})$：神经网络（Critic）对下一步状态的估值。
* $V(s_t)$：神经网络（Critic）对当前状态的估值。

##### 2.1.2. 累加衰减

> [0, T)

优势估计 $\hat{A}_t$ 不是只看当前这一步，而是要把未来的 $\delta$ 都考虑进来，但要进行指数衰减。公式如下：

$$
\hat{A}_t = \delta_t + (\gamma\lambda)\delta_{t+1} + (\gamma\lambda)^2\delta_{t+2} + \cdots + (\gamma\lambda)^{T-1-t}\delta_{T-1}
$$

这里有两个关键的超参数：
* $\gamma$ (Gamma)：折扣因子（通常 0.99），决定了对远期奖励的重视程度。
* $\lambda$ (Lambda)：GAE 因子（通常 0.95），用于在偏差（Bias）和方差（Variance）之间做权衡。

实现时，逆序（t）计算

* 如果 $\lambda = 0$：$\hat{A}_t = \delta_t$。这叫 1-step TD。它很稳定（方差小），但如果你的 $V$ 函数估值不准，它就会错得离谱（偏差大）。

* 如果 $\lambda = 1$：$\hat{A}_t$ 变成了从当前步到截断点 $T$ 的所有奖励累加。这很真实（无偏差），但环境随机性太强，导致数值跳变剧烈（方差大）。

这就是 $\lambda$ 用于在偏差（Bias）和方差（Variance）之间做权衡的物理意义。PPO 选取 $\lambda = 0.95$ 它在“相信神经网络的估值”和“相信实际观测到的奖励”之间取了一个折中。

##### 2.1.3. 标准化 (Advantage Normalization)

在算出 $T$ 个时间步的所有 $\hat{A}_t$ 后，工程上通常会进行一次标准化处理：

$$
\hat{A}_t = \frac{\hat{A}_t - \text{mean}(\hat{A})}{\text{std}(\hat{A}) + 10^{-8}}
$$

* 稳定梯度：在一个 Batch 中，优势值的数值跨度可能很大。标准化后，它们的均值为 0，标准差为 1。
* 逻辑闭环：这确保了在一个 Batch 里，大约有一半的动作会被认为是“好于平均”（正值，增加概率），另一半是“差于平均”（负值，减小概率）。这对于 Adam 优化器的稳定收敛极其重要。

##### 总结计算流程

$$r_t(\theta) = \frac{\pi_\theta(a_t | s_t)}{\pi_{\theta_{old}}(a_t | s_t)}$$

1. 运行 $T$ 步采样，收集所有的 $r$ 概率比例和 $V$ 状态价值。
2. 从后往前计算（这样可以用 $A_{t+1}$ 算出 $A_t$）：
* $A_t = \delta_t + (\gamma\lambda) A_{t+1}$
3. 对整个 Batch 进行标准化。
4. 将算好的 $\hat{A}$ 输入 $L^{CLIP}$ 进行优化。

#### 2.2. 损失函数

> 优势估计 $\hat{A}_t$ 和概率比率 $r_t(\theta)$ 都准备好了，进入 PPO 执行阶段构建 Loss 函数并进行参数更新

Adam 优化器并不是只优化策略，它其实是在同时优化三个目标。

总损失函数 $L^{CLIP+VF+S}_t$ 通常长这样：

$$
L_t^{total}(\theta) = L_t^{CLIP}(\theta) - c_1 L_t^{VF}(\theta) + c_2 S[\pi_\theta](s_t)
$$

$$L^{CLIP}(\theta) = \hat{\mathbb{E}}_t \left[ \min \left( r_t(\theta) \hat{A}_t, \text{clip}(r_t(\theta), 1 - \epsilon, 1 + \epsilon) \hat{A}_t \right) \right]$$

这三个部分分工明确：
* $L_t^{CLIP}(\theta)$ (策略损失)：利用 $\hat{A}_t$ 和 $r_t(\theta)$ 进行裁剪优化。它负责告诉 Actor：“哪些动作该多做，但别改得太猛。”
* $L_t^{VF}(\theta)$ (价值损失)：通常是均方误差 $MSE(V_\theta(s_t), V_{target})$。它负责告诉 Critic：“你的预言（估值）要更准一点。”
* $S[\pi_\theta](s_t)$ (熵奖励)：鼓励策略保持一定的随机性。它负责告诉模型：“别太早固定死某一个动作，多去探索其他可能性。”

> MSE 均方误差

##### 2.2.1. 执行 Adam 更新

> Adam 优化器, 梯度下降 (Gradient Descent)

有了总损失后，流程如下：
1. 计算梯度：对总损失关于参数 $\theta$ 求导（即之前提到的 $L \text{ wrt } \theta$）。
2. 反向传播：将梯度传回神经网络。
3. 参数更新：Adam 优化器根据动量和自适应学习率微调 $\theta$。

进入 $K$ 个 Epoch 的循环

针对同一批采样数据（那 $NT$ 个样本），反复进行 $K$ 次上述的“计算 Loss -> 更新参数”过程。
* 在第 1 遍时：$r_t(\theta_{old}) = 1$，大家都在正常学习。
* 在第 $K$ 遍时：由于参数已经改了好几次，新旧策略的偏差 $r_t(\theta)$ 可能会很大。这时候 Clipping（裁剪） 就会大显身手，强行把那些偏移过大的梯度归零，防止模型跑飞。

> 注：虽然 PPO 的理论目标是最大化奖励，但在代码实现中，我们通过对总目标函数取负值，将其转化为一个最小化损失的问题，从而利用 Adam 优化器进行参数更新。

##### 2.2.2. 更新旧策略 ($\theta_{old} \leftarrow \theta$)

当 $K$ 次迭代结束，这一批数据的价值就被“榨干”了。
此时，我们将当前的最新参数 $\theta$ 赋值给 $\theta_{old}$。然后清空缓存的数据，回到环境里，开启下一轮 $N \times T$ 的数据采集。

### 3. Hyperparameters 参考

| 参数 | 常用值 | 作用 |
| :--- | :--- | :--- |
| $\epsilon$ | $0.1 \sim 0.2$ | 裁剪阈值，限制单次更新步长 |
| $\gamma$ | $0.99$ | 长期奖励折扣因子 |
| $\lambda$ | $0.95$ | GAE 平衡因子 |
| $c_1$ | $0.5$ | 价值损失权重（MSE 权重） |
| $c_2$ | $0.01$ | 熵系数（鼓励探索，防止过早收敛） |
| $K$ | $3 \sim 10$ | 每个 Batch 的重复训练次数（Epochs） |

## RLHF 中的 PPO

在很多 LLM 对齐/偏好优化的工程实现里，会看到 “PPO + reference model（参考模型）”。这很容易让人误以为 reference model 是 PPO 论文（Schulman 2017）的一部分；但严格来说，它是 **RLHF 场景下额外加入的约束/正则**，用来防止策略为了刷 reward 而跑飞（reward hacking、语言退化、分布崩坏等）。

### 1. RLHF 训练 flow

SFT → RM → PPO

可以把最常见的 RLHF 流程理解成三段：

1. **SFT**：用高质量指令数据把模型先教会“基本说话方式”，得到 $\pi_{\text{SFT}}$；它常常也会作为后面的 **$\pi_{ref}$（冻结参考模型）**。
2. **Reward Model（RM）**：用偏好数据训练一个打分器 $R(x,y)$（或 $r_\phi(x,y)$），告诉策略“什么更好”。
3. **PPO-RLHF**：从 $\pi_{\text{SFT}}$ 初始化可训练策略 $\pi_\theta$，用 PPO 提高 $R$，同时用 **KL-to-reference** 把 $\pi_\theta$ 拴在 $\pi_{ref}$ 附近。

而 **PPO-RLHF 的实现**，通常就是把“文本生成”当成一条轨迹上的序列决策，然后复用前边提到的 PPO 两阶段循环：

* **自回归 MDP（最常见的设定）**：第 $t$ 步的“动作”是下一个 token $y_t$；状态可以抽象成 $(x,y_{<t})$。
* **Rollout**：用 $\pi_{\theta_{old}}$ 采样一批 completions（得到 token 轨迹与 logprob）。
* **Reward / shaping**：把 RM 分数与 KL shaping 组合成每步可用的标量回报信号（工程上常见是把 KL 摊到 token；RM 可能是序列末一次性给分，也可能有更细的 shaping，取决于实现）。
  * **reward shaping** 在这里可以直观理解为：不只给“最后好不好”的稀疏信号，而是**额外构造/改写一组更密、更及时的逐步回报**，让 PPO 在生成过程中更容易学、也更可控；其中 **per-token 的 KL 项**就是很典型的 shaping。
  * **RM shaping** 则更具体：指把 reward model 的偏好信号**从“只在结尾给一次分”**，扩展成**更稠密的过程性反馈**（例如分段打分、对关键子结构/步骤给增量奖励、或把可验证规则与 RM 组合成逐步项）。不同系统差异很大；设计不当也可能让模型去“刷 RM shaping”而不是真正提升偏好质量，因此通常仍会配合 **KL-to-reference** 与谨慎的系数/裁剪。
* **Optimization**：在同一批数据上算优势（GAE）、跑 $L^{CLIP}$ + value loss + entropy，重复 $K$ 个 epoch；最后更新 $\theta_{old}\leftarrow\theta$，进入下一轮 rollout。

一句话总结：**RM 给方向，$\pi_{ref}$ + KL 给长期护栏，PPO（尤其 clipping）给短期稳定更新**。

### 2. 两个“旧策略”不要混

PPO 里你一定会遇到旧策略，但它通常指的是：

* **$\pi_{\theta_{old}}$（PPO 的 old policy）**：上一轮采样用的策略快照，用于重要性采样比率
  $$
  r_t(\theta) = \frac{\pi_\theta(a_t|s_t)}{\pi_{\theta_{old}}(a_t|s_t)}
  $$
  它是 **每一轮都会更新** 的。

而 RLHF 工程里常说的 reference model 一般是：

* **$\pi_{ref}$（RLHF 的 reference policy/model）**：冻结的锚点模型（常见做法是 SFT 后的模型），用于给当前策略加一个 “别偏太远” 的约束；它通常在一段训练期间 **保持不变** 或更新频率很低。

### 3. KL-to-reference：把“别跑飞”写进目标

以 PPO-RLHF 常见写法为例，会把 reward 加上一个 KL 惩罚（或等价的 reward shaping）：

$$
R'(x, y) = R(x, y) - \beta \, \mathrm{KL}\left(\pi_\theta(\cdot|x)\ \|\ \pi_{ref}(\cdot|x)\right)
$$

这里的符号可以按“一条 RLHF 训练样本”来理解：

* $x$：prompt / 输入上下文（用户问题、题目、对话历史等）
* $y$：response / 输出序列（模型在 $x$ 条件下生成的整段回答 token 序列）
* $R(x, y)$：在输入 $x$ 下输出 $y$ 的奖励（来自 reward model、规则打分等）
* $\mathrm{KL}(\pi_\theta(\cdot|x)\ \|\ \pi_{ref}(\cdot|x))$：在同一个输入 $x$ 条件下，当前策略相对 reference policy 的分布偏离程度

于是 PPO 实际最大化的是 “奖励 - 偏离 reference 的代价”。直觉上：

* **如果只追 $R$**：模型会倾向于钻 reward 的空子，偏离语言先验越来越大。
* **加上 KL**：reference model 提供了一个长期锚点，PPO 的 clipped update 提供了一个短期的“每步别迈太大”，两者一起让训练更稳。

> 备注：不同实现里 KL 可能以多种形式进入（显式 KL penalty、或把 per-token logprob 差写进 reward），但核心都是 “把策略拴在 $\pi_{ref}$ 附近”。

一个常见的工程视角是把 KL “摊平”到 token 级别。设输出序列 $y=(y_1,\dots,y_T)$，则

在自回归语言模型里，这里的 **时间步 $t$ 通常就是“生成第 $t$ 个 token 的那一步”**（也就是 token index）：

* $y_t$：第 $t$ 步采样得到的那个 token
* $y_{<t}=(y_1,\dots,y_{t-1})$：到第 $t$ 步之前已经生成的前缀（第 1 步时为空前缀）

因此 $T$ 就是这条输出序列的长度（token 数）。这和传统 RL 里“环境每走一步”的时间轴可以不同：在 LLM 文本生成里，**“一步”往往等价于“再生成一个 token”**。

$$
\log \pi_\theta(y|x) - \log \pi_{ref}(y|x)
= \sum_{t=1}^T \Big(\log \pi_\theta(y_t|x,y_{<t}) - \log \pi_{ref}(y_t|x,y_{<t})\Big)
$$

如果我们只关心当前采样到的这条序列（on-policy 轨迹）上的惩罚，那么很多实现会定义一个 token 级别的“KL 代价”：

$$
r^{KL}_t \triangleq -\beta\Big(\log \pi_\theta(y_t|x,y_{<t}) - \log \pi_{ref}(y_t|x,y_{<t})\Big)
$$

这里的 $\log \pi_\theta(y_t|x,y_{<t})$（logprob）就是：策略模型在时间步 $t$ 给出的“下一个 token”的条件概率分布 $\pi_\theta(\cdot|x,y_{<t})$ 中，取到实际 token $y_t$ 的概率再取对数（通常取自然对数）。

然后把它加进每一步的 reward（reward shaping）。这样累加起来就是序列级别的 logprob 差惩罚：

$$
\sum_{t=1}^T r^{KL}_t
=
-\beta\Big(\log \pi_\theta(y|x) - \log \pi_{ref}(y|x)\Big)
$$

直觉上：如果某个 token 在当前策略下的概率比 reference 更大（$\log \pi_\theta - \log \pi_{ref} > 0$），那它会产生负的 shaping reward（惩罚），从而抑制策略在该方向上“越走越远”。

### 4. 推荐阅读（理解 RLHF 的最短路径）

* Ouyang et al., 2022. *Training language models to follow instructions with human feedback (InstructGPT).*（SFT → RM → PPO，以及 KL/reference 的由来）
* Stiennon et al., 2020. *Learning to summarize with human feedback.*（更早期、端到端的 RLHF 案例）
* Ziegler et al., 2019. *Fine-Tuning Language Models from Human Preferences.*（偏好优化 + KL 正则的直观版本）

扩展（对比视角，理解“reference 并非 PPO 专属”）：

* Rafailov et al., 2023. *Direct Preference Optimization (DPO).*（绕开 RM 与 PPO，但同样体现 anchor/reference 的思想）

## GRPO：从 PPO / RLHF 再往前走一小步

前面我们把 **PPO** 讲成“稳定的策略更新框架”，把 **RLHF** 讲成“RM + KL-to-reference + PPO”的常见落地形态。下一步很自然的问题是：当你进入 **数学推理 / 可验证奖励** 这类场景时，训练目标仍然可以用 PPO 的 clipped objective，但 **优势（advantage）与 baseline 的估计**往往会变得更棘手。

**GRPO（Group Relative Policy Optimization）** 是在 [DeepSeekMath](https://arxiv.org/abs/2402.03300) 里提出的、**PPO 的一个变体**：动机之一是让 RL 在 LLM 场景里更省资源，同时处理 “reward 往往只在序列末出现、但 value 需要 token 级别监督” 这类不匹配。

后续再展开学习

* **仍然很 PPO**：整体还是围绕 clipped ratio 的策略更新思路在转（可以把它理解成“骨架仍在 PPO”）。
* **关键变化：去掉 value模型 / critic**：GRPO **不再额外训练一个与 policy 同量级的 value function** 来给每个 token 做 baseline。
* **用 group 做相对基线**：对同一个问题 $q$，先从旧策略采样一组输出 $\{o_1,\dots,o_G\}$，再用 **组内相对比较** 来构造优势（论文强调这与 reward model 常见的“同题对比训练”更一致）。
* **KL 处理方式也可能不同**：论文里也讨论了与 PPO 场景下 KL penalty 不同的正则化思路（读 4.1 小节时对照实现会更清晰）。
