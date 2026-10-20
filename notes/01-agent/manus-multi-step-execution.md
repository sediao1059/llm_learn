---
id: manus-multi-step-execution
title: Manus Agent 多步任务执行模式
category: Agent 系统
layer: L4-业务应用层
difficulty: 入门
tags: [Agent, Manus, Context-Engineering, 多步任务, 沙箱]
status: learned
links: [genspark-search-agent]
sources:
  - [Context Engineering for AI Agents: Lessons from Building Manus（Manus 官方博客，一手资料）](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)
  - [How Manus works（社区对系统提示词/循环的逆向分析）](https://gist.github.com/renschni/4fbc70b31bad8dd57f3370239dccd58f)
  - [Lance Martin: Context Engineering in Manus](http://rlancemartin.github.io/2025/10/15/manus/)
  - [让 Manus 在生产环境中稳定运行的六项上下文工程技术（中文解读）](https://tianpan.co/zh/blog/2026/03/02/context-engineering-lessons-from-manus)
  - [Manus Wide Research 多智能体文档（官方）](https://manus.im/docs/zh-tw/features/wide-research)
  - [OpenManus（社区开源复刻，FoundationAgents）](https://github.com/FoundationAgents/OpenManus)
  - [Hacker News 上对官方博客的讨论](https://news.ycombinator.com/item?id=44635141)
---

# Manus Agent 多步任务执行模式

> **一句话**：Manus = 把 LLM 放进一台云端虚拟电脑里，用「todo.md 计划复述 + 文件系统外部记忆 + 围绕 KV Cache 的上下文工程」驱动的长循环自主 Agent。它最值得学的不是炫酷 demo，而是**让平均 50+ 次工具调用的长任务不崩**的那套工程细节。

## 1. Manus 是什么（背景）

- 2025 年 3 月发布，来自 Butterfly Effect（蝴蝶效应，国内创业公司，此前的产品是 Monica 助手），创始人肖弘（Red），联合创始人季逸超（Peak Ji，上下文工程博客作者）。
- 定位：**通用自主 Agent（General AI Agent）**——用户只给一个目标，Manus 自主规划、执行、交付"成品"（报告 / 网站 / 表格 / 数据分析图表），而不是像聊天机器人那样来回对话。
- 发布时在 **GAIA 基准**（通用 AI 助手能力测试，考察真实多步任务）三个难度级别均取得当时的 SOTA，借此爆红，初期邀请码一码难求。
- 名字来源：Mens et Manus（MIT 校训「头脑与双手」）——不仅会思考，还要会动手。
- 本体闭源；社区有高热度的开源复刻 **OpenManus**（MetaGPT/FoundationAgents 团队），可读其源码理解 Agent 循环骨架。
- 据媒体报道（36 氪、路透等）：2026 年经历了 Meta 约 20 亿美元收购、随后又独立发展并完成约 5 亿美元融资（投后估值约 40 亿美元），2026 年中 ARR 达 4–5 亿美元——商业层面波折不断，但技术上仍是"多步任务执行"的标杆研究对象。

## 2. 多步任务执行的生命周期

整体是一个 **Agent Loop：分析 → 计划 → 执行 → 观察 →（回溯/纠错）→ 交付**：

```
用户目标（自然语言，只说"要什么"，不说"怎么做"）
   │
   ▼
┌──────────────────┐   ┌─────────────────────────────────────┐
│ 1. 理解任务        │ → │ 2. 制定计划：生成 todo.md             │
│    （必要时澄清）   │   │    （拆成可执行、可勾选的步骤清单）      │
└──────────────────┘   └─────────────────────────────────────┘
                                     │
                                     ▼
        ┌──────────────────────────────────────────────────┐
        │ 3. 循环执行（官方口径：平均约 50 次工具调用/任务）       │
        │   ① 在完整历史上下文中预测下一个动作                     │
        │   ② 调用工具（shell / 浏览器 / 搜索 / 文件读写）         │
        │   ③ 观察结果 → 更新 todo.md 勾选进度                    │
        │   ④ 出错 → 保留错误现场，换思路重试（回溯），不重置        │
        └──────────────────────────────────────────────────┘
                                     │
                                     ▼
        ┌──────────────────────────────────────────────────┐
        │ 4. 整理沙箱里的产物文件，交付结果（文档/图表/网站 + 链接） │
        └──────────────────────────────────────────────────┘
```

两个关键认知：

1. **计划是活的**：todo.md 随执行动态增删改，不是开局一次性生成就完事；发现新信息（比如数据异常）会回头补步骤。
2. **每一步的本质**：模型基于全部历史上下文预测下一个动作。任务越长上下文越大，所以**上下文管理才是这套模式的真正架构核心**（见第 4 节）。

## 3. 执行环境：云端沙箱虚拟机

- **每个会话一台独立云端 Linux VM**，会话之间完全隔离，任务结束后可销毁。
- 工具集 = 一台完整电脑的能力：**shell 终端、浏览器（可登录、点按、填表）、代码执行、文件读写/编辑器、联网搜索**。
  - 与"给模型接几个 API"的区别：Manus 给了模型**一台完整的通用计算机**，因此理论上能力没有上限（会写代码 = 能组合出任意新工具），这也是名字里 "Manus（手）" 的含义。
- **异步执行**：任务在云端跑，用户可以关电脑，完成后通知；中途可以随时下发新指令改变方向，已完成的产物作为后续上下文保留。
- **会话可回放（Replay）**：整个过程（每个工具调用、每次浏览器操作）可录制回放，用于审计和复盘。

## 4. 长任务不崩的秘密：上下文工程六大机制

> 来源：官方博客《Context Engineering for AI Agents: Lessons from Building Manus》（2025-07，季逸超）。
> 出发点：Manus 输入/输出 token 比约 **100:1**——一个任务动辄几十万 token 上下文，延迟和成本全靠工程手段扛。

### 4.1 todo.md：把计划反复「复述」到注意力末尾

- 复杂任务开局创建 `todo.md`，每完成一步就更新勾选状态，等于不断把全局计划**重写到上下文末尾**。
- 原理：长上下文存在 **lost-in-the-middle**（中间位置的信息注意力衰减）和**目标漂移**问题；计划反复出现在末尾 = 始终处于"近期注意力"区域。
- 附带好处：todo.md 以追加方式出现在上下文尾部，**不破坏前缀缓存**（配合 4.3）。

### 4.2 文件系统即外部记忆（Filesystem as Context）

- 128K 窗口装不下长任务，且长上下文本身性能下降、价格昂贵 → 模型把中间产物**写进沙箱文件系统**，需要时再读回，窗口里只保留"索引"。
- 压缩必须**可恢复**：网页内容可以丢，但要留 URL；文档内容可以省，但要留路径——随时能重新加载原文。作者认为不可逆的摘要压缩有信息丢失风险，而文件系统 "unlimited in size, persistent by nature"。
- 这本质上是把「上下文窗口」和「记忆」解耦：窗口是工作台，文件系统才是仓库。

### 4.3 KV Cache / Prompt Caching 对齐：一切为了缓存命中

- Prompt 缓存只对**稳定前缀**生效，所以 Manus 抠所有会破坏前缀的细节：
  - 系统提示词开头**不放精确时间戳**等易变内容；
  - 上下文 **append-only**：只追加，不改写历史；
  - **序列化确定性**：JSON 的 key 顺序固定（防止不同轮次序列化结果不同导致前缀变化）；
  - 需要时显式设置**缓存断点**；自托管场景用 vLLM 前缀缓存并按 session 路由请求。
- 为什么值得抠：缓存命中的输入 token 价格约为未命中的 **1/10**（博客举例 Claude Sonnet：$0.30 vs $3.00 / MTok），Agent 场景输入量巨大，缓存直接决定商业可行性。

### 4.4 工具「遮蔽」而非「移除」

- 任务不同阶段可用的工具不同（比如浏览器任务阶段不该看到 shell），但**动态增删工具列表**有两个恶果：击穿前缀缓存；模型幻觉调用已删除的工具。
- Manus 的做法：**上下文感知的状态机 + 解码时遮蔽（masking）token logits**——工具仍在提示词里，但通过 logit 遮蔽让模型"看不见"不可用的工具；工具命名用统一前缀（`browser_`、`shell_`）便于按组遮蔽。
- 并利用 response prefill 的三种函数调用模式（Auto / Required / Specified）对每步的工具选择做精细控制。

### 4.5 保留错误（Keep Mistakes）

- 失败的调用、报错信息、stack trace **全部留在上下文里**，不清空轨迹、不重置会话。
- 原理：让模型**隐式更新内部信念**（"这条路刚走过、会塌"），显著降低重复同类错误的概率。
- 作者观点：错误恢复能力才是真正 Agent 行为的标志，而学术基准普遍只测"一次做对"，忽视了这一点。

### 4.6 避免 few-shot 陷阱（引入受控随机性）

- 模型擅长模仿上下文中的模式：比如连续审阅 20 份简历时，会陷入前几份形成的"节奏"，越到后面漂移和幻觉越严重（相当于把历史轨迹当成了 few-shot 示范）。
- 做法：对 action/observation 引入**结构化变异**——不同的序列化模板、措辞变化、格式噪声，用受控随机性打破模式重复。

> 官方自嘲方法论为「Stochastic Graduate Descent（随机研究生下降法）」：靠手动架构搜索、prompt 调参和经验猜测迭代，且 agent 框架已重写过四次——侧面说明 Agent 工程目前仍是经验科学。

## 5. 多 Agent 协作：主 Agent + Subagent

- **主 Agent** 保持全局视角负责规划与交付；遇到上下文容易膨胀的子任务（如大规模检索）就**派生 Subagent 并行执行**，子任务在独立上下文里跑，只把**收敛后的结论**回传主上下文（官方 Wide Research 功能即为典型：一个主 agent 分解任务，并行部署多个子 agent 分头检索）。
- **按任务类型路由模型**（而非按 agent 角色固定）：社区分析显示其主力为 Claude 系列（编码、agentic 推理），同时混用 Qwen 等其他模型；官方 AMA 亦提过用微调小模型跑批量/重复类子任务以降本。多 Agent 架构让"每个子任务用最合适的模型"变得自然。
- 设计启示：**复杂度优先用"上下文隔离"消化，而不是用"流程编排"消化**——这与 Genspark 的 Less Control, More Tools 哲学殊途同归（见关联笔记）。

## 6. 一个完整任务走查（示例）

任务：「调研亚马逊上瑜伽垫的销量与口碑，给我一份选品报告」

1. **计划**：todo.md 列出——搜索商品 → 记录价格/评论数/评分到表格 → 清洗数据 → 画图 → 写结论。
2. **执行**：打开浏览器逐页抓取搜索结果，中间数据写入 `amazon_data.csv`（文件系统记忆）；中途某页反爬失败 → **保留报错**，改走另一数据源。
3. **观察与回溯**：发现评分分布异常 → 在 todo.md **新增**一项"补充抓取差评样本"，回头重查。
4. **交付**：用沙箱里的 Python（pandas 清洗 + matplotlib 出图）生成图表，写成 `report.md`，最终交付文件 + 图表链接；全程几十次工具调用，产物全部留在沙箱文件系统，可回放检查。

## 7. 设计启示（可迁移到自己的 Agent 项目）

| Manus 机制 | 自己项目里可以怎么做 |
|---|---|
| todo.md 计划复述 | 多步 Agent 维护一个计划文件，每步后 append 进度，抗目标漂移 |
| 文件系统即记忆 | 上下文装不下的中间结果落盘（文件/DB），窗口里只留路径或摘要，按需读回 |
| KV Cache 对齐 | 提示词前缀保持稳定 + append-only + 序列化确定性，token 成本可差 10 倍 |
| 工具遮蔽 | 动态控制工具可用性时用"遮蔽"而不是增删，别破坏提示词结构和缓存 |
| 保留错误 | 不要清理失败轨迹；错误上下文是模型免费的学习信号 |
| 受控随机性 | 批量同构任务中给序列化加变异，防 few-shot 式的模式固化 |
| Subagent 隔离 | 脏活累活派给子 Agent 独立上下文，只回收敛后的结论 |

## 8. 衍生学习（已立坑，见图谱 todo 节点）

- Context Engineering 系统方法：KV Cache 原理、lost-in-the-middle、prompt caching 机制
- ReAct / Plan-and-Execute / Reflexion 等 Agent 范式对比
- Agent 沙箱技术选型：VM vs 容器 vs WASM，以及 Agent 安全隔离
- GAIA Benchmark：怎么科学评测"通用助手多步任务能力"
- OpenManus 源码走读：社区如何复刻这套循环

## 9. 参考资料

- [Context Engineering for AI Agents: Lessons from Building Manus（Manus 官方博客，一手资料）](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)
- [How Manus works（社区对系统提示词/循环的逆向分析）](https://gist.github.com/renschni/4fbc70b31bad8dd57f3370239dccd58f)
- [Lance Martin: Context Engineering in Manus](http://rlancemartin.github.io/2025/10/15/manus/)
- [让 Manus 在生产环境中稳定运行的六项上下文工程技术（中文解读）](https://tianpan.co/zh/blog/2026/03/02/context-engineering-lessons-from-manus)
- [Manus Wide Research 多智能体文档（官方）](https://manus.im/docs/zh-tw/features/wide-research)
- [OpenManus（社区开源复刻）](https://github.com/FoundationAgents/OpenManus)
- [Hacker News 讨论](https://news.ycombinator.com/item?id=44635141)
- [36 氪：大厂夹缝中突围的 Manus（2026 商业进展）](https://eu.36kr.com/zh/p/4019243786391682)
