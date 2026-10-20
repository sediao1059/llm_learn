---
id: genspark-search-agent
title: Genspark 搜索 Agent 架构
category: Agent 系统
layer: L4-业务应用层
difficulty: 入门
tags: [Agent, Genspark, 搜索引擎, Mixture-of-Agents, Super-Agent]
status: learned
links: [manus-multi-step-execution]
sources:
  - [Less Control, More Tools: How Genspark Built a Super Agent That Scales（CTO Kay Zhu 演讲全文，一手资料）](https://www.genspark.ai/blog/genspark-less-control-more-tools)
  - [Introducing the World's First Mixture-of-Agents (MoA) System（Genspark 官方）](https://www.genspark.ai/blog/genspark-mixture-of-agents)
  - [Welcome to Genspark, the AI Agentic Engine（官方：Sparkpages 介绍）](https://www.genspark.ai/blog/genspark-intro)
  - [Mixture-of-Agents Enhances Large Language Model Capabilities（arXiv:2406.04692）](https://arxiv.org/abs/2406.04692)
  - [QED42: Genspark Super Agent 与 Manus 对比](https://www.qed42.com/insights/genspark-super-agent-the-rise-of-next-generation-ai-assistants-and-how-it-compares-to-manus-ai)
---

# Genspark 搜索 Agent 架构

> **一句话**：Genspark 从「AI 搜索引擎」起家，用 **Mixture-of-Agents（多模型混合编排）+ 实时浏览检索**取代传统「爬索引 → 排链接」的搜索范式；2025 年 4 月升级为 **Super Agent**，设计哲学是 **Less Control, More Tools**——不编排固定流程，把一堆好模型、趁手的工具交给一个会回溯的 Agent 循环。

## 1. 背景与发展线

- 公司：**MainFunc AI**（2024 年成立），两位创始人都是搜索老兵：**景鲲（Eric Jing）**，前百度集团 EVP / 小度 CEO；**Kay Zhu**，前 Google / 百度工程师，约 20 年搜索经验，任 CTO。
- 时间线：
  - **2024-06**：发布 AI 搜索引擎，核心产品形态是 **Sparkpage**（针对每条查询实时生成的"定制结果页"，无广告、无竞价排名）；
  - **2024-12**：官宣 **Mixture-of-Agents (MoA)** 系统；
  - **2025-04**：发布 **Super Agent**——一句话完成打电话、做 PPT、生成视频、深度研究等多模态任务；据官方披露 **9 天做到 $10M ARR，45 天 $36M ARR**；
  - 10 周内连发 8 个产品（AI Browser、AI Sheets、AI Slides、Call for Me 等），团队仅 20 余人——小团队高产出本身就是这套架构"薄编排、厚工具"的证明。

## 2. 搜索 Agent 架构：从「链接列表」到 Sparkpage

**传统搜索引擎**（Google 范式）：爬虫预先建索引 → 查询时匹配排序 → 返回 10 条蓝色链接（+广告），**用户自己**逐个点开拼出答案。

**Genspark 的 Agentic Search**：

```
用户查询（自然语言问题）
   ▼
① 查询理解与任务规划：Agent 自主决定要查什么、查几个源、查多深
   ▼
② 并行检索多个信息源：实时联网浏览（不局限于静态索引）+ 内置付费数据集
   ▼
③ 交叉验证：多个 agent 互相核对事实，抑制幻觉
   ▼
④ 聚合生成一张 Sparkpage：为这条查询"现场生成"的定制结果页
   （结构化答案 + 引用来源 + 可内嵌表格/图片/视频/交互组件）
```

要点：

- **实时优先**：靠实时浏览抓取保证新鲜度与长尾覆盖，配合内置 premium 数据集补结构性数据；
- **生成而非匹配**：结果页是现场合成的，不是预先排好的索引页——这是"搜索 Agent"与"带 AI 摘要的搜索"的本质区别；
- **Sparkpage 是容器**：Genspark 后续所有 Agent 能力（表格、幻灯、视频、通话结果）都以 Sparkpage 为展示载体，搜索形态自然长成了 Agent 形态。

## 3. Mixture-of-Agents（MoA）：模型编排层

官方口径（CTO 演讲）：引擎 = **9 个不同规模的 LLM** 组成的 mixture-of-agents + **80+ 专用工具** + **10+ 付费数据集**。

- 核心信念：**不存在 one model to rule them all**——任何单一模型都有短板，厂商每发一版新模型格局就变；
- **按步骤特点路由模型**：OpenAI 擅长深度研究与创意写作、Claude 擅长 agentic 推理与复杂编码、Gemini 擅长多模态理解；任务序列里每一步都交给当下最合适的模型；
- 与学术 MoA（arXiv:2406.04692：多层多个 LLM 互相提议-聚合以增强输出）思想同源，Genspark 是它的工程化产品形态；
- 效果：不绑死单一厂商，谁家模型强就即时吃到红利。

## 4. 设计哲学：Less Control, More Tools（最重要的一节）

> 来源：CTO Kay Zhu 在 VentureBeat Transform 2025 的演讲《How We Built a Super Agent That Scales》。

- 团队早期也做过 workflow 编排引擎，后来**把硬编码 workflow 基础设施全部抛弃**，全面转向 agentic engine。理由：

  > Workflow 是铁轨上的火车：一切顺利时高效，一旦出轨就是灾难。
  > Agent 是带 GPS 的老司机：路堵了就换一条路。
  > **在 workflow 里，错误会累积（errors accumulate）；在 agent 里，错误可恢复（errors are recoverable）。**

- **Agent 的本质定义（CTO 原话）**：**LLM in a while loop —— plan → execute → observe → backtrack**。Agent 的价值恰恰在"未预设路径"时体现：LLM 自己即兴生成新的工作流。
- **More Tools（工具的网络效应）**：每加一个工具不是 +1 个能力，而是与既有工具**指数级组合**（80 个工具 ≈ 数万种组合，像 Linux 管道 / 乐高积木）。Genspark 把工具做成可自由组合的 API 块，专业工具（Crunchbase、数据库连接器、分析平台、电话 API）直接预装。
- **反对"原教旨主义 Agent"**（只给键盘/鼠标/浏览器，让 agent 现场自己写工具）：演讲现场演示过这种打法，结论是**给专业人士配齐趁手工具，交付更快更好**——工具的复用性比现场发挥可靠得多。
- **给企业的落地建议**：80% 的确定性场景保留 workflow；把 workflow 搞不定的**最难 20% 交给 agent**，并预期这个 20% 会越来越大。

## 5. 改进飞轮（Improvement Loop）

- **LLM-as-Judge** 给整个会话打总分，再把总分 reward **归因（credit assignment）到会话里的每一步**——知道"哪一步选错了工具/模型"；
- 每天数十万真实会话作为样本 → 沉淀"什么情况下该用什么工具/模型"的经验；
- 通过 **强化学习 + prompt playbook** 回灌引擎，形成数据飞轮：用户越多 → 会话数据越多 → 路由与工具选择越准。

## 6. Super Agent 能力面（工具全景示例）

| 类别 | 示例 |
|---|---|
| 基础设施 | 虚拟机/浏览器/终端：浏览网页、Jupyter 跑数据分析、操作电脑 |
| 生产力 | AI Slides（PPT）、AI Sheets、文档与网页生成、图像/视频生成 |
| 独特能力 | **Call for Me**：AI 直接打电话（现场 demo 打给主办方调整演讲时段） |
| 数据源 | Crunchbase API、付费数据集、数据库连接器、分析平台 |

## 7. 与 Manus 对比（面试高频）

| 维度 | Manus | Genspark |
|---|---|---|
| 出身 | 通用自主 Agent（云端 VM 沙箱） | AI 搜索引擎 → Super Agent |
| 核心隐喻 | 给模型**一台完整的电脑** | 给模型**一套智能管道**：9 模型 × 80+ 工具自由组合 |
| 执行骨架 | 单主 Agent + Subagent 上下文隔离，重上下文工程 | MoA：规划 → 按步骤路由模型 → 多 agent 并行 → 聚合 |
| 模型策略 | Claude 为主 + 专项小模型（微调 Qwen 等） | 9 个不同厂商/规模 LLM 混合路由，不绑死一家 |
| 搜索 | 沙箱内浏览/搜索只是工具之一 | 起家本领：实时检索 + 多源交叉验证 + Sparkpage |
| 公开方法论 | Context Engineering（缓存/文件记忆/todo 复述） | Less Control, More Tools + 步骤级改进飞轮 |
| 共同点 | 都反对重 workflow 编排、都信奉「Agent 循环 + 回溯」，只是 Manus 把功夫花在**上下文**，Genspark 把功夫花在**工具与模型编排** | |

## 8. 设计启示

1. **别急着编排流程**：先把 agent loop（含 observe → backtrack）做对，workflow 只留给确定性场景；
2. **工具质量 > 模型调优**：投资可组合的 API（乐高标准），每个新工具都应能被既有工具串联；
3. **多模型路由是性价比杠杆**：按步骤特点选模型，而不是全链路都上最贵模型；
4. **评测要细到步骤级**：会话级打分 + 步骤归因，才知道该优化哪一步（LLM-as-Judge）；
5. **搜索型 Agent 的护城河**在"实时检索 + 多源交叉验证"，而不是索引规模。

## 9. 衍生学习（已立坑，见图谱 todo 节点）

- Mixture-of-Agents 论文精读（arXiv:2406.04692）
- LLM-as-Judge 与 Agent 强化学习（RLHF → Agent RL）
- 传统搜索引擎架构（爬取-索引-排序）作为对照
- Deep Research 类产品（OpenAI / Gemini Deep Research）架构对比
- Multi-Agent 协作模式：主从、并行、辩论（debate）、路由

## 10. 参考资料

- [Less Control, More Tools: How Genspark Built a Super Agent That Scales（CTO Kay Zhu 演讲全文）](https://www.genspark.ai/blog/genspark-less-control-more-tools)
- [Introducing the World's First Mixture-of-Agents (MoA) System（官方）](https://www.genspark.ai/blog/genspark-mixture-of-agents)
- [Welcome to Genspark, the AI Agentic Engine（官方：Sparkpages）](https://www.genspark.ai/blog/genspark-intro)
- [Mixture-of-Agents 论文（arXiv:2406.04692）](https://arxiv.org/abs/2406.04692)
- [QED42: Genspark vs Manus 对比](https://www.qed42.com/insights/genspark-super-agent-the-rise-of-next-generation-ai-assistants-and-how-it-compares-to-manus-ai)
