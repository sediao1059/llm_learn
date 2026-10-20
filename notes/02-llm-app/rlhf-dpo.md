---
id: rlhf-dpo
title: RLHF / DPO / GRPO 对齐训练
category: 大模型应用
tags: [RLHF, DPO, GRPO, 对齐, 偏好优化]
status: learned
links: [llm-finetuning, pytorch-basics]
sources:
  - [InstructGPT 论文（RLHF 开山）](https://arxiv.org/abs/2203.02155)
  - [DPO 论文](https://arxiv.org/abs/2305.18290)
  - [DeepSeek-R1 论文（GRPO 实战）](https://arxiv.org/abs/2501.12948)
---

# RLHF / DPO / GRPO 对齐训练

> **一句话**：SFT 教模型"会做"，偏好优化教模型"做得合人心意"。经典 RLHF 三阶段（SFT → 奖励模型 → PPO）；DPO 用数学技巧去掉奖励模型和强化学习，直接从偏好对做分类式优化，简单稳定成为主流；GRPO 用"组内相对基线"替代价值网络，是 DeepSeek-R1 训练推理能力的主力。

## 1. 为什么预训练之后还要对齐

- 预训练目标 = 预测互联网文本的下一个词 = **模仿语料**，不是"有用、诚实、无害"；
- base 模型会续写而不是回答（问"中国的首都是？"它可能续写"一道地理考试题"）；
- InstructGPT 的结论：**1.3B 对齐模型 > 175B base 模型**的人类偏好胜率——对齐的杠杆极大。

## 2. 经典 RLHF 三阶段

```
① SFT：人工写高质量示范 → 监督微调（就是微调笔记里的指令微调）
② 奖励模型 RM：人工标注偏好对（回答A 好于 回答B）→ 训练打分器
   损失（Bradley-Terry）：-log σ(r(chosen) − r(rejected))
③ PPO 强化学习：LLM(policy) 生成 → RM 打分 → 更新 policy
   目标 = RM 分数 − β·KL(policy ‖ SFT参考模型)
```

- **KL 惩罚的作用**（必考）：只追 RM 分数会导致 reward hacking（钻打分器空子、语言退化），KL 项把 policy 拴在 SFT 模型附近；
- PPO 的工程痛点：同时常驻 4 个模型（policy / ref / reward / value），显存与稳定性代价大。

## 3. DPO：去掉 RM 和 RL

- 核心洞察：RLHF 目标存在**闭式解**（最优 policy 可由 reward 与 ref 显式表达）→ 把"学奖励再优化"重参数化为"直接对 policy 优化"，得到一个纯分类式损失：

$$\mathcal{L}_{DPO} = -\log \sigma\left(\beta\left[\log\frac{\pi_\theta(y_w|x)}{\pi_{ref}(y_w|x)} - \log\frac{\pi_\theta(y_l|x)}{\pi_{ref}(y_l|x)}\right]\right)$$

- 直觉：拉大"好答案相对参考的提升"与"差答案相对参考的下降"之差；β 控制偏离参考模型的强度；
- 优点：训练简单（像 SFT 一样跑）、稳定、省显存；缺点：离线偏好数据易过拟合、对数据质量极敏感（隐式 reward 偏差）。

## 4. GRPO：组相对策略优化

- PPO 的改进：一次问题采样**一组**答案（如 8/16 条），用**组内平均回报当基线**代替 value 网络的估计——advantage = r_i − mean(group r)；
- 去掉 critic 模型 → 显存减半、更稳；
- **DeepSeek-R1 的用法**（推理能力训练代表）：奖励 = 答案对错（可验证）+ 格式规则，GRPO 让模型自己进化出长思维链（aha moment）；这也带火了"RLVR（可验证奖励的强化学习）"方向。

## 5. 三者对比与选型

| 维度 | PPO(RLHF) | DPO | GRPO |
|---|---|---|---|
| 需要奖励模型 | 是 | 否（隐式） | 是（或规则奖励） |
| 额外模型 | ref+value+RM | 仅 ref | ref+RM |
| 数据 | 生成+打分在线 | 静态偏好对 | 生成+组内比较 |
| 稳定性/成本 | 难调/贵 | 简单/便宜 | 中等 |
| 典型用途 | 通用对齐 | 偏好对齐首选 | 推理能力/可验证任务 |

- 垂类落地建议：先 SFT（LoRA）→ 有用户反馈（正负样本，简历场景！）→ 构造偏好对跑 DPO-LoRA，是工程上性价比最高的路径。

## 6. 高频面试题

1. RLHF 为什么要 KL 惩罚？（防 reward hacking、防偏离参考模型分布）
2. DPO 为什么等价于 RLHF？（闭式重参数化，直接优化策略比）
3. GRPO 与 PPO 区别？（组内基线替代 value 网络，省显存更稳）
4. 偏好数据从哪来？（人工标注、AI 反馈 RLAIF、用户隐式反馈点踩、强弱模型对比）
5. SFT 之后为什么还需要偏好优化？（SFT 只能模仿单一示范，学不出"更好/更差"的排序概念）

## 6. 衍生学习

- RLVR（可验证奖励强化学习）与推理模型
- 偏好数据工程（数据配比、去偏）
- 多轮对话的偏好优化（多轮 DPO 变体）

## 7. 参考资料

- [InstructGPT: Training language models to follow instructions](https://arxiv.org/abs/2203.02155)
- [DPO: Your Preference Model is Also a Policy Model](https://arxiv.org/abs/2305.18290)
- [DeepSeek-R1](https://arxiv.org/abs/2501.12948)
