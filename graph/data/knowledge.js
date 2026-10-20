// 本文件由 graph/build.mjs 自动生成，请勿手改；新增笔记后重新运行 npm run build。
window.KNOWLEDGE_DATA = {
  "generatedAt": "2026-10-20T07:10:33.033Z",
  "categories": [
    "Agent 系统",
    "大模型应用",
    "NLP 算法",
    "深度学习框架"
  ],
  "nodes": [
    {
      "id": "agent-memory-personalization",
      "title": "Agent 记忆与个性化（千人千面）",
      "category": "Agent 系统",
      "status": "learned",
      "tags": [
        "Agent记忆",
        "长期记忆",
        "个性化",
        "Query改写",
        "MemGPT"
      ],
      "links": [
        "prompt-engineering",
        "manus-multi-step-execution"
      ],
      "sources": [
        "[MemGPT 论文（LLM 的分层记忆管理）](https://arxiv.org/abs/2310.08560)",
        "[LangChain Memory 文档](https://python.langchain.com/docs/versions/migrating_memory/)"
      ],
      "file": "notes/01-agent/agent-memory-personalization.md",
      "updatedAt": "2026-10-20",
      "content": "# Agent 记忆与个性化（千人千面）\n\n> **一句话**：Agent 的记忆分两层——**短期记忆**就是当前对话的上下文窗口，**长期记忆**是把跨会话有用的事实（用户是谁、偏好什么、上次聊了什么）沉淀到外部存储，用的时候检索注入。简历场景「正负样本与记忆提取实现千人千面 + 上下文改写标准化用户输入」= 长期记忆的**提取→存储→注入**闭环 + 入口的**查询标准化**，两件武器合起来就是个性化问答的完整答案。\n\n## 1. 记忆的分层模型\n\n```\n短期记忆（Working Memory）：当前会话上下文窗口\n   │ 满了/结束了怎么办？↓ 提取有价值的信息\n长期记忆（Long-Term Memory）：\n   ├─ 用户画像（静态）：角色、行业、常用口径\n   ├─ 事实记忆（ эпisodic）：上次问过什么、结论是什么\n   └─ 偏好/反馈（正负样本）：点赞的答案风格、点踩的错误\n        ↑ 用的时候按相关性检索，注入 system prompt / 上下文\n```\n\n- 灵感源头 MemGPT：像操作系统一样把上下文窗口当\"内存\"、外部存储当\"磁盘\"，模型自己决定何时换入换出（分页）——与 Manus「文件系统即外部记忆」同一思想。\n\n## 2. 千人千面的工程闭环（简历场景展开）\n\n| 环节 | 做法 |\n|---|---|\n| 记忆提取 | 会话结束后用 LLM 抽取结构化事实（\"该教师教初二数学，偏好图表化答案\"），去重合并入向量库/结构化表 |\n| 记忆注入 | 新会话按用户 ID + 当前问题检索相关记忆，注入 system prompt（控制条数防撑爆上下文） |\n| 正负样本 | 用户点赞/点踩 → 正例进\"偏好记忆\"，负例（badcase）进评测集与负样本库，既做检索过滤也做微调数据 |\n| 权限隔离 | 记忆按用户隔离（政务/教育场景强合规要求），敏感信息脱敏后再存 |\n| 记忆遗忘 | 支持用户查看/删除自己的记忆（合规 + 防过时记忆污染） |\n\n## 3. 上下文改写（Query Rewrite / 标准化）\n\n多轮对话的第一道工序，直接影响检索与理解质量：\n- **指代消解**：\"那它呢？\" → 结合历史改写成完整独立问题；\n- **口语标准化**：方言/简称/错别字 → 标准术语（\"补多少money\" → \"补贴金额是多少\"），教育场景学生提问尤其需要；\n- **查询扩展**：同义词/上下位词扩展提升召回（配合 RAG）；\n- 实现：小模型即可胜任（分类/改写任务用微调小模型，成本低时延低——呼应多模型路由）。\n\n## 4. 高频面试题\n\n1. 短期记忆和长期记忆分别怎么实现？（上下文窗口 vs 外部存储+检索注入；窗口管理参考 MemGPT/文件系统记忆）\n2. 记忆越存越多怎么控制？（相关性检索只注入 Top-K、时效衰减、去重合并、用户可管理）\n3. 个性化与隐私怎么平衡？（隔离、脱敏、可查看可删除、政务场景本地化部署）\n4. 记忆注入后提示词变长怎么办？（只注入选中字段、压缩摘要、前缀缓存——system 结构保持稳定）\n\n## 5. 衍生学习\n\n- MemGPT / Letta 与记忆操作系统\n- Agent 状态持久化（checkpoint）\n- 用户画像与推荐系统结合\n\n## 6. 参考资料\n\n- [MemGPT: Towards LLMs as Operating Systems](https://arxiv.org/abs/2310.08560)\n- [LangChain Memory](https://python.langchain.com/docs/versions/migrating_memory/)"
    },
    {
      "id": "agent-workflow-skill",
      "title": "工作流编排与 Skill 封装",
      "category": "Agent 系统",
      "status": "learned",
      "tags": [
        "工作流编排",
        "低代码",
        "Skill",
        "Airflow",
        "Agent平台"
      ],
      "links": [
        "openai-agent-sdk",
        "genspark-search-agent"
      ],
      "sources": [
        "[Apache Airflow 官方文档](https://airflow.apache.org/docs/apache-airflow/stable/)",
        "[Manus Skills（官方：技能自动沉淀机制）](https://manus.im/blog/manus-skills)"
      ],
      "file": "notes/01-agent/agent-workflow-skill.md",
      "updatedAt": "2026-10-20",
      "content": "# 工作流编排与 Skill 封装\n\n> **一句话**：工作流（Workflow）= 预定义步骤的确定性管道；Skill = 把「提示词 + 工具 + 流程 + 知识库」打包成可复用、可配置的能力资产。简历场景：风云平台基于 Airflow 做工作流编排 + Skill 封装，实现**零代码配置**的智能体业务流程——让业务人员拖拖配置就能上线 AI 应用，是平台型产品的核心卖点。\n\n## 1. 为什么平台需要\"编排\"（与自主 Agent 的关系）\n\n- 自主 Agent（Manus 式）灵活但不可控、成本不可预估；纯 workflow 确定性强但不灵活——**平台级答案是分层**：\n  - **80% 高频确定性场景** → 可视化工作流（低代码）：意图分类 → 检索 → 生成 → 后处理，节点可测试可回归；\n  - **20% 开放复杂任务** → Agent 循环（LLM 自主决策工具调用）；\n  - 这与 Genspark CTO 的建议完全一致（详见关联笔记），面试可以直接引用。\n\n## 2. 工作流编排的核心设计（简历：基于 Airflow）\n\n- **Airflow 的角色**：DAG（有向无环图）任务编排与调度——在平台里承接**数据/模型类定时管道**（知识库增量更新、评测集跑批、模型批量调用），LLM 业务链路则用自研轻量节点编排（低代码画布）；\n- **典型 LLM 工作流节点**：输入/意图分类 → 查询改写 → 知识检索 → 重排 → 提示词组装 → LLM 生成 → 格式校验/内容安全 → 输出；每个节点可独立配置与测试；\n- **工程要点**：节点幂等可重试、失败降级路径（检索挂了走兜底话术）、版本管理（流程改动可回滚）、运行日志与耗时/token 统计。\n\n## 3. Skill 封装（把能力变成资产）\n\n- 一个 Skill = 提示词模板 + 绑定的工具集 + 可选的固定子流程 + 引用的知识库，例如「政策匹配 Skill」= 政策专家提示词 + 检索工具 + 政策知识库；\n- 对业务人员：像\"安装应用\"一样把 Skill 拼进自己的智能体（零代码的关键）；\n- 对开发者：SKILL.md 式声明文件（Manus Skills 同款思路：模型分析成功交互后自动沉淀可复用技能），平台侧做统一注册、权限与计量；\n- Skill 的复利：越用越多、越用越准（使用数据反哺评测与优化），是平台的护城河资产。\n\n## 4. 高频面试题\n\n1. 什么时候用 workflow，什么时候用 Agent？（确定性/可审计 → workflow；开放探索 → Agent；分层组合）\n2. 低代码编排怎么兼顾灵活性？（节点可嵌套子流程/自定义代码节点/Skill 复用；复杂逻辑留 Agent 节点）\n3. 工作流失败了怎么排查？（节点级日志、重试与降级、Tracing 链路）\n\n## 5. 衍生学习\n\n- Dify / Coze 类平台节点编排对比\n- Airflow 与新型编排（Prefect、Dagster）差异\n- Agent 编排标准（A2A 协议等）\n\n## 6. 参考资料\n\n- [Apache Airflow 文档](https://airflow.apache.org/docs/apache-airflow/stable/)\n- [Manus Skills 官方博客](https://manus.im/blog/manus-skills)"
    },
    {
      "id": "genspark-search-agent",
      "title": "Genspark 搜索 Agent 架构",
      "category": "Agent 系统",
      "status": "learned",
      "tags": [
        "Agent",
        "Genspark",
        "搜索引擎",
        "Mixture-of-Agents",
        "Super-Agent"
      ],
      "links": [
        "manus-multi-step-execution"
      ],
      "sources": [
        "[Less Control, More Tools: How Genspark Built a Super Agent That Scales（CTO Kay Zhu 演讲全文，一手资料）](https://www.genspark.ai/blog/genspark-less-control-more-tools)",
        "[Introducing the World's First Mixture-of-Agents (MoA) System（Genspark 官方）](https://www.genspark.ai/blog/genspark-mixture-of-agents)",
        "[Welcome to Genspark, the AI Agentic Engine（官方：Sparkpages 介绍）](https://www.genspark.ai/blog/genspark-intro)",
        "[Mixture-of-Agents Enhances Large Language Model Capabilities（arXiv:2406.04692）](https://arxiv.org/abs/2406.04692)",
        "[QED42: Genspark Super Agent 与 Manus 对比](https://www.qed42.com/insights/genspark-super-agent-the-rise-of-next-generation-ai-assistants-and-how-it-compares-to-manus-ai)"
      ],
      "file": "notes/01-agent/genspark-search-agent.md",
      "updatedAt": "2026-10-20",
      "content": "# Genspark 搜索 Agent 架构\n\n> **一句话**：Genspark 从「AI 搜索引擎」起家，用 **Mixture-of-Agents（多模型混合编排）+ 实时浏览检索**取代传统「爬索引 → 排链接」的搜索范式；2025 年 4 月升级为 **Super Agent**，设计哲学是 **Less Control, More Tools**——不编排固定流程，把一堆好模型、趁手的工具交给一个会回溯的 Agent 循环。\n\n## 1. 背景与发展线\n\n- 公司：**MainFunc AI**（2024 年成立），两位创始人都是搜索老兵：**景鲲（Eric Jing）**，前百度集团 EVP / 小度 CEO；**Kay Zhu**，前 Google / 百度工程师，约 20 年搜索经验，任 CTO。\n- 时间线：\n  - **2024-06**：发布 AI 搜索引擎，核心产品形态是 **Sparkpage**（针对每条查询实时生成的\"定制结果页\"，无广告、无竞价排名）；\n  - **2024-12**：官宣 **Mixture-of-Agents (MoA)** 系统；\n  - **2025-04**：发布 **Super Agent**——一句话完成打电话、做 PPT、生成视频、深度研究等多模态任务；据官方披露 **9 天做到 $10M ARR，45 天 $36M ARR**；\n  - 10 周内连发 8 个产品（AI Browser、AI Sheets、AI Slides、Call for Me 等），团队仅 20 余人——小团队高产出本身就是这套架构\"薄编排、厚工具\"的证明。\n\n## 2. 搜索 Agent 架构：从「链接列表」到 Sparkpage\n\n**传统搜索引擎**（Google 范式）：爬虫预先建索引 → 查询时匹配排序 → 返回 10 条蓝色链接（+广告），**用户自己**逐个点开拼出答案。\n\n**Genspark 的 Agentic Search**：\n\n```\n用户查询（自然语言问题）\n   ▼\n① 查询理解与任务规划：Agent 自主决定要查什么、查几个源、查多深\n   ▼\n② 并行检索多个信息源：实时联网浏览（不局限于静态索引）+ 内置付费数据集\n   ▼\n③ 交叉验证：多个 agent 互相核对事实，抑制幻觉\n   ▼\n④ 聚合生成一张 Sparkpage：为这条查询\"现场生成\"的定制结果页\n   （结构化答案 + 引用来源 + 可内嵌表格/图片/视频/交互组件）\n```\n\n要点：\n\n- **实时优先**：靠实时浏览抓取保证新鲜度与长尾覆盖，配合内置 premium 数据集补结构性数据；\n- **生成而非匹配**：结果页是现场合成的，不是预先排好的索引页——这是\"搜索 Agent\"与\"带 AI 摘要的搜索\"的本质区别；\n- **Sparkpage 是容器**：Genspark 后续所有 Agent 能力（表格、幻灯、视频、通话结果）都以 Sparkpage 为展示载体，搜索形态自然长成了 Agent 形态。\n\n## 3. Mixture-of-Agents（MoA）：模型编排层\n\n官方口径（CTO 演讲）：引擎 = **9 个不同规模的 LLM** 组成的 mixture-of-agents + **80+ 专用工具** + **10+ 付费数据集**。\n\n- 核心信念：**不存在 one model to rule them all**——任何单一模型都有短板，厂商每发一版新模型格局就变；\n- **按步骤特点路由模型**：OpenAI 擅长深度研究与创意写作、Claude 擅长 agentic 推理与复杂编码、Gemini 擅长多模态理解；任务序列里每一步都交给当下最合适的模型；\n- 与学术 MoA（arXiv:2406.04692：多层多个 LLM 互相提议-聚合以增强输出）思想同源，Genspark 是它的工程化产品形态；\n- 效果：不绑死单一厂商，谁家模型强就即时吃到红利。\n\n## 4. 设计哲学：Less Control, More Tools（最重要的一节）\n\n> 来源：CTO Kay Zhu 在 VentureBeat Transform 2025 的演讲《How We Built a Super Agent That Scales》。\n\n- 团队早期也做过 workflow 编排引擎，后来**把硬编码 workflow 基础设施全部抛弃**，全面转向 agentic engine。理由：\n\n  > Workflow 是铁轨上的火车：一切顺利时高效，一旦出轨就是灾难。\n  > Agent 是带 GPS 的老司机：路堵了就换一条路。\n  > **在 workflow 里，错误会累积（errors accumulate）；在 agent 里，错误可恢复（errors are recoverable）。**\n\n- **Agent 的本质定义（CTO 原话）**：**LLM in a while loop —— plan → execute → observe → backtrack**。Agent 的价值恰恰在\"未预设路径\"时体现：LLM 自己即兴生成新的工作流。\n- **More Tools（工具的网络效应）**：每加一个工具不是 +1 个能力，而是与既有工具**指数级组合**（80 个工具 ≈ 数万种组合，像 Linux 管道 / 乐高积木）。Genspark 把工具做成可自由组合的 API 块，专业工具（Crunchbase、数据库连接器、分析平台、电话 API）直接预装。\n- **反对\"原教旨主义 Agent\"**（只给键盘/鼠标/浏览器，让 agent 现场自己写工具）：演讲现场演示过这种打法，结论是**给专业人士配齐趁手工具，交付更快更好**——工具的复用性比现场发挥可靠得多。\n- **给企业的落地建议**：80% 的确定性场景保留 workflow；把 workflow 搞不定的**最难 20% 交给 agent**，并预期这个 20% 会越来越大。\n\n## 5. 改进飞轮（Improvement Loop）\n\n- **LLM-as-Judge** 给整个会话打总分，再把总分 reward **归因（credit assignment）到会话里的每一步**——知道\"哪一步选错了工具/模型\"；\n- 每天数十万真实会话作为样本 → 沉淀\"什么情况下该用什么工具/模型\"的经验；\n- 通过 **强化学习 + prompt playbook** 回灌引擎，形成数据飞轮：用户越多 → 会话数据越多 → 路由与工具选择越准。\n\n## 6. Super Agent 能力面（工具全景示例）\n\n| 类别 | 示例 |\n|---|---|\n| 基础设施 | 虚拟机/浏览器/终端：浏览网页、Jupyter 跑数据分析、操作电脑 |\n| 生产力 | AI Slides（PPT）、AI Sheets、文档与网页生成、图像/视频生成 |\n| 独特能力 | **Call for Me**：AI 直接打电话（现场 demo 打给主办方调整演讲时段） |\n| 数据源 | Crunchbase API、付费数据集、数据库连接器、分析平台 |\n\n## 7. 与 Manus 对比（面试高频）\n\n| 维度 | Manus | Genspark |\n|---|---|---|\n| 出身 | 通用自主 Agent（云端 VM 沙箱） | AI 搜索引擎 → Super Agent |\n| 核心隐喻 | 给模型**一台完整的电脑** | 给模型**一套智能管道**：9 模型 × 80+ 工具自由组合 |\n| 执行骨架 | 单主 Agent + Subagent 上下文隔离，重上下文工程 | MoA：规划 → 按步骤路由模型 → 多 agent 并行 → 聚合 |\n| 模型策略 | Claude 为主 + 专项小模型（微调 Qwen 等） | 9 个不同厂商/规模 LLM 混合路由，不绑死一家 |\n| 搜索 | 沙箱内浏览/搜索只是工具之一 | 起家本领：实时检索 + 多源交叉验证 + Sparkpage |\n| 公开方法论 | Context Engineering（缓存/文件记忆/todo 复述） | Less Control, More Tools + 步骤级改进飞轮 |\n| 共同点 | 都反对重 workflow 编排、都信奉「Agent 循环 + 回溯」，只是 Manus 把功夫花在**上下文**，Genspark 把功夫花在**工具与模型编排** | |\n\n## 8. 设计启示\n\n1. **别急着编排流程**：先把 agent loop（含 observe → backtrack）做对，workflow 只留给确定性场景；\n2. **工具质量 > 模型调优**：投资可组合的 API（乐高标准），每个新工具都应能被既有工具串联；\n3. **多模型路由是性价比杠杆**：按步骤特点选模型，而不是全链路都上最贵模型；\n4. **评测要细到步骤级**：会话级打分 + 步骤归因，才知道该优化哪一步（LLM-as-Judge）；\n5. **搜索型 Agent 的护城河**在\"实时检索 + 多源交叉验证\"，而不是索引规模。\n\n## 9. 衍生学习（已立坑，见图谱 todo 节点）\n\n- Mixture-of-Agents 论文精读（arXiv:2406.04692）\n- LLM-as-Judge 与 Agent 强化学习（RLHF → Agent RL）\n- 传统搜索引擎架构（爬取-索引-排序）作为对照\n- Deep Research 类产品（OpenAI / Gemini Deep Research）架构对比\n- Multi-Agent 协作模式：主从、并行、辩论（debate）、路由\n\n## 10. 参考资料\n\n- [Less Control, More Tools: How Genspark Built a Super Agent That Scales（CTO Kay Zhu 演讲全文）](https://www.genspark.ai/blog/genspark-less-control-more-tools)\n- [Introducing the World's First Mixture-of-Agents (MoA) System（官方）](https://www.genspark.ai/blog/genspark-mixture-of-agents)\n- [Welcome to Genspark, the AI Agentic Engine（官方：Sparkpages）](https://www.genspark.ai/blog/genspark-intro)\n- [Mixture-of-Agents 论文（arXiv:2406.04692）](https://arxiv.org/abs/2406.04692)\n- [QED42: Genspark vs Manus 对比](https://www.qed42.com/insights/genspark-super-agent-the-rise-of-next-generation-ai-assistants-and-how-it-compares-to-manus-ai)"
    },
    {
      "id": "manus-multi-step-execution",
      "title": "Manus Agent 多步任务执行模式",
      "category": "Agent 系统",
      "status": "learned",
      "tags": [
        "Agent",
        "Manus",
        "Context-Engineering",
        "多步任务",
        "沙箱"
      ],
      "links": [
        "genspark-search-agent"
      ],
      "sources": [
        "[Context Engineering for AI Agents: Lessons from Building Manus（Manus 官方博客，一手资料）](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)",
        "[How Manus works（社区对系统提示词/循环的逆向分析）](https://gist.github.com/renschni/4fbc70b31bad8dd57f3370239dccd58f)",
        "[Lance Martin: Context Engineering in Manus](http://rlancemartin.github.io/2025/10/15/manus/)",
        "[让 Manus 在生产环境中稳定运行的六项上下文工程技术（中文解读）](https://tianpan.co/zh/blog/2026/03/02/context-engineering-lessons-from-manus)",
        "[Manus Wide Research 多智能体文档（官方）](https://manus.im/docs/zh-tw/features/wide-research)",
        "[OpenManus（社区开源复刻，FoundationAgents）](https://github.com/FoundationAgents/OpenManus)",
        "[Hacker News 上对官方博客的讨论](https://news.ycombinator.com/item?id=44635141)"
      ],
      "file": "notes/01-agent/manus-multi-step-execution.md",
      "updatedAt": "2026-10-20",
      "content": "# Manus Agent 多步任务执行模式\n\n> **一句话**：Manus = 把 LLM 放进一台云端虚拟电脑里，用「todo.md 计划复述 + 文件系统外部记忆 + 围绕 KV Cache 的上下文工程」驱动的长循环自主 Agent。它最值得学的不是炫酷 demo，而是**让平均 50+ 次工具调用的长任务不崩**的那套工程细节。\n\n## 1. Manus 是什么（背景）\n\n- 2025 年 3 月发布，来自 Butterfly Effect（蝴蝶效应，国内创业公司，此前的产品是 Monica 助手），创始人肖弘（Red），联合创始人季逸超（Peak Ji，上下文工程博客作者）。\n- 定位：**通用自主 Agent（General AI Agent）**——用户只给一个目标，Manus 自主规划、执行、交付\"成品\"（报告 / 网站 / 表格 / 数据分析图表），而不是像聊天机器人那样来回对话。\n- 发布时在 **GAIA 基准**（通用 AI 助手能力测试，考察真实多步任务）三个难度级别均取得当时的 SOTA，借此爆红，初期邀请码一码难求。\n- 名字来源：Mens et Manus（MIT 校训「头脑与双手」）——不仅会思考，还要会动手。\n- 本体闭源；社区有高热度的开源复刻 **OpenManus**（MetaGPT/FoundationAgents 团队），可读其源码理解 Agent 循环骨架。\n- 据媒体报道（36 氪、路透等）：2026 年经历了 Meta 约 20 亿美元收购、随后又独立发展并完成约 5 亿美元融资（投后估值约 40 亿美元），2026 年中 ARR 达 4–5 亿美元——商业层面波折不断，但技术上仍是\"多步任务执行\"的标杆研究对象。\n\n## 2. 多步任务执行的生命周期\n\n整体是一个 **Agent Loop：分析 → 计划 → 执行 → 观察 →（回溯/纠错）→ 交付**：\n\n```\n用户目标（自然语言，只说\"要什么\"，不说\"怎么做\"）\n   │\n   ▼\n┌──────────────────┐   ┌─────────────────────────────────────┐\n│ 1. 理解任务        │ → │ 2. 制定计划：生成 todo.md             │\n│    （必要时澄清）   │   │    （拆成可执行、可勾选的步骤清单）      │\n└──────────────────┘   └─────────────────────────────────────┘\n                                     │\n                                     ▼\n        ┌──────────────────────────────────────────────────┐\n        │ 3. 循环执行（官方口径：平均约 50 次工具调用/任务）       │\n        │   ① 在完整历史上下文中预测下一个动作                     │\n        │   ② 调用工具（shell / 浏览器 / 搜索 / 文件读写）         │\n        │   ③ 观察结果 → 更新 todo.md 勾选进度                    │\n        │   ④ 出错 → 保留错误现场，换思路重试（回溯），不重置        │\n        └──────────────────────────────────────────────────┘\n                                     │\n                                     ▼\n        ┌──────────────────────────────────────────────────┐\n        │ 4. 整理沙箱里的产物文件，交付结果（文档/图表/网站 + 链接） │\n        └──────────────────────────────────────────────────┘\n```\n\n两个关键认知：\n\n1. **计划是活的**：todo.md 随执行动态增删改，不是开局一次性生成就完事；发现新信息（比如数据异常）会回头补步骤。\n2. **每一步的本质**：模型基于全部历史上下文预测下一个动作。任务越长上下文越大，所以**上下文管理才是这套模式的真正架构核心**（见第 4 节）。\n\n## 3. 执行环境：云端沙箱虚拟机\n\n- **每个会话一台独立云端 Linux VM**，会话之间完全隔离，任务结束后可销毁。\n- 工具集 = 一台完整电脑的能力：**shell 终端、浏览器（可登录、点按、填表）、代码执行、文件读写/编辑器、联网搜索**。\n  - 与\"给模型接几个 API\"的区别：Manus 给了模型**一台完整的通用计算机**，因此理论上能力没有上限（会写代码 = 能组合出任意新工具），这也是名字里 \"Manus（手）\" 的含义。\n- **异步执行**：任务在云端跑，用户可以关电脑，完成后通知；中途可以随时下发新指令改变方向，已完成的产物作为后续上下文保留。\n- **会话可回放（Replay）**：整个过程（每个工具调用、每次浏览器操作）可录制回放，用于审计和复盘。\n\n## 4. 长任务不崩的秘密：上下文工程六大机制\n\n> 来源：官方博客《Context Engineering for AI Agents: Lessons from Building Manus》（2025-07，季逸超）。\n> 出发点：Manus 输入/输出 token 比约 **100:1**——一个任务动辄几十万 token 上下文，延迟和成本全靠工程手段扛。\n\n### 4.1 todo.md：把计划反复「复述」到注意力末尾\n\n- 复杂任务开局创建 `todo.md`，每完成一步就更新勾选状态，等于不断把全局计划**重写到上下文末尾**。\n- 原理：长上下文存在 **lost-in-the-middle**（中间位置的信息注意力衰减）和**目标漂移**问题；计划反复出现在末尾 = 始终处于\"近期注意力\"区域。\n- 附带好处：todo.md 以追加方式出现在上下文尾部，**不破坏前缀缓存**（配合 4.3）。\n\n### 4.2 文件系统即外部记忆（Filesystem as Context）\n\n- 128K 窗口装不下长任务，且长上下文本身性能下降、价格昂贵 → 模型把中间产物**写进沙箱文件系统**，需要时再读回，窗口里只保留\"索引\"。\n- 压缩必须**可恢复**：网页内容可以丢，但要留 URL；文档内容可以省，但要留路径——随时能重新加载原文。作者认为不可逆的摘要压缩有信息丢失风险，而文件系统 \"unlimited in size, persistent by nature\"。\n- 这本质上是把「上下文窗口」和「记忆」解耦：窗口是工作台，文件系统才是仓库。\n\n### 4.3 KV Cache / Prompt Caching 对齐：一切为了缓存命中\n\n- Prompt 缓存只对**稳定前缀**生效，所以 Manus 抠所有会破坏前缀的细节：\n  - 系统提示词开头**不放精确时间戳**等易变内容；\n  - 上下文 **append-only**：只追加，不改写历史；\n  - **序列化确定性**：JSON 的 key 顺序固定（防止不同轮次序列化结果不同导致前缀变化）；\n  - 需要时显式设置**缓存断点**；自托管场景用 vLLM 前缀缓存并按 session 路由请求。\n- 为什么值得抠：缓存命中的输入 token 价格约为未命中的 **1/10**（博客举例 Claude Sonnet：$0.30 vs $3.00 / MTok），Agent 场景输入量巨大，缓存直接决定商业可行性。\n\n### 4.4 工具「遮蔽」而非「移除」\n\n- 任务不同阶段可用的工具不同（比如浏览器任务阶段不该看到 shell），但**动态增删工具列表**有两个恶果：击穿前缀缓存；模型幻觉调用已删除的工具。\n- Manus 的做法：**上下文感知的状态机 + 解码时遮蔽（masking）token logits**——工具仍在提示词里，但通过 logit 遮蔽让模型\"看不见\"不可用的工具；工具命名用统一前缀（`browser_`、`shell_`）便于按组遮蔽。\n- 并利用 response prefill 的三种函数调用模式（Auto / Required / Specified）对每步的工具选择做精细控制。\n\n### 4.5 保留错误（Keep Mistakes）\n\n- 失败的调用、报错信息、stack trace **全部留在上下文里**，不清空轨迹、不重置会话。\n- 原理：让模型**隐式更新内部信念**（\"这条路刚走过、会塌\"），显著降低重复同类错误的概率。\n- 作者观点：错误恢复能力才是真正 Agent 行为的标志，而学术基准普遍只测\"一次做对\"，忽视了这一点。\n\n### 4.6 避免 few-shot 陷阱（引入受控随机性）\n\n- 模型擅长模仿上下文中的模式：比如连续审阅 20 份简历时，会陷入前几份形成的\"节奏\"，越到后面漂移和幻觉越严重（相当于把历史轨迹当成了 few-shot 示范）。\n- 做法：对 action/observation 引入**结构化变异**——不同的序列化模板、措辞变化、格式噪声，用受控随机性打破模式重复。\n\n> 官方自嘲方法论为「Stochastic Graduate Descent（随机研究生下降法）」：靠手动架构搜索、prompt 调参和经验猜测迭代，且 agent 框架已重写过四次——侧面说明 Agent 工程目前仍是经验科学。\n\n## 5. 多 Agent 协作：主 Agent + Subagent\n\n- **主 Agent** 保持全局视角负责规划与交付；遇到上下文容易膨胀的子任务（如大规模检索）就**派生 Subagent 并行执行**，子任务在独立上下文里跑，只把**收敛后的结论**回传主上下文（官方 Wide Research 功能即为典型：一个主 agent 分解任务，并行部署多个子 agent 分头检索）。\n- **按任务类型路由模型**（而非按 agent 角色固定）：社区分析显示其主力为 Claude 系列（编码、agentic 推理），同时混用 Qwen 等其他模型；官方 AMA 亦提过用微调小模型跑批量/重复类子任务以降本。多 Agent 架构让\"每个子任务用最合适的模型\"变得自然。\n- 设计启示：**复杂度优先用\"上下文隔离\"消化，而不是用\"流程编排\"消化**——这与 Genspark 的 Less Control, More Tools 哲学殊途同归（见关联笔记）。\n\n## 6. 一个完整任务走查（示例）\n\n任务：「调研亚马逊上瑜伽垫的销量与口碑，给我一份选品报告」\n\n1. **计划**：todo.md 列出——搜索商品 → 记录价格/评论数/评分到表格 → 清洗数据 → 画图 → 写结论。\n2. **执行**：打开浏览器逐页抓取搜索结果，中间数据写入 `amazon_data.csv`（文件系统记忆）；中途某页反爬失败 → **保留报错**，改走另一数据源。\n3. **观察与回溯**：发现评分分布异常 → 在 todo.md **新增**一项\"补充抓取差评样本\"，回头重查。\n4. **交付**：用沙箱里的 Python（pandas 清洗 + matplotlib 出图）生成图表，写成 `report.md`，最终交付文件 + 图表链接；全程几十次工具调用，产物全部留在沙箱文件系统，可回放检查。\n\n## 7. 设计启示（可迁移到自己的 Agent 项目）\n\n| Manus 机制 | 自己项目里可以怎么做 |\n|---|---|\n| todo.md 计划复述 | 多步 Agent 维护一个计划文件，每步后 append 进度，抗目标漂移 |\n| 文件系统即记忆 | 上下文装不下的中间结果落盘（文件/DB），窗口里只留路径或摘要，按需读回 |\n| KV Cache 对齐 | 提示词前缀保持稳定 + append-only + 序列化确定性，token 成本可差 10 倍 |\n| 工具遮蔽 | 动态控制工具可用性时用\"遮蔽\"而不是增删，别破坏提示词结构和缓存 |\n| 保留错误 | 不要清理失败轨迹；错误上下文是模型免费的学习信号 |\n| 受控随机性 | 批量同构任务中给序列化加变异，防 few-shot 式的模式固化 |\n| Subagent 隔离 | 脏活累活派给子 Agent 独立上下文，只回收敛后的结论 |\n\n## 8. 衍生学习（已立坑，见图谱 todo 节点）\n\n- Context Engineering 系统方法：KV Cache 原理、lost-in-the-middle、prompt caching 机制\n- ReAct / Plan-and-Execute / Reflexion 等 Agent 范式对比\n- Agent 沙箱技术选型：VM vs 容器 vs WASM，以及 Agent 安全隔离\n- GAIA Benchmark：怎么科学评测\"通用助手多步任务能力\"\n- OpenManus 源码走读：社区如何复刻这套循环\n\n## 9. 参考资料\n\n- [Context Engineering for AI Agents: Lessons from Building Manus（Manus 官方博客，一手资料）](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)\n- [How Manus works（社区对系统提示词/循环的逆向分析）](https://gist.github.com/renschni/4fbc70b31bad8dd57f3370239dccd58f)\n- [Lance Martin: Context Engineering in Manus](http://rlancemartin.github.io/2025/10/15/manus/)\n- [让 Manus 在生产环境中稳定运行的六项上下文工程技术（中文解读）](https://tianpan.co/zh/blog/2026/03/02/context-engineering-lessons-from-manus)\n- [Manus Wide Research 多智能体文档（官方）](https://manus.im/docs/zh-tw/features/wide-research)\n- [OpenManus（社区开源复刻）](https://github.com/FoundationAgents/OpenManus)\n- [Hacker News 讨论](https://news.ycombinator.com/item?id=44635141)\n- [36 氪：大厂夹缝中突围的 Manus（2026 商业进展）](https://eu.36kr.com/zh/p/4019243786391682)"
    },
    {
      "id": "openai-agent-sdk",
      "title": "OpenAI Agent SDK 与智能体工作台",
      "category": "Agent 系统",
      "status": "learned",
      "tags": [
        "Agent",
        "OpenAI-Agent-SDK",
        "智能体平台",
        "Handoff"
      ],
      "links": [
        "manus-multi-step-execution",
        "genspark-search-agent",
        "function-call",
        "agent-workflow-skill"
      ],
      "sources": [
        "[OpenAI Agents SDK 官方文档](https://openai.github.io/openai-agents-python/)",
        "[OpenAI Agents JS（TS 版）](https://openai.github.io/agents-js/)"
      ],
      "file": "notes/01-agent/openai-agent-sdk.md",
      "updatedAt": "2026-10-20",
      "content": "# OpenAI Agent SDK 与智能体工作台\n\n> **一句话**：OpenAI Agent SDK 是官方的多 Agent 编排框架，四个核心原语——**Agent（指令+模型+工具）、Handoff（Agent 间转交）、Guardrail（输入输出护栏）、Tracing（全过程可观测）**，轻量、原生、可换模型。简历场景：2026 年 openclaw（开源个人 AI 助手）带火\"人人要有自己的 Agent\"后，基于该 SDK 自研智能体工作台，服务公司内部、政府与制造业企业提效。\n\n## 1. 核心概念\n\n| 原语 | 作用 | 类比自己项目里的东西 |\n|---|---|---|\n| Agent | 模型 + 指令 + 工具集的最小单元 | 平台里配置的一个个\"智能体应用\" |\n| Tool | Function Call 工具（Python 函数自动转 schema） | 平台工具层封装的检索/查数/生成类工具 |\n| Handoff | 一个 Agent 把对话转交给更专业的 Agent | 智能客服 → 政策专精 Agent 的路由 |\n| Guardrail | 前置/后置校验（敏感词、格式、合规） | 政务场景的内容安全与格式校验 |\n| Tracing | 每步调用链路可视化追踪 | 平台的运行日志与调试面板 |\n\n一个最小可用结构（伪代码）：\n\n```python\nfrom agents import Agent, Runner\n\npolicy_agent = Agent(\n    name=\"政策匹配助手\",\n    instructions=\"你是政策专家，只依据检索到的政策材料回答……\",  # 提示词工程的落点\n    tools=[search_policy_kb, match_enterprise],          # Function Call 的落点\n)\nresult = await Runner.run(policy_agent, \"苏州智能制造企业能申报什么补贴？\")\n```\n\n## 2. 为什么选它做工作台底座（选型答法）\n\n- **官方原生 + 极简抽象**：没有重框架的概念税（对比 LangChain 的层层封装），核心逻辑就是 Agent 循环（呼应 Manus「LLM in a while loop」、Genspark「Less Control, More Tools」——两家头部产品的共识：薄编排、厚工具）；\n- **Handoff 原生支持多 Agent 分工**：主 Agent 做意图路由，垂类 Agent（政策/问数/客服）各带各的工具与知识库；\n- **Tracing 内置**：政务交付必须可审计，每次运行的工具调用、token 消耗、中间输出全链路留痕；\n- **不锁模型**：可接 OpenAI，也支持接入自部署的 vLLM 服务（Qwen/GLM），内网政务环境友好——这正是简历里\"内网模型部署 + 平台模型管理配置\"的组合拳。\n\n## 3. 智能体工作台的产品化要点（简历场景展开）\n\n- **面向不同角色的抽象**：业务人员（选模板/改提示词/配知识库，零代码）、开发者（SDK 开发自定义工具/Skill）、管理员（模型路由/配额/审计）；\n- **Skill 封装**：把\"提示词 + 工具 + 固定流程 + 知识库引用\"打包成可复用资产（详见工作流编排笔记）；\n- **多模型配置**：同一 Agent 允许配置不同底座模型并按成本/时延路由（分类走小模型、推理走大模型，呼应 Genspark MoA 思想）；\n- **评测与回归**：Agent 上线前跑固定场景集（准确率/工具选择正确率），防\"改一处坏一片\"。\n\n## 4. 高频面试题\n\n1. Agent SDK 和 LangChain/LangGraph 怎么选？（轻量原生 vs 生态组件全；需要精细状态机用 LangGraph，快速多 Agent 分工 + 官方维护用 Agents SDK）\n2. Handoff 和工具调用的区别？（Handoff 是\"换人接手对话主权\"，工具是\"叫人帮忙干一件事然后拿结果回来\"）\n3. 多 Agent 系统怎么防失控？（Guardrail、每步留痕 Tracing、工具最小权限、循环深度/预算上限）\n\n## 5. 衍生学习\n\n- openclaw 开源项目架构（个人 AI 助手形态）\n- LangGraph 状态机式编排对比\n- Agent 评测（工具选择正确率、任务完成率）\n\n## 6. 参考资料\n\n- [OpenAI Agents SDK（Python）](https://openai.github.io/openai-agents-python/)\n- [OpenAI Agents JS](https://openai.github.io/agents-js/)"
    },
    {
      "id": "function-call",
      "title": "Function Call 与工具调用",
      "category": "大模型应用",
      "status": "learned",
      "tags": [
        "Function-Call",
        "Tool-Use",
        "Agent",
        "JSON"
      ],
      "links": [
        "prompt-engineering",
        "openai-agent-sdk",
        "hallucination-mitigation"
      ],
      "sources": [
        "[OpenAI Function Calling 官方文档](https://platform.openai.com/docs/guides/function-calling)",
        "[Anthropic Tool Use 文档](https://docs.anthropic.com/en/docs/build-with-claude/tool-use/overview)",
        "[ReAct 论文（工具调用的文本推理前身）](https://arxiv.org/abs/2210.03629)"
      ],
      "file": "notes/02-llm-app/function-call.md",
      "updatedAt": "2026-10-20",
      "content": "# Function Call 与工具调用\n\n> **一句话**：Function Call 让模型不再\"只会说话\"，而是能输出**结构化的工具调用意图**（函数名 + JSON 参数），由应用程序执行后把结果回传，模型再基于真实结果作答——这是 Agent 的一切基础，也是抑制幻觉（把事实问题交给工具）的关键手段。\n\n## 1. 工作流程（本质是个循环）\n\n```\n① 开发者：用 JSON Schema 声明工具\n   { name: \"query_policy\", description: \"按企业条件检索政策\",\n     parameters: { region: string, industry: string, size: enum } }\n\n② 模型：判断需要工具 → 输出结构化调用意图（不是自然语言）\n   query_policy({ region: \"苏州\", industry: \"智能制造\" })\n\n③ 应用：真正执行函数（查库/调 API/跑计算）\n\n④ 应用：把执行结果（或错误信息）回传给模型\n\n⑤ 模型：基于真实结果生成最终回答（可能继续②，多轮调用）\n```\n\n要点：\n- **模型不执行任何东西**，它只产生\"调用意图\"，执行权在应用侧——这是安全边界；\n- 工具的 `description` 和参数描述**就是给模型看的提示词**，写得越清楚选得越准；\n- 支持一次返回多个调用（并行工具调用），也支持强制指定必调某个工具（tool_choice）。\n\n## 2. 与 ReAct 的关系\n\n- ReAct（2022）：用文本格式模拟「Reasoning + Acting」，`Thought: ... Action: search[...]`，靠提示词约定、正则解析——容易格式出错；\n- 原生 Function Call：模型经过专门训练，直接输出结构化 JSON，稳定且是 API 一等公民。两者思想同源：**推理决定行动，观察结果再推理**。\n\n## 3. 工程实践要点（简历场景：辅助开发工具类并通过 Function Call 调用减少幻觉）\n\n| 实践 | 说明 |\n|---|---|\n| 参数强校验 | 模型输出的参数先过 Schema 校验，不合法直接回传错误让模型重试 |\n| 错误也要回传 | 工具执行失败把报错返回模型，它会换参数或换路径（呼应 Manus「保留错误」） |\n| 工具粒度 | 一个工具做一件事、命名动词化、参数少而明确；工具过多反而降低选择准确率 |\n| 结果截断 | 工具返回大结果要摘要/分页，避免撑爆上下文 |\n| 幻觉抑制 | 事实类问题（政策条款、库存、订单状态）强制走工具，禁止模型凭记忆回答 |\n| 幂等与权限 | 写操作工具要幂等设计 + 最小权限 + 确认环节 |\n\n## 4. 高频面试题\n\n1. Function Call 的原理？模型真的执行了函数吗？（没有，模型输出结构化意图，应用执行）\n2. 模型选错工具/参数错了怎么办？（描述优化、参数校验回传重试、tool_choice 约束、few-shot 示例）\n3. Function Call 和 MCP 的关系？（MCP 是工具的标准化协议/生态——统一工具接入方式；Function Call 是模型侧能力）\n4. 如何减少多工具场景下的误调用？（工具数量控制、分组按需提供、命名与描述工程化）\n\n## 5. 衍生学习\n\n- MCP（Model Context Protocol）工具协议生态\n- 并行工具调用与多工具编排\n- 结构化输出（Structured Outputs）与 JSON Schema 约束解码\n\n## 6. 参考资料\n\n- [OpenAI Function Calling 官方文档](https://platform.openai.com/docs/guides/function-calling)\n- [Anthropic Tool Use 文档](https://docs.anthropic.com/en/docs/build-with-claude/tool-use/overview)\n- [ReAct: Synergizing Reasoning and Acting in Language Models](https://arxiv.org/abs/2210.03629)"
    },
    {
      "id": "hallucination-mitigation",
      "title": "大模型幻觉抑制",
      "category": "大模型应用",
      "status": "learned",
      "tags": [
        "幻觉",
        "幻觉抑制",
        "评测",
        "RAG",
        "校验"
      ],
      "links": [
        "rag-vector-kb",
        "function-call",
        "text2sql-chatbi"
      ],
      "sources": [
        "[幻觉综述论文（A Survey on Hallucination in LLMs）](https://arxiv.org/abs/2311.05232)",
        "[SelfCheckGPT（自检式幻觉检测）](https://arxiv.org/abs/2303.08896)"
      ],
      "file": "notes/02-llm-app/hallucination-mitigation.md",
      "updatedAt": "2026-10-20",
      "content": "# 大模型幻觉抑制\n\n> **一句话**：幻觉 = 模型生成**看似合理但与事实/输入不符**的内容。根因是它的训练目标只是\"预测下一个最像的词\"，没有任何真实性约束。工程上无法根除、只能**分层压制**：事前给依据（RAG/工具/元数据）、事中加约束（低温/结构化/提示限定）、事后做校验（执行/溯源/自检）。简历里问数、Function Call、RAG 三处\"减少幻觉\"的实践，串起来就是一套完整的分层防御答案。\n\n## 1. 幻觉的分类与成因\n\n- **事实性幻觉（Factuality）**：与世界不符——编造政策条款、不存在的论文；\n- **忠实性幻觉（Faithfulness）**：与给定输入/检索材料不符——材料里没有却硬答、曲解表格数字；\n- 成因（面试简答版）：\n  1. 训练目标 = 下一词概率最大化，\"流畅\"优先于\"真实\"；\n  2. 训练数据本身有错且过时，模型知识有边界但**不知道自己不知道**；\n  3. 解码随机性（温度采样）放大编造；\n  4. 提示词诱导（强行要求回答没有依据的问题，模型宁可编）。\n\n## 2. 分层防御体系（核心框架）\n\n```\n┌─ 事前（给依据）────────────────────────────┐\n│ RAG 检索真实材料 | 工具调用查实时数据         │\n│ 元数据/schema 对齐 | 提示词限定\"只依据材料回答\"│\n│ 允许说\"不知道\"：无依据时输出兜底话术/转人工    │\n├─ 事中（加约束）────────────────────────────┤\n│ 低 temperature | 结构化输出（JSON Schema）    │\n│ 引用标记：每个论断绑定材料编号               │\n├─ 事后（做校验）────────────────────────────┤\n│ 可执行的先执行（SQL/计算交给代码）            │\n│ 结果合理性校验（量级/行数/类型）              │\n│ 溯源校验：答案与引用片段一致性比对             │\n│ SelfCheckGPT：多次采样对比，分歧大→疑似幻觉    │\n│ 人工反馈回流（点踩日志→badcase 池→优化）      │\n└───────────────────────────────────────────┘\n```\n\n## 3. 场景化落地（把简历三处实践串成体系答）\n\n- **智能问数**：数字必须来自 SQL 执行结果（模型禁止心算）、schema/值先检索对齐、执行报错回传重试 → 事实性幻觉压制；\n- **Function Call 工具化**：订单状态/政策条款这类事实问题强制走工具，模型只负责组织语言 → 从根上绕开记忆幻觉；\n- **RAG + 引用**：只依据材料回答 + 引用编号，忠实性幻觉可查可溯；检索为空时明确说\"知识库未覆盖\"；\n- **正负样本迭代**：badcase（幻觉样本）作为负样本进入评测集与微调数据，模型层面也变好。\n\n## 4. 评测（怎么证明幻觉变少了）\n\n- 构造幻觉评测集：无答案问题（看是否老实说不知道）、易编造实体问题、材料冲突问题；\n- 指标：忠实度（Faithfulness，答案是否被材料支持）、事实准确率、拒答率/误拒率平衡；\n- 自动化：LLM-as-Judge 按\"答案-引用\"对齐打分；关键场景人工抽检。\n\n## 5. 高频面试题\n\n1. 幻觉能彻底解决吗？为什么？（不能，概率生成机制决定；工程目标是可控可发现可兜底）\n2. RAG 之后为什么还有幻觉？（检索错了、材料矛盾、生成不忠实——所以要分段评测+引用约束+忠实度校验）\n3. 温度调 0 就没幻觉了吗？（只是降低采样随机性，知识性编造依旧）\n4. 怎么让模型\"知道自己不知道\"？（提示允许拒答 + 无依据兜底策略 + 置信度/自检采样）\n\n## 6. 衍生学习\n\n- 忠实度评测框架（RAGAS）\n- 置信度估计与校准（calibration）\n- 检测与水印（watermark）技术\n\n## 7. 参考资料\n\n- [A Survey on Hallucination in Large Language Models](https://arxiv.org/abs/2311.05232)\n- [SelfCheckGPT](https://arxiv.org/abs/2303.08896)"
    },
    {
      "id": "llm-finetuning",
      "title": "大模型微调（LoRA / Prompt-Tuning）",
      "category": "大模型应用",
      "status": "learned",
      "tags": [
        "微调",
        "LoRA",
        "PEFT",
        "SFT",
        "GLM"
      ],
      "links": [
        "pytorch-basics",
        "bert-series",
        "vllm-deployment"
      ],
      "sources": [
        "[LoRA 论文（Hu et al., 2021）](https://arxiv.org/abs/2106.09685)",
        "[QLoRA 论文](https://arxiv.org/abs/2305.14314)",
        "[HuggingFace PEFT 文档](https://huggingface.co/docs/peft)",
        "[LLaMA-Factory（一站式微调框架）](https://github.com/hiyouga/LLaMA-Factory)"
      ],
      "file": "notes/02-llm-app/llm-finetuning.md",
      "updatedAt": "2026-10-20",
      "content": "# 大模型微调（LoRA / Prompt-Tuning）\n\n> **一句话**：微调 = 用领域数据继续训练大模型，让它学会**行为与领域语言**（不等于记住知识）。全参微调太贵，PEFT（参数高效微调）只训练极少量新增参数：LoRA 给权重矩阵挂低秩旁路，Prompt-Tuning 学一段\"软提示\"。简历场景：基于 GLM-4-9B 做 LoRA 微调训练政策垂类小模型，用于政策分类与信息提取。\n\n## 1. 三种路线对比\n\n| 路线 | 训练参数量 | 显存（7B~9B 级） | 适用 |\n|---|---|---|---|\n| 全参微调（Full FT） | 100% | 极高（多卡 + 深度优化） | 预算充足、行为重塑需求强 |\n| LoRA（及其变体） | <1%（新增旁路） | 单卡可跑（QLoRA 更低） | 大多数垂域任务的主力选择 |\n| Prompt/Prefix/P-Tuning | ~0.01%（软提示向量） | 最低 | 超大模型、任务风格迁移 |\n\n## 2. LoRA 原理（必考）\n\n- 核心假设：微调引起的权重变化量 ΔW 是**低秩**的；\n- 做法：冻结原权重 W，训练一个旁路 `W' = W + BA`，其中 B∈R^(d×r)、A∈R^(r×k)，秩 r 常取 8/16/64 —— 只训练 BA，参数量骤降两个数量级；\n- 推理时可把 BA 合并回 W（**零额外推理延迟**）；\n- 关键超参：`r`（容量）、`alpha`（缩放）、作用于哪些模块（q/k/v/o 投影，后期实践常一并作用于 FFN）；\n- **QLoRA**：基座 4bit 量化加载（NF4）+ LoRA，单张消费级显卡微调大模型成为可能。\n\n## 3. Prompt-Tuning / P-Tuning v2（简历技能点）\n\n- **Prompt-Tuning**：在输入 embedding 前拼接一小段**可学习的连续向量**（软提示），冻结模型全部参数只训这段向量；\n- **Prefix-Tuning / P-Tuning v2**：把可学习向量加到**每一层** Transformer 的 KV 前面（不只是输入层），小模型上也有效；\n- 与\"提示词工程\"的本质区别：提示词是**人写的离散 token**，Prompt-Tuning 是**梯度学出来的连续向量**，不占用上下文窗口；\n- 经验：任务越需要\"改变知识/深水区行为\"，越需要 LoRA 级别；只是风格/格式适配，软提示够用。\n\n## 4. 微调 vs RAG vs 提示词（决策表，面试必问）\n\n| 需求 | 首选 |\n|---|---|\n| 知识频繁更新、要溯源引用 | RAG |\n| 私有大文本库问答 | RAG（+微调增强遵循） |\n| 输出风格/格式/术语体系固化 | 微调（LoRA） |\n| 领域抽取/分类任务要高精度低成本 | 微调垂类小模型 |\n| 快速验证、低成本试错 | 提示词工程 |\n| 组合拳 | 先 RAG+提示词，瓶颈在\"模型不会用材料/术语错\"时再 LoRA |\n\n## 5. 简历场景实操复盘（政策垂类模型）\n\n1. **数据构造**（最关键，占 70% 工作量）：政策分类样本 = 政策原文片段 + 标签体系（行业/规模/适用对象）；信息提取样本构造为指令格式 `{instruction, input, output}`；用大模型辅助造数 + 人工校验（正负样本均衡，含难例）；\n2. **训练**：GLM-4-9B + LoRA（LLaMA-Factory / PEFT），指令微调（SFT）范式，几轮 epoch、小学习率（1e-4 级）防过拟合；\n3. **评测**：留出集算分类 F1 / 抽取准确率，与\"大模型零样本 + 提示词\"基线对比，证明微调收益；\n4. **部署**：LoRA 合并权重后交 vLLM 部署（见 vllm-deployment 笔记）；\n5. **迭代**：badcase 回流 → 补数据 → 再训，形成闭环。\n\n## 6. 高频面试题\n\n1. LoRA 为什么有效？r 怎么选？（低秩假设；r=8/16 起步，任务复杂/数据多加大，看评测曲线）\n2. SFT 和 RLHF/DPO 的区别？（SFT 模仿示范；RLHF/DPO 基于偏好优化对齐）\n3. 微调数据多少条合适？（指令微调几百~几千条高质量样本常已显著有效，质量>>数量）\n4. 微调后模型通用能力下降（灾难性遗忘）怎么办？（混合通用数据、更小学习率、LoRA 天然缓解）\n\n## 7. 衍生学习\n\n- RLHF / DPO / GRPO 对齐技术\n- 微调框架横评：LLaMA-Factory vs Axolotl vs ms-swift\n- 数据工程：指令数据合成与去重\n\n## 8. 参考资料\n\n- [LoRA: Low-Rank Adaptation of Large Language Models](https://arxiv.org/abs/2106.09685)\n- [QLoRA](https://arxiv.org/abs/2305.14314)\n- [HuggingFace PEFT](https://huggingface.co/docs/peft)\n- [LLaMA-Factory](https://github.com/hiyouga/LLaMA-Factory)"
    },
    {
      "id": "prompt-engineering",
      "title": "提示词工程",
      "category": "大模型应用",
      "status": "learned",
      "tags": [
        "Prompt",
        "LLM",
        "提示词优化",
        "CoT"
      ],
      "links": [
        "function-call",
        "rag-vector-kb",
        "hallucination-mitigation",
        "agent-memory-personalization"
      ],
      "sources": [
        "[OpenAI Prompt Engineering 官方指南](https://platform.openai.com/docs/guides/prompt-engineering)",
        "[Anthropic Prompt Engineering 文档](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview)",
        "[Lilian Weng: Prompt Engineering（系统性综述博客）](https://lilianweng.github.io/posts/2023-03-15-prompt-engineering/)"
      ],
      "file": "notes/02-llm-app/prompt-engineering.md",
      "updatedAt": "2026-10-20",
      "content": "# 提示词工程（Prompt Engineering）\n\n> **一句话**：提示词工程 = 用结构化的方式把「角色、任务、上下文、约束、输出格式、示例」讲给模型听，并通过版本化管理和评测持续优化。它是大模型应用里**性价比最高的杠杆**——不动模型、不改架构，效果立竿见影。\n\n## 1. 一个好提示词的六要素\n\n```\n1. 角色（Role）      ：你是一个政务政策分析专家……\n2. 任务（Task）      ：判断企业是否符合政策申报条件\n3. 上下文（Context） ：{企业画像} + {政策原文}\n4. 约束（Rules）     ：只依据给定材料回答；不确定时输出\"无法判断\"\n5. 输出格式（Format）：JSON，字段为 {match: bool, reason: string}\n6. 示例（Examples）  ：给 1–3 个典型输入输出对（few-shot）\n```\n\n实战经验：\n- **system 与 user 分离**：稳定的行为约束放 system（前缀稳定还有利于 KV Cache 命中，参见关联节点「Manus 多步任务执行模式」），易变内容放 user；\n- **分隔符隔离外部内容**：检索到的文档、用户输入用 `<docs>...<\/docs>` 包起来，防止内容被当指令（提示注入）；\n- **输出格式用 JSON Schema / 结构化约束**，配合 Function Call 强约束最佳。\n\n## 2. 常用推理增强技巧\n\n| 技巧 | 做法 | 适用 |\n|---|---|---|\n| Zero-shot | 直接问 | 简单任务 |\n| Few-shot | 给几个示例 | 格式/风格要求高的任务（注意示例偏差，参考 Manus「避免 few-shot 陷阱」） |\n| CoT（思维链） | \"先一步步推理再给答案\" | 数学、多步逻辑 |\n| Self-Consistency | 采样多条推理路径取多数 | 提升复杂推理稳定性 |\n| 结构化分步 | 拆成「抽取→判断→总结」多次调用 | 长流程任务，每步可控可测 |\n\n## 3. 提示词压缩与提速（简历场景）\n\n教育平台项目中「多模型配置与提示词优化、压缩提升响应速度」的落点：\n- **语义等价压缩**：删除冗余客套与重复约束、合并同类规则、示例精简到最小必要集——输入 token 直接决定首字延迟与成本；\n- **前缀稳定**：system 部分固定不变，动态内容追加在后，命中 Prompt Caching（缓存命中约为未命中价格的 1/10）；\n- **分而治之**：长提示词拆成「小模型做格式化/抽取 + 大模型做核心推理」的分工，还能配合多模型路由降本。\n\n## 4. 提示词的工程化管理\n\n把提示词当代码管理，而不是字符串魔法：\n- **版本化**：提示词入库（配置/数据库），记录变更历史，可回滚；\n- **评测驱动**：固定一批测试样本（含边界 case），每次改动跑一遍对比（可配合 LLM-as-Judge 自动评分）；\n- **A/B 与灰度**：不同用户组用不同版本，看真实指标（解决率、采纳率）；\n- **参数联动**：temperature 分类任务调低（0~0.3）、生成任务调高（0.7+），与提示词一起管理。\n\n## 5. 高频面试题\n\n1. system prompt 和 user prompt 的区别？为什么要分离？（行为约束 vs 单次输入；缓存前缀）\n2. few-shot 示例越多越好吗？（不是；有偏差放大与成本问题，需要代表性而非数量）\n3. 提示词注入（prompt injection）怎么防？（分隔符+指令隔离、外部内容标记为数据、输出校验、最小权限工具）\n4. 提示词优化到什么程度该考虑微调？（格式/风格类收益大；知识与行为类收益递减时转 RAG/微调，见微调笔记的决策表）\n\n## 6. 衍生学习\n\n- 提示词自动优化（DSPy、APO）\n- 结构化输出与 JSON Mode / Constrained Decoding\n- 多模型提示词适配（同一任务不同模型的提示词差异）\n\n## 7. 参考资料\n\n- [OpenAI Prompt Engineering 官方指南](https://platform.openai.com/docs/guides/prompt-engineering)\n- [Anthropic Prompt Engineering 文档](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview)\n- [Lilian Weng: Prompt Engineering](https://lilianweng.github.io/posts/2023-03-15-prompt-engineering/)"
    },
    {
      "id": "rag-vector-kb",
      "title": "RAG 与向量知识库",
      "category": "大模型应用",
      "status": "learned",
      "tags": [
        "RAG",
        "向量检索",
        "Milvus",
        "Embedding",
        "知识库"
      ],
      "links": [
        "prompt-engineering",
        "text2sql-chatbi",
        "hallucination-mitigation"
      ],
      "sources": [
        "[RAG 原始论文（Lewis et al., 2020）](https://arxiv.org/abs/2005.11401)",
        "[Milvus 官方文档](https://milvus.io/docs)",
        "[Anthropic: Contextual Retrieval（上下文增强检索）](https://www.anthropic.com/news/contextual-retrieval)"
      ],
      "file": "notes/02-llm-app/rag-vector-kb.md",
      "updatedAt": "2026-10-20",
      "content": "# RAG 与向量知识库\n\n> **一句话**：RAG（Retrieval-Augmented Generation）= 先检索后生成——把私有知识/最新知识切块向量化存进向量库（如 Milvus），提问时检索最相关的片段塞进提示词，让模型**基于给定材料**回答。解决大模型三大痛点：知识过期、私有知识缺失、幻觉。\n\n## 1. 标准链路（五段式）\n\n```\n① 离线建库：文档解析(PDF/Word/网页) → 清洗 → 切分(Chunking) → Embedding 向量化 → 写入向量库(带元数据)\n② 在线检索：用户问题 → (可选:查询改写) → Embedding → 向量相似度检索 Top-K（+元数据过滤）\n③ 重排：Rerank 模型对候选精排，取 Top-N\n④ 生成：把片段拼进提示词，约束\"只依据材料回答 + 标注引用\"\n⑤ 反馈：点赞点踩回流，优化切分/检索策略\n```\n\n## 2. 向量库与检索基础\n\n- **Embedding**：文本 → 高维稠密向量（如 1024 维），语义相近则向量相近；相似度用内积/余弦（用 BGE、m3e、OpenAI text-embedding 等模型，政务/教育场景中文 BGE 系效果好）；\n- **ANN 索引**：向量库用近似最近邻索引（HNSW：图索引精度高内存大；IVF：聚类分桶快但召回略低）换检索速度；\n- **Milvus**（简历技能）：开源向量数据库，支持 Collection/Partition、标量字段过滤（`industry == \"制造\"` 这类**元数据过滤**，正是问数与政务场景的杀手锏）、多副本与分布式；\n- **混合检索**：向量（语义）+ BM25（关键词/术语/编号）+ 结构化过滤，三路召回合并——政策文号、专有名词靠纯向量容易漏。\n\n## 3. RAG 效果优化清单（面试核心弹药）\n\n| 环节 | 常见问题 | 优化手段 |\n|---|---|---|\n| 切分 | 切太碎丢上下文/太大检索不精 | 按标题层级切、512~1024 token、chunk 重叠 10~20%；Contextual Retrieval：给每个块用 LLM 生成一段\"它属于哪篇/哪章\"的上下文前缀再入库，检索失败率显著下降（Anthropic 实测） |\n| 检索 | 召回不准 | 查询改写（指代消解、口语→术语）、HyDE（先生成假设答案再检索）、混合检索 |\n| 过滤 | 跨范围命中 | 元数据过滤（部门/年份/密级/适用对象），简历中「知识库标签化」即此 |\n| 生成 | 检索对了答错 | 提示词强约束引用、片段编号溯源、答案与引用对齐校验 |\n| 结构化知识 | 多跳关系 | 知识图谱辅助检索（GraphRAG）：实体关系抽取建图，多跳查询走图、事实查询走向量 |\n| 评测 | 不知道好不好 | 构造评测集：检索命中率（Recall@K）+ 生成质量（忠实度/相关性），LLM-as-Judge 打分 |\n\n## 4. 简历场景对齐\n\n- 教育平台「知识图谱与知识库标签化辅助检索」：标签 = 元数据过滤维度（学科/学段/资源类型），知识图谱承接课程标准的多跳关系；\n- 风云平台「统一管理数据集与向量知识库」：知识库作为平台级资产，Collection 权限隔离 + 切分策略可配置；\n- 典型追问：**为什么用 RAG 而不是微调？**——知识频繁更新/需要溯源/数据量大且结构复杂 → RAG；要改变模型行为风格/领域术语理解 → 微调；两者常组合（微调让模型更会\"用\"检索材料）。详见微调笔记的决策表。\n\n## 5. 高频面试题\n\n1. RAG 与微调怎么选？（见上，决策表在 llm-finetuning）\n2. 检索召回率低怎么排查？（先分段评测：切分→召回→重排→生成，定位瓶颈再下药）\n3. 向量库选型？（Milvus 分布式/功能全；PGVector 轻量；ES 8 支持向量；看数据量与运维成本）\n4. chunk 大小怎么定？（实验驱动：512/1024 对比 + overlap，评测集说话）\n\n## 6. 衍生学习\n\n- GraphRAG（微软）与知识图谱融合检索\n- Rerank 模型（BGE-reranker、Cohere Rerank）\n- Agentic RAG：让 Agent 决定检索什么、检索几轮\n\n## 7. 参考资料\n\n- [RAG 原始论文](https://arxiv.org/abs/2005.11401)\n- [Milvus 官方文档](https://milvus.io/docs)\n- [Anthropic: Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval)"
    },
    {
      "id": "text2sql-chatbi",
      "title": "智能问数（Text2SQL / ChatBI）",
      "category": "大模型应用",
      "status": "learned",
      "tags": [
        "Text2SQL",
        "ChatBI",
        "NL2SQL",
        "元数据",
        "数据分析"
      ],
      "links": [
        "rag-vector-kb",
        "hallucination-mitigation"
      ],
      "sources": [
        "[Spider 基准（Text2SQL 评测）](https://yale-lily.github.io/spider)",
        "[DIN-SQL 论文（分解式 Text2SQL）](https://arxiv.org/abs/2304.11015)",
        "[BIRD 基准（更真实的 Text2SQL 评测）](https://bird-bench.github.io/)"
      ],
      "file": "notes/02-llm-app/text2sql-chatbi.md",
      "updatedAt": "2026-10-20",
      "content": "# 智能问数（Text2SQL / ChatBI）\n\n> **一句话**：智能问数 = 让业务人员用自然语言查数据库，核心是把问题翻译成正确的 SQL 再执行、解读。难点不在\"生成 SQL 语法\"，而在**让模型知道库里有什么、字段是什么意思、值长什么样**——所以简历里「基于元数据优化问数场景」正中要害：Schema 元数据 + 值检索 + 校验兜底，是抑制问数幻觉的三板斧。\n\n## 1. 标准链路\n\n```\n用户问题：\"上季度苏州制造业企业拿了多少补贴？\"\n   ▼\n① 意图识别与澄清：是查数还是闲聊？口径模糊就反问（\"上季度\"指自然季度？）\n   ▼\n② Schema Linking（关键步骤）：从几百张表中召回相关表/字段（元数据检索）\n   ▼\n③ SQL 生成：模型基于\"相关 schema + 字段注释 + few-shot 示例\"生成 SQL\n   ▼\n④ 校验与执行：语法检查 / EXPLAIN / 只读执行；失败把报错回传让模型改写重试\n   ▼\n⑤ 结果解读与可视化：数字 + 结论 + 图表（ChatBI 形态）\n```\n\n## 2. 元数据驱动的优化（简历核心点展开）\n\n| 优化点 | 做法 |\n|---|---|\n| 表/字段语义层 | 每张表每列写**业务注释**（\"subsidy_amt：企业实际到账补贴，万元\"），指标定义口径（GMV 算不算退款）沉淀为指标字典 |\n| Schema 召回 | 表多时不全塞给模型：把表名+注释+样例做向量化，按问题召回 Top-K 相关表再生成（本质是 RAG 思路用于 schema） |\n| 值检索（Value Retrieval） | 条件值模糊（\"高端制造\"到底库里存什么）→ 对枚举列建值索引/向量，先检索出规范值再填进 SQL，避免 LIKE 瞎猜 |\n|few-shot 示例库 | 高频问题与标准 SQL 配对入库，相似问题检索后作示例注入 |\n| 多轮改写 | 追问（\"那再按行业分呢\"）先做指代消解与上下文合并，改写成独立完整问题 |\n| 权限与安全 | 只读账号、行级权限过滤、SQL 白名单校验（禁 DDL/DML、LIMIT 强制） |\n\n## 3. 幻觉抑制三板斧（问数场景特化）\n\n1. **事前**：元数据充分（模型不猜字段）、值先检索（模型不猜值）、示例对齐口径；\n2. **事中**：低 temperature、结构化输出约束 SQL 格式；\n3. **事后**：执行报错回传重试、结果合理性校验（行数/量级异常提示）、数字必须来自执行结果（禁止模型心算）——回答里每个数字都能对应某行查询结果，这是问数可信的底线。\n\n## 4. 技术演进与选型\n\n- 直接 Prompt → Schema 检索 + few-shot（当前工业主流）→ DIN-SQL 类分步分解（schema linking → 分类 → 生成 → 修正）→ Agent 化（多表多跳自动拆解、工具调用执行）；\n- 垂类小模型路线：微调一个 Text2SQL 专用模型（成本低、格式稳定），配合大模型做意图与解读；\n- ChatBI 增量能力：图表类型选择、指标口径对齐、同环比计算表达。\n\n## 5. 高频面试题\n\n1. 问数准确率低的主要瓶颈？（不是 SQL 语法，是 schema/值/口径的语义对齐——元数据工程）\n2. 几百张表怎么办？（schema 召回：注释向量化检索 Top-K 相关表）\n3. 生成的 SQL 有注入/破坏风险？（只读权限、白名单解析、LIMIT/超时强制）\n4. 多轮追问怎么处理？（query 改写：指代消解 + 上下文合并成独立问题）\n\n## 6. 衍生学习\n\n- ChatBI 产品形态（帆软 ChatBI、Quick BI 智能问数）\n- 语义层（Semantic Layer）/ 指标平台（Headless BI）\n- Agent 化多跳问数（自动 join 图谱、任务分解）\n\n## 7. 参考资料\n\n- [Spider: Yale Text2SQL Benchmark](https://yale-lily.github.io/spider)\n- [DIN-SQL: Decomposed In-Context Learning of Text-to-SQL](https://arxiv.org/abs/2304.11015)\n- [BIRD Benchmark](https://bird-bench.github.io/)"
    },
    {
      "id": "vllm-deployment",
      "title": "模型部署与推理服务（vLLM）",
      "category": "大模型应用",
      "status": "learned",
      "tags": [
        "vLLM",
        "推理优化",
        "PagedAttention",
        "量化",
        "部署"
      ],
      "links": [
        "llm-finetuning"
      ],
      "sources": [
        "[vLLM 官方文档](https://docs.vllm.ai/)",
        "[PagedAttention 论文（vLLM 核心）](https://arxiv.org/abs/2309.06180)"
      ],
      "file": "notes/02-llm-app/vllm-deployment.md",
      "updatedAt": "2026-10-20",
      "content": "# 模型部署与推理服务（vLLM）\n\n> **一句话**：vLLM 是当前最主流的开源 LLM 推理引擎，两大杀手锏——**PagedAttention**（把 KV Cache 像操作系统内存页一样分页管理，显存利用率大幅提升）和 **Continuous Batching**（请求随到随拼批，吞吐数倍提升）。简历场景：基于 vLLM 完成内网 Qwen-32B / Qwen-235B / GLM-5.1/5.3 及向量化模型的部署与调优。\n\n## 1. 为什么推理服务是个\"显存游戏\"\n\n- 生成是**逐 token** 的自回归过程，每个请求的历史 K/V 都要缓存（KV Cache）——序列越长缓存越大；\n- 传统做法给每个请求预留连续最大长度显存 → 大量浪费（内部/外部碎片）；vLLM 借操作系统**分页**思想按块分配，几乎消除碎片，同等显存可并发更多请求（论文：吞吐 2~4 倍于 naive 方案）；\n- KV Cache 与模型权重抢显存：`可用 KV 显存 ≈ 总显存 − 权重 − 激活值`，这是调优的核心公式。\n\n## 2. vLLM 关键机制\n\n| 机制 | 一句话理解 |\n|---|---|\n| PagedAttention | KV Cache 分页管理，逻辑连续物理离散，消除浪费 |\n| Continuous Batching | 迭代级调度：短请求完成即出队、新请求随时入批，GPU 不空转 |\n| Prefix Caching | 相同前缀（system prompt/多轮历史）的 KV 直接复用，TTFT 大降（与 Agent 场景天然契合，呼应 Manus 的缓存哲学） |\n| Tensor Parallel | 权重按张量切分到多卡并行（大模型单卡放不下必用，如 235B 级别） |\n| OpenAI 兼容 API | 起服务即是 `/v1/chat/completions` 标准接口，业务零改造切换模型 |\n| Embedding 服务 | vLLM 也能托管 BGE 等向量化模型，RAG 检索与生成同栈部署 |\n\n## 3. 部署与调优实战要点（简历场景对齐）\n\n```bash\n# 典型启动：内网离线部署 Qwen-32B，双卡张量并行\nvllm serve Qwen/Qwen2.5-32B-Instruct \\\n  --tensor-parallel-size 2 \\\n  --gpu-memory-utilization 0.90 \\\n  --max-model-len 32768 \\\n  --enable-prefix-caching\n```\n\n- **`gpu-memory-utilization`**：留给 KV Cache 的比例，0.85~0.95 常见；太高会 OOM，太低浪费并发；\n- **`max-model-len`**：按业务最长输入输出设置，不必跟满模型上限（直接决定 KV 预留上限）；\n- **量化部署**：显存不够时 AWQ/GPTQ 4bit（精度小幅下降、显存近半）；A100/H100 可试 FP8；\n- **调优抓手**：看三个指标——吞吐（tokens/s）、首字延迟 TTFT、并发数；压测工具 `vllm bench serve` 或自建并发脚本；\n- **内网/政务环境**：模型权重离线导入、无外网依赖、多模型多实例统一路由（配合平台的模型管理与配置功能），算力服务器资源审核（利用率/排队）也是交付内容；\n- **多模型并存**：大模型（对话/生成）+ 小模型（分类/抽取，微调产物）+ 向量化模型（RAG）三类各起服务，按场景路由——这正是\"多模型配置\"的底层形态。\n\n## 4. 生态位对比（一句话版）\n\n- **vLLM**：吞吐/生态标杆，PagedAttention；\n- **SGLang**：RadixAttention 前缀复用更强，Agent 多轮场景有优势；\n- **llama.cpp / Ollama**：CPU/消费级显卡本地跑，轻量开发用；\n- **TensorRT-LLM**：NVIDIA 官方，极限性能但工程门槛高。\n\n## 5. 高频面试题\n\n1. PagedAttention 解决什么问题？（KV Cache 显存碎片与浪费，提升并发吞吐）\n2. TTFT 和吞吐怎么权衡？（并发 batch 越大吞吐越高但首字延迟升；prefix caching/较短 max-len 优化 TTFT）\n3. 部署 32B 模型至少要什么资源？（FP16 权重约 64GB → 2×48G 或 4×24G 卡 + KV 余量；量化可减半）\n4. QPS 上不去排查顺序？（先看 GPU 利用率→是否排队→max-model-len/并发参数→量化或扩容）\n\n## 6. 衍生学习\n\n- 推理量化原理（GPTQ/AWQ/FP8）\n- 投机解码（Speculative Decoding）\n- SGLang / TensorRT-LLM 深入对比\n\n## 7. 参考资料\n\n- [vLLM 官方文档](https://docs.vllm.ai/)\n- [Efficient Memory Management for LLM Serving with PagedAttention](https://arxiv.org/abs/2309.06180)"
    },
    {
      "id": "bert-series",
      "title": "BERT 原理与文本分类",
      "category": "NLP 算法",
      "status": "learned",
      "tags": [
        "BERT",
        "Transformer",
        "文本分类",
        "MLM",
        "微调"
      ],
      "links": [
        "word-embedding",
        "llm-finetuning",
        "hanlp-text-analysis"
      ],
      "sources": [
        "[BERT 原始论文（Devlin et al., 2018）](https://arxiv.org/abs/1810.04805)",
        "[RoBERTa 论文](https://arxiv.org/abs/1907.11692)",
        "[HuggingFace Transformers 文档](https://huggingface.co/docs/transformers)"
      ],
      "file": "notes/03-nlp/bert-series.md",
      "updatedAt": "2026-10-20",
      "content": "# BERT 原理与文本分类\n\n> **一句话**：BERT = Transformer 的 **Encoder** 堆叠 + **双向**预训练（完形填空 MLM），预训练完再在下游任务上微调，是判别式 NLP 任务（分类/抽取/匹配）的经典基座。简历场景：政策匹配核心链路中用 **BERT 分类器**做政策文本分类——今天在 LLM 时代它依然是低成本高精度的垂类打分器。\n\n## 1. 核心原理（面试必背）\n\n- **结构**：多层 Transformer Encoder（Base 12 层/110M，Large 24 层/340M），双向注意力——每个 token 能同时看到左右文；\n- **预训练两个任务**：\n  - **MLM（Masked Language Model）**：随机遮 15% 的 token 让模型还原（完形填空）——学到双向上下文表示；\n  - **NSP（Next Sentence Prediction）**：判断两句是否相邻（RoBERTa 证明其没用并去掉）；\n- **输入表示**：token embedding + position embedding + segment embedding；句首插 `[CLS]`；\n- **GPT 是_decoder（从左到右生成），BERT 是 encoder（双向理解）**——一个擅长写，一个擅长\"读懂\"，这是 LLM 与 BERT 的分工根源。\n\n## 2. 下游任务微调（政策分类实战）\n\n```\n[CLS] 政策文本...  →  取 [CLS] 的输出向量  →  接一个线性分类头  →  softmax 多分类\n```\n\n- 微调三件套：分类头随机初始化、**小学习率**（2e-5 ~ 5e-5，比预训练小几个量级）、1~4 个 epoch（过拟合很快）；\n- 数据量：每类几百条即可有不错效果（这正是它对 LLM 的成本优势：推理毫秒级、单卡可跑几十 QPS）；\n- 实用细节：类别不均衡用加权损失/过采样；长文本滑窗或关键段抽取；`hfl/chinese-roberta-wwm-ext` 是中文任务常用基座（全词遮蔽）。\n\n## 3. 家族演进（一句话版）\n\n| 模型 | 一句话改进 |\n|---|---|\n| RoBERTa | 去 NSP、更大 batch 更多数据、动态 masking |\n| ALBERT | 参数共享瘦身 |\n| DistilBERT | 蒸馏小模型，快 60% |\n| MacBERT / ERNIE（百度） | 中文语料与 masking 策略优化 |\n| DeBERTa | 解耦注意力，效果更强 |\n\n## 4. BERT vs LLM（垂类任务怎么选，高频题）\n\n| 维度 | BERT 微调 | LLM（提示/微调） |\n|---|---|---|\n| 分类/抽取精度 | 小数据下稳、高 | 数据少时靠提示，LoRA 后可比 |\n| 推理成本 | 毫秒级、单卡高并发 | 秒级、显存高 |\n| 泛化/生成/指令 | 不行 | 行 |\n| 可解释上线周期 | 需训练+部署 | 提示词即可上线 |\n\n- 简历链路的正确姿势（2021→2024 演进）：HanLP 抽要素 + BERT 分类器 → 2024 年用 GLM-4-9B LoRA 微调替代升级，**两者并存**：高并发打分用小模型，复杂理解用 LLM——面试讲清\"为什么这么演进\"就是加分项。\n\n## 5. 高频面试题\n\n1. 为什么 BERT 用 MLM 而不是 GPT 式自回归？（要双向理解；代价是不能直接做生成）\n2. [CLS] 为什么能代表整句？（预训练+微调把分类语义\"压\"进 CLS 位置）\n3. BERT 微调为什么学习率要很小？（预训练权重已很好，大步会破坏表示，灾难性遗忘）\n\n## 6. 衍生学习\n\n- Transformer 结构细节（注意力公式推导，见 PyTorch 笔记）\n- 蒸馏与量化让 BERT 更快（TinyBERT、INT8）\n- 对比学习句向量（SimCSE）\n\n## 7. 参考资料\n\n- [BERT: Pre-training of Deep Bidirectional Transformers](https://arxiv.org/abs/1810.04805)\n- [RoBERTa](https://arxiv.org/abs/1907.11692)\n- [HuggingFace Transformers](https://huggingface.co/docs/transformers)"
    },
    {
      "id": "hanlp-text-analysis",
      "title": "HanLP 与中文语法语义分析（政策匹配链路）",
      "category": "NLP 算法",
      "status": "learned",
      "tags": [
        "HanLP",
        "中文NLP",
        "NER",
        "依存句法",
        "政策匹配"
      ],
      "links": [
        "word-embedding",
        "bert-series"
      ],
      "sources": [
        "[HanLP GitHub（hankcs/HanLP）](https://github.com/hankcs/HanLP)",
        "[HanLP 官网与文档](https://www.hanlp.com/)"
      ],
      "file": "notes/03-nlp/hanlp-text-analysis.md",
      "updatedAt": "2026-10-20",
      "content": "# HanLP 与中文语法语义分析（政策匹配链路）\n\n> **一句话**：HanLP 是国产中文 NLP 工具包，一行代码拿到分词/词性/命名实体/依存句法/关键词等全套分析能力。简历场景：**政策计算器核心算法**——基于 HanLP 语法语义分析把非结构化政策文本拆成结构化要素（条件→对象→支持内容），再与企业画像做规则匹配。这是\"传统 NLP 工程 + 业务规则\"的经典落地，面试要能讲清整条链路。\n\n## 1. HanLP 能力地图\n\n| 能力 | 输出示例（政策文本场景） |\n|---|---|\n| 分词 + 词性标注 | 对/苏州工业园区/注册/的/制造业/企业/给予/补贴 |\n| 命名实体识别（NER） | 地点=苏州工业园区、金额=200万元、行业=制造业 |\n| 依存句法分析 | \"给予\"←核心动词；\"企业\"是对象；\"补贴\"是内容 |\n| 关键词/摘要提取 | 政策主题词抽取 |\n| 语义角色标注（SRL） | 施事/受事/条件 等论元结构 |\n\n版本：HanLP 1.x 经典版（Java/统计模型+词典，工业稳定）→ HanLP 2.x（深度学习/Torch，精度更高）——简历链路用 1.x 起家、2.x 升级都合理。\n\n## 2. 政策匹配核心链路（简历项目完整展开）\n\n```\n政策原文（数千条）                     企业画像（工商/税务/资质数据）\n    │                                     │\n    ▼ HanLP 分析                          ▼ 结构化标签（自动化标签体系）\n① 分词+NER：抽实体（区域/行业/规模/成立年限/资质/金额）\n    ▼\n② 依存句法+规则：识别条件结构\n   \"对【注册在园区的】(条件)【制造业企业】(对象)【给予最高200万补贴】(支持内容)\"\n    ▼\n③ 要素入库：政策 → 结构化规则（条件表达式 + 标签体系）\n    ▼\n④ 匹配计算：企业标签 vs 政策条件（规则引擎 + 腾讯词向量语义相似度兜底模糊匹配）\n    ▼\n⑤ 排序输出：可申报政策列表 + 匹配理由（每条可解释）\n```\n\n关键设计点：\n- **自动化标签体系**：政策侧与企业侧用同一套标签本体（行业/规模/区域/资质），匹配才有共同语言——这是\"政策计算器\"的真正地基；\n- **语义兜底**：字面不等但语义相近的匹配（\"智能制造\"≈\"高端装备\"）用词向量相似度补规则之 rigid；\n- **可解释性**：输出\"为什么匹配\"（命中了哪些条件），政务交付刚需；\n- 演进（简历原话）：2024 年基于 GLM-4-9B LoRA 微调做政策分类与信息提取，把 ②③ 步升级为模型化抽取——**规则时代可解释、模型时代泛化强**，两者结合（模型抽 + 规则校验）是当前最优解。\n\n## 3. 传统 NLP 工具横向认知\n\n- HanLP vs jieba：jieba 只有分词（轻量）；HanLP 全家桶（句法语义深）；\n- vs LLM 抽取：LLM 少样本即可定义新抽取消任务，但高并发场景成本高；HanLP/小模型毫秒级——生产上常见\"LLM 冷启动造标注数据 → 小模型/BERT 上线\"。\n\n## 4. 高频面试题\n\n1. 政策匹配怎么处理\"模糊表述\"？（词向量语义相似度 + 人工确认阈值带 + 标签体系归一）\n2. 为什么不直接用大模型抽取全部政策？（成本/时延/批量吞吐 + 可控性；但可用它做数据增强与冷启动）\n3. NER 效果不好怎么优化？（领域词典注入、领域标注微调、规则后处理、错误分析回流）\n\n## 5. 衍生学习\n\n- 依存句法与语义角色标注深入\n- 信息抽取（UIE / 命名实体识别微调）\n- 规则引擎（Drools 类）与标签体系设计\n\n## 6. 参考资料\n\n- [hankcs/HanLP](https://github.com/hankcs/HanLP)\n- [HanLP 官网](https://www.hanlp.com/)"
    },
    {
      "id": "word-embedding",
      "title": "词向量（word2vec / GloVe / 腾讯词向量）",
      "category": "NLP 算法",
      "status": "learned",
      "tags": [
        "词向量",
        "word2vec",
        "GloVe",
        "相似度召回",
        "嵌入"
      ],
      "links": [
        "bert-series",
        "hanlp-text-analysis",
        "rag-vector-kb"
      ],
      "sources": [
        "[word2vec 论文（Mikolov et al., 2013）](https://arxiv.org/abs/1301.3781)",
        "[GloVe 项目页（Stanford）](https://nlp.stanford.edu/projects/glove/)",
        "[腾讯 AI Lab 词向量](https://ai.tencent.com/ailab/nlp/en/embedding.html)"
      ],
      "file": "notes/03-nlp/word-embedding.md",
      "updatedAt": "2026-10-20",
      "content": "# 词向量（word2vec / GloVe / 腾讯词向量）\n\n> **一句话**：词向量把词映射成稠密向量，且**语义相近则向量相近**（国王−男人+女人≈女王），是深度 NLP 的起点。简历场景：政策匹配链路用**腾讯开源词向量**（800 万+中文词/短语，大规模语料训练）做语义相似度与召回——它与今天的 Embedding 模型（RAG 里的向量化）一脉相承，面试正好讲清这条演化线。\n\n## 1. word2vec（2013，必考）\n\n两种训练结构、一个加速技巧：\n- **CBOW**：上下文词预测中心词；**Skip-gram**：中心词预测上下文（小数据高频词 CBOW 好，生僻词/效果 Skip-gram 好）；\n- **负采样（Negative Sampling）**：不做全词表 softmax，正例 + 随机抽几个负例做二分类——训练飞快（还有层次 softmax 方案）；\n- 本质：**共现规律 → 语义几何结构**，\"一个词的含义由它的上下文决定\"（分布式假说）。\n\n## 2. GloVe 与 FastText\n\n- **GloVe**：先统计全局共现矩阵，再对共现做矩阵分解——全局统计（word2vec 是滑窗局部）；\n- **FastText**：词再拆**子词 n-gram** 向量相加 → 天然处理未登录词（OOV）与形态变化，中文生僻词/错别字场景好用。\n\n## 3. 腾讯 AI Lab 词向量（简历技能点）\n\n- 规模：800 万+中文词与短语（大词表覆盖领域名词）、200 维，基于大规模新闻/网页语料（Directional Skip-gram 考虑词序）；\n- 用法（政策匹配链路）：\n  - **语义召回**：企业描述与政策条款文本平均池化成句向量，余弦相似度粗排\"政策↔企业\"匹配；\n  - **近义扩展**：查询扩展（\"补贴\"≈\"资助/奖励/扶持\"）提升检索召回；\n  - **特征**：作为下游模型（BERT 前时代）的输入特征或词表对齐。\n\n## 4. 演化线（面试串讲，高分答法）\n\n```\n静态词向量（一个词一个向量）\n  word2vec/GloVe/腾讯词向量 → 简单高效，但\"苹果手机\"和\"吃苹果\"向量相同（一词多义无解）\n        ↓ 上下文相关表示\n动态表示（ELMo→BERT）\n  同一个词在不同句子里向量不同 → 一词多义解决\n        ↓\n现代 Embedding 模型（BGE/GTE/text-embedding，对比学习训练）\n  直接编码\"整段文本\"，服务 RAG 语义检索\n```\n\n- 一句话总结：从\"词级静态几何\"到\"段落级语义检索\"，词向量是 Embedding 思想的原点。\n\n## 5. 高频面试题\n\n1. word2vec 两种模式区别？负采样解决什么？（全词表 softmax 太慢 → 二分类化）\n2. 词向量的局限？（静态、一词多义；OOV——FastText 缓解）→ 引出上下文表示\n3. 怎么从词向量得到句向量？（平均池化/SIF 加权；现代做法直接用句向量模型）\n\n## 6. 衍生学习\n\n- 对比学习句向量（SimCSE、CoSENT）\n- 中文分词与词向量的关系（未登录词问题）\n- Embedding 模型训练（BGE 的做法）\n\n## 7. 参考资料\n\n- [Efficient Estimation of Word Representations in Vector Space](https://arxiv.org/abs/1301.3781)\n- [GloVe: Global Vectors for Word Representation](https://nlp.stanford.edu/projects/glove/)\n- [腾讯 AI Lab 中文词向量](https://ai.tencent.com/ailab/nlp/en/embedding.html)"
    },
    {
      "id": "pytorch-basics",
      "title": "PyTorch 核心基础",
      "category": "深度学习框架",
      "status": "learned",
      "tags": [
        "PyTorch",
        "Tensor",
        "autograd",
        "训练循环",
        "nn.Module"
      ],
      "links": [
        "llm-finetuning",
        "bert-series"
      ],
      "sources": [
        "[PyTorch 官方 Tutorials（60 Minute Blitz 起步）](https://pytorch.org/tutorials/)",
        "[HuggingFace Transformers（基于 PyTorch 生态）](https://huggingface.co/docs/transformers)"
      ],
      "file": "notes/04-dl-framework/pytorch-basics.md",
      "updatedAt": "2026-10-20",
      "content": "# PyTorch 核心基础\n\n> **一句话**：PyTorch = **Tensor（多维数组 + GPU 加速）+ autograd（自动微分）+ nn（神经网络组件）** 三件套，定义前向、自动求梯度、写个训练循环就能训模型。它是 BERT 微调、LoRA 微调、vLLM 生态的底层语言——简历里的微调实践全部站在它上面。\n\n## 1. 三大件\n\n```python\nimport torch\nimport torch.nn as nn\n\n# ① Tensor：像 NumPy，但能上 GPU、能追踪梯度\nx = torch.randn(32, 768, device=\"cuda\")          # batch=32, 特征=768\n\n# ② autograd：记录计算图，backward 自动算梯度\nw = nn.Linear(768, 2)                             # ③ nn.Module：可训练层的容器\n\nlogits = w(x)                                     # 前向\nloss = nn.functional.cross_entropy(logits, y)\nloss.backward()                                   # 反向：自动求 ∂loss/∂θ\noptimizer.step(); optimizer.zero_grad()           # 更新参数、清梯度\n```\n\n## 2. 万物皆此模板：标准训练循环（背下来）\n\n```python\nfor epoch in range(EPOCHS):\n    for xb, yb in DataLoader(dataset, batch_size=32, shuffle=True):\n        xb, yb = xb.to(device), yb.to(device)\n        pred = model(xb)            # 1. 前向\n        loss = loss_fn(pred, yb)    # 2. 算损失\n        optimizer.zero_grad()       # 3. 清旧梯度\n        loss.backward()             # 4. 反向传播\n        optimizer.step()            # 5. 更新权重\n    model.eval()                    # 评估模式（关 dropout/固定 BN）\n    with torch.no_grad():           # 评估不吃显存梯度\n        ...\n```\n\n- `model.train()` / `model.eval()`：切换 dropout、BatchNorm 行为（忘切是新手第一大 bug）；\n- `torch.no_grad()`：推理时不建计算图，省显存提速；\n- 混合精度（`autocast` + fp16）：大模型训练标配，显存减半速度翻倍。\n\n## 3. 微调场景直接相关的能力\n\n| 能力 | 在微调里的角色 |\n|---|---|\n| `nn.Parameter` / `requires_grad` | LoRA 的本质：冻结基座参数（requires_grad=False），只让旁路 BA 可训练 |\n| `state_dict()` | 保存/加载权重；LoRA 权重单独存取、合并（W += BA） |\n| DataLoader / Dataset | 构造指令微调样本流（instruction/input/output） |\n| `to(device)`、显存管理 | OOM 排查第一步：张量/模型都要上同一设备 |\n| HuggingFace transformers | 在 PyTorch 之上封装了 BERT/GLM 的加载与训练（AutoModelForSequenceClassification…），LoRA 用 PEFT 库一行挂旁路 |\n\n## 4. 与 TensorFlow 的一句话对比（面试常问）\n\nPyTorch 动态图（define-by-run，像写 Python）调试直观、研究界与开源模型生态（HuggingFace、vLLM、PEFT）几乎全在 PyTorch——这也是选它的现实理由；TF 静态图部署历史优势已随 ONNX/TorchScript、vLLM 生态淡化。\n\n## 5. 高频面试题\n\n1. backward 的原理？（前向记录计算图，反向沿图链式法则自动求导）\n2. `zero_grad` 为什么必须？（梯度默认累加，不清零会把上一 batch 的梯度加进来）\n3. train/eval 模式区别？（dropout 随机/关闭、BN 用 batch 统计/滑动平均）\n4. CUDA out of memory 怎么办？（减 batch、混合精度、梯度累积、量化、清理中间变量 del+empty_cache）\n\n## 6. 衍生学习\n\n- Transformer 的 PyTorch 手写实现（attention → encoder）\n- 分布式训练（DDP、DeepSpeed ZeRO）\n- torch.compile 与性能优化\n\n## 7. 参考资料\n\n- [PyTorch Tutorials](https://pytorch.org/tutorials/)\n- [HuggingFace Transformers](https://huggingface.co/docs/transformers)"
    }
  ],
  "edges": [
    {
      "source": "agent-memory-personalization",
      "target": "prompt-engineering"
    },
    {
      "source": "agent-memory-personalization",
      "target": "manus-multi-step-execution"
    },
    {
      "source": "agent-workflow-skill",
      "target": "openai-agent-sdk"
    },
    {
      "source": "agent-workflow-skill",
      "target": "genspark-search-agent"
    },
    {
      "source": "genspark-search-agent",
      "target": "manus-multi-step-execution"
    },
    {
      "source": "openai-agent-sdk",
      "target": "manus-multi-step-execution"
    },
    {
      "source": "openai-agent-sdk",
      "target": "genspark-search-agent"
    },
    {
      "source": "openai-agent-sdk",
      "target": "function-call"
    },
    {
      "source": "function-call",
      "target": "prompt-engineering"
    },
    {
      "source": "function-call",
      "target": "hallucination-mitigation"
    },
    {
      "source": "hallucination-mitigation",
      "target": "rag-vector-kb"
    },
    {
      "source": "hallucination-mitigation",
      "target": "text2sql-chatbi"
    },
    {
      "source": "llm-finetuning",
      "target": "pytorch-basics"
    },
    {
      "source": "llm-finetuning",
      "target": "bert-series"
    },
    {
      "source": "llm-finetuning",
      "target": "vllm-deployment"
    },
    {
      "source": "prompt-engineering",
      "target": "rag-vector-kb"
    },
    {
      "source": "prompt-engineering",
      "target": "hallucination-mitigation"
    },
    {
      "source": "rag-vector-kb",
      "target": "text2sql-chatbi"
    },
    {
      "source": "bert-series",
      "target": "word-embedding"
    },
    {
      "source": "bert-series",
      "target": "hanlp-text-analysis"
    },
    {
      "source": "hanlp-text-analysis",
      "target": "word-embedding"
    },
    {
      "source": "word-embedding",
      "target": "rag-vector-kb"
    },
    {
      "source": "pytorch-basics",
      "target": "bert-series"
    }
  ]
};
