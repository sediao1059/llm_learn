# 知识体系多维模型设计计划（v1）

> 背景：目前知识点只有两个维度——领域分类（category）+ 学习状态（status/个人掌握度 level）。随着知识点扩展到 38 个，二维不够用了：看不出知识在**技术栈中的位置**，也表达不出**学习顺序**。本文档定义多维模型与分期落地计划。

## 1. 维度模型总览

| 维度 | 字段 | 回答的问题 | 取值 | 状态 |
|---|---|---|---|---|
| A 领域分类 | `category` | 属于什么知识域 | Agent 系统 / 大模型应用 / NLP 算法 / 深度学习基础 | ✅ 已有（节点填充色） |
| B 技术层次 | `layer` | 在技术栈哪一层 | L1-算法底层 / L2-大模型底层 / L3-应用工程层 / L4-业务应用层 | ✅ 本期落地（分层视图） |
| C 学习状态 | `status` + `level` | 我学得怎么样 | 笔记：learned/todo；个人：0-3 掌握度 | ✅ 已有（虚线节点 / 外圈色） |
| D 学习路径 | `path`（规划） | 按什么顺序学 | 路线编号（如 transformer 主线 1.1/1.2/1.3） | 📋 规划中（见 §5） |

**正交性**：A 讲"域"，B 讲"层"，C 讲"人"，D 讲"序"——互不重复。例：`transformer-architecture` = NLP无关的深度学习基础（A）× L1 算法底层（B）× 已学·掌握（C）× 路径 1.2（D）。

## 2. 维度 B：技术层次定义（本期落地）

- **L1-算法底层**：与模型无关的地基——PyTorch、Transformer 原理/实现、BERT、词向量、对比学习句向量、模型压缩、信息抽取、HanLP
- **L2-大模型底层**：大模型本身的训练与推理机制——微调、RLHF/DPO、指令数据工程、分布式训练、KV Cache、vLLM、量化、投机解码、结构化输出
- **L3-应用工程层**：用大模型构建应用的通用技术——提示词、Function Call、MCP、RAG/GraphRAG/Agentic RAG、Rerank、幻觉抑制、Agent 范式/记忆/多 Agent/沙箱/评测
- **L4-业务应用层**：面向业务场景的完整方案与产品形态——Manus、Genspark、Agent 工作台（OpenAI Agent SDK）、工作流编排与 Skill、智能问数、Deep Research

分层规则：**按"离业务的距离"分层，不按难度**。一个知识点只属于一层（单选），层间由依赖关系（links）自然形成跨层连线。

## 3. 图谱交互设计

**本期已实现：**
1. **分层视图模式**：力导向 ↔ 分层 两键切换（记忆选择）；分层模式 L1 在底、L4 在顶，层内网格排布，左侧显示层名锚点；节点颜色仍为领域分类色（两个维度同屏可读：纵向=层，颜色=域）
2. **标签多选筛选**：顶栏标签条按频次展示全部标签，点击即选中（可多选，OR 命中），选中状态高亮保留并持久化到 localStorage，支持一键清除；与文本搜索叠加（AND）
3. 笔记面板与 tooltip 显示所属层次

**后续迭代（按优先级）：**
1. **着色维度切换**：节点颜色可切换为"领域色 / 层色 / 掌握度色"三模式（目前层用位置表达、掌握度用外圈表达，三色切换让任一维度都能一眼可读）
2. **学习路径线（维度 D）**：frontmatter 加 `path: 1.2` 与 `path-next`，图谱渲染主线箭头（如 PyTorch→Transformer→手写实现→BERT），并提供"路线图视图"（只看一条主线）
3. **层×域矩阵统计**：4×4 热力矩阵，每格显示该层该域的知识点数与平均掌握度，一眼看出知识版图缺口
4. **按层/按掌握度过滤**：与标签筛选并列的快捷过滤器（如"只看 L2 + 未学"）

## 4. 数据模型（frontmatter）

```yaml
category: 深度学习基础   # 维度 A（已有）
layer: L1-算法底层       # 维度 B（新增，单选，缺省=未分层）
status: learned          # 维度 C-笔记（已有）
# level 0-3 存 SQLite（维度 C-个人，已有）
# path: 1.2              # 维度 D（规划中）
```

迁移：`build.mjs` 自动解析 layer 并汇总 `DATA.layers`（按名称排序，L 前缀保证 L1→L4 顺序）；未标注的笔记归"未分层"并在构建时告警。

## 5. 维度 D：学习路径（规划草案）

主线示例（对应图谱建议学习主线）：
1. 打底线：pytorch-basics(1.1) → transformer-architecture(1.2) → transformer-implementation(1.3) → bert-series(1.4)
2. 训练线：llm-finetuning(2.1) → rlhf-dpo(2.2) → instruction-data-engineering(2.3) → distributed-training(2.4)
3. 应用线：rag-vector-kb(3.1) → graphrag(3.2) → rerank-models(3.3) → agentic-rag(3.4)
4. 推理线：kv-cache-long-context(4.1) → vllm-deployment(4.2) → llm-quantization(4.3) → speculative-decoding(4.4)
5. Agent 线：agent-paradigms(5.1) → multi-agent-patterns(5.2) → mcp-protocol(5.3) → agent-sandbox-security(5.4) → agent-evaluation(5.5)

实现形态：path 主线渲染为带箭头的虚线路径 + 路线图视图（隐藏非主线节点）。**待确认后再实现。**
