---
id: text2sql-chatbi
title: 智能问数（Text2SQL / ChatBI）
category: 大模型应用
tags: [Text2SQL, ChatBI, NL2SQL, 元数据, 数据分析]
status: learned
links: [rag-vector-kb, hallucination-mitigation]
sources:
  - [Spider 基准（Text2SQL 评测）](https://yale-lily.github.io/spider)
  - [DIN-SQL 论文（分解式 Text2SQL）](https://arxiv.org/abs/2304.11015)
  - [BIRD 基准（更真实的 Text2SQL 评测）](https://bird-bench.github.io/)
---

# 智能问数（Text2SQL / ChatBI）

> **一句话**：智能问数 = 让业务人员用自然语言查数据库，核心是把问题翻译成正确的 SQL 再执行、解读。难点不在"生成 SQL 语法"，而在**让模型知道库里有什么、字段是什么意思、值长什么样**——所以简历里「基于元数据优化问数场景」正中要害：Schema 元数据 + 值检索 + 校验兜底，是抑制问数幻觉的三板斧。

## 1. 标准链路

```
用户问题："上季度苏州制造业企业拿了多少补贴？"
   ▼
① 意图识别与澄清：是查数还是闲聊？口径模糊就反问（"上季度"指自然季度？）
   ▼
② Schema Linking（关键步骤）：从几百张表中召回相关表/字段（元数据检索）
   ▼
③ SQL 生成：模型基于"相关 schema + 字段注释 + few-shot 示例"生成 SQL
   ▼
④ 校验与执行：语法检查 / EXPLAIN / 只读执行；失败把报错回传让模型改写重试
   ▼
⑤ 结果解读与可视化：数字 + 结论 + 图表（ChatBI 形态）
```

## 2. 元数据驱动的优化（简历核心点展开）

| 优化点 | 做法 |
|---|---|
| 表/字段语义层 | 每张表每列写**业务注释**（"subsidy_amt：企业实际到账补贴，万元"），指标定义口径（GMV 算不算退款）沉淀为指标字典 |
| Schema 召回 | 表多时不全塞给模型：把表名+注释+样例做向量化，按问题召回 Top-K 相关表再生成（本质是 RAG 思路用于 schema） |
| 值检索（Value Retrieval） | 条件值模糊（"高端制造"到底库里存什么）→ 对枚举列建值索引/向量，先检索出规范值再填进 SQL，避免 LIKE 瞎猜 |
|few-shot 示例库 | 高频问题与标准 SQL 配对入库，相似问题检索后作示例注入 |
| 多轮改写 | 追问（"那再按行业分呢"）先做指代消解与上下文合并，改写成独立完整问题 |
| 权限与安全 | 只读账号、行级权限过滤、SQL 白名单校验（禁 DDL/DML、LIMIT 强制） |

## 3. 幻觉抑制三板斧（问数场景特化）

1. **事前**：元数据充分（模型不猜字段）、值先检索（模型不猜值）、示例对齐口径；
2. **事中**：低 temperature、结构化输出约束 SQL 格式；
3. **事后**：执行报错回传重试、结果合理性校验（行数/量级异常提示）、数字必须来自执行结果（禁止模型心算）——回答里每个数字都能对应某行查询结果，这是问数可信的底线。

## 4. 技术演进与选型

- 直接 Prompt → Schema 检索 + few-shot（当前工业主流）→ DIN-SQL 类分步分解（schema linking → 分类 → 生成 → 修正）→ Agent 化（多表多跳自动拆解、工具调用执行）；
- 垂类小模型路线：微调一个 Text2SQL 专用模型（成本低、格式稳定），配合大模型做意图与解读；
- ChatBI 增量能力：图表类型选择、指标口径对齐、同环比计算表达。

## 5. 高频面试题

1. 问数准确率低的主要瓶颈？（不是 SQL 语法，是 schema/值/口径的语义对齐——元数据工程）
2. 几百张表怎么办？（schema 召回：注释向量化检索 Top-K 相关表）
3. 生成的 SQL 有注入/破坏风险？（只读权限、白名单解析、LIMIT/超时强制）
4. 多轮追问怎么处理？（query 改写：指代消解 + 上下文合并成独立问题）

## 6. 衍生学习

- ChatBI 产品形态（帆软 ChatBI、Quick BI 智能问数）
- 语义层（Semantic Layer）/ 指标平台（Headless BI）
- Agent 化多跳问数（自动 join 图谱、任务分解）

## 7. 参考资料

- [Spider: Yale Text2SQL Benchmark](https://yale-lily.github.io/spider)
- [DIN-SQL: Decomposed In-Context Learning of Text-to-SQL](https://arxiv.org/abs/2304.11015)
- [BIRD Benchmark](https://bird-bench.github.io/)
