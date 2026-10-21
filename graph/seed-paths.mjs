#!/usr/bin/env node
/**
 * 官方学习路线种子脚本（幂等，可重复执行）：
 *  - 5 个资源型「待学」节点（来自学习资源推荐文章、图谱中原本没有的主题）：huggingface / kaggle / langchain / lora / arxiv
 *  - 3 条官方学习路线（is_official=1，学习路线页置顶、可直接选择）：入门全景线 / 应用开发线 / 训练微调线
 * 路线条目尽量引用现有知识点；引用的资源主题挂新待学节点。
 * 新节点的分层挂靠无需处理：下次访问 /api/graph/tiers 时 ensureFresh 会自动补算。
 *
 * 用法：node seed-paths.mjs   （或 npm run seed-paths）
 */
import { initDb, closeDb, dbInfo } from './db.mjs';
import { initAi } from './ai.mjs';

const db = await initDb();
await initAi(db, {});
console.log(`数据库：${dbInfo()}`);

/* ---------- 1. 资源型待学节点（article 提到、图谱缺失的主题） ---------- */
const TODO_NODES = [
  {
    id: 'huggingface', title: 'Hugging Face 生态',
    intro: '大模型时代的"应用商店"：Transformers 库、模型与数据集托管（Hub）、在线体验 Spaces。学微调和部署基本绕不开它。',
    links: ['bert-series', 'llm-finetuning'], tags: ['HuggingFace', '模型库', 'Transformers']
  },
  {
    id: 'kaggle', title: 'Kaggle 数据竞赛',
    intro: '真实数据集 + 竞赛 + 别人的解题代码（Notebooks），是把学到的模型知识练成手感的最快途径之一。',
    links: ['pytorch-basics'], tags: ['Kaggle', '数据竞赛', '实践']
  },
  {
    id: 'langchain', title: 'LangChain 框架',
    intro: '最主流的大模型应用编排框架：把提示词、工具调用、检索、记忆串成链/Agent，快速搭原型。',
    links: ['rag-vector-kb', 'function-call'], tags: ['LangChain', '框架', '编排']
  },
  {
    id: 'lora', title: 'LoRA 低秩适配',
    intro: '只训练极少量低秩矩阵就能微调大模型的事实标准：显存省一个数量级，是平民微调的第一选择。',
    links: ['llm-finetuning', 'model-compression'], tags: ['LoRA', '微调', '低秩适配']
  },
  {
    id: 'arxiv', title: 'ArXiv 论文跟踪',
    intro: '大模型前沿论文的预印本平台；配合订阅与速读技巧，保持对新技术（发布当天就能读到）的敏感度。',
    links: ['deep-research-products'], tags: ['ArXiv', '论文', '前沿']
  }
];

for (const n of TODO_NODES) {
  const exists = await db.prepare('SELECT id FROM ai_nodes WHERE id = ?').get(n.id);
  if (exists) { console.log(`⏭  节点 ${n.id} 已存在`); continue; }
  await db.prepare(`INSERT INTO ai_nodes(id, title, category, layer, tags, status, content, links, created_by)
    VALUES (?, ?, '学习资源', '未分层', ?, 'todo', ?, ?, 'route-import')`)
    .run(n.id, n.title, JSON.stringify(n.tags),
      n.intro + '\n\n（该主题来自官方学习路线补种，待补充完整学习笔记；可点击向 AI 提问或上传知识来充实它。）',
      JSON.stringify(n.links));
  console.log(`✔  待学节点 ${n.id}《${n.title}》已补入图谱`);
}

/* ---------- 2. 官方学习路线 ---------- */
const ROUTES = [
  {
    title: '🌱 官方·大模型入门全景线（新手）',
    summary: '给零基础同学的一条主路：先打好编程与深度学习底子，再搞懂 Transformer，然后学会"用"大模型干活，最后融入生态持续学习。',
    stages: [
      { title: '阶段一·打好编程与深度学习底子', goal: '能看懂并跑通训练代码', items: [
        { title: 'PyTorch 基础', refId: 'pytorch-basics', why: '所有训练代码的地基，先会张量、自动求导和训练循环' },
        { title: '词向量入门', refId: 'word-embedding', why: '理解"文字如何变成数字"，是理解一切 NLP 模型的第一步' },
        { title: 'Kaggle 数据竞赛', refId: 'kaggle', why: '用真实数据集练手感，还能偷学别人的解题代码' }
      ] },
      { title: '阶段二·搞懂大模型的心脏 Transformer', goal: '能向别人讲清楚注意力机制', items: [
        { title: 'Transformer 架构', refId: 'transformer-architecture', why: 'GPT/BERT 共同的底座，面试必考' },
        { title: 'BERT 系列', refId: 'bert-series', why: '看 encoder 范式怎么理解语言，理解双向 vs 单向' },
        { title: '手写 Transformer', refId: 'transformer-implementation', why: '亲手写一遍，比看十遍文章都记得牢' }
      ] },
      { title: '阶段三·会用大模型干活', goal: '能独立搭一个问答小应用', items: [
        { title: '提示词工程', refId: 'prompt-engineering', why: '用好大模型的第一生产力，成本最低收益最大' },
        { title: '结构化输出', refId: 'structured-output', why: '让模型输出能被程序解析的 JSON，接业务系统的前提' },
        { title: 'Function Call', refId: 'function-call', why: '让模型调用你的函数，从"聊天"变成"干活"' },
        { title: 'RAG 入门', refId: 'rag-vector-kb', why: '让模型回答你自己的知识，企业落地第一场景' }
      ] },
      { title: '阶段四·融入生态与持续学习', goal: '知道去哪找模型、找论文、防幻觉', items: [
        { title: 'Hugging Face 生态', refId: 'huggingface', why: '模型与数据集的"应用商店"，微调部署都靠它' },
        { title: 'ArXiv 论文跟踪', refId: 'arxiv', why: '保持前沿敏感度，新东西发布当天就能读到' },
        { title: '幻觉与缓解', refId: 'hallucination-mitigation', why: '知道模型会一本正经地胡说、怎么防，少踩坑' }
      ] }
    ]
  },
  {
    title: '🛠️ 官方·大模型应用开发线',
    summary: '面向要落地应用的开发者：从提示词与输出控制，到 RAG 全家桶、编排框架，最后是 Agent 与评测。',
    stages: [
      { title: '阶段一·提示词与输出控制', goal: '稳定拿到可控输出', items: [
        { title: '提示词工程', refId: 'prompt-engineering', why: '一切应用的基本功' },
        { title: '结构化输出', refId: 'structured-output', why: '业务对接的前提' },
        { title: '自动提示优化', refId: 'prompt-optimization-auto', why: '让提示词本身可迭代、可评测' }
      ] },
      { title: '阶段二·RAG 检索增强全家桶', goal: '能搭生产级检索问答', items: [
        { title: 'RAG 与向量知识库', refId: 'rag-vector-kb', why: '主框架：切分、向量化、召回、生成' },
        { title: '重排模型', refId: 'rerank-models', why: '召回后精排，准确率提升的关键一跳' },
        { title: 'GraphRAG', refId: 'graphrag', why: '知识图谱融合检索，处理多跳复杂问题' },
        { title: 'Agentic RAG', refId: 'agentic-rag', why: '让 Agent 决定检索什么、检索几轮' }
      ] },
      { title: '阶段三·框架与工具编排', goal: '会用主流框架攒应用', items: [
        { title: 'LangChain 框架', refId: 'langchain', why: '最主流的应用编排框架，原型速度最快' },
        { title: 'Function Call', refId: 'function-call', why: '工具调用的底层机制，框架都建在它上面' },
        { title: 'MCP 协议', refId: 'mcp-protocol', why: '工具接入的标准化协议，生态正在快速统一' }
      ] },
      { title: '阶段四·Agent 与评测', goal: '做出可靠的多步系统', items: [
        { title: 'Agent 范式', refId: 'agent-paradigms', why: '理解 ReAct/Plan 等主流范式再动手' },
        { title: '多智能体模式', refId: 'multi-agent-patterns', why: '复杂任务拆给多个角色协作' },
        { title: 'Agent 评测', refId: 'agent-evaluation', why: '没有评测就没有优化方向' },
        { title: '沙箱与安全', refId: 'agent-sandbox-security', why: '放权给 Agent 前先关好笼子' }
      ] }
    ]
  },
  {
    title: '🏋️ 官方·训练与微调线',
    summary: '面向想动模型本身的工程师：深度学习底子 → 手写核心结构 → 微调方法（含 LoRA/RLHF）→ 推理部署优化。',
    stages: [
      { title: '阶段一·深度学习底子', goal: '代码层面吃透训练细节', items: [
        { title: 'PyTorch 基础', refId: 'pytorch-basics', why: '训练代码的载体' },
        { title: '手写 Transformer', refId: 'transformer-implementation', why: '逐行实现注意力与前向传播' },
        { title: '分布式训练', refId: 'distributed-training', why: '大模型离不开多卡，理解并行策略' }
      ] },
      { title: '阶段二·微调方法', goal: '能把开源模型调出自己的版本', items: [
        { title: '微调实战', refId: 'llm-finetuning', why: '全参微调的流程与决策表（vs RAG vs 提示词）' },
        { title: 'LoRA 低秩适配', refId: 'lora', why: '省显存的事实标准，平民微调首选' },
        { title: 'RLHF 与 DPO', refId: 'rlhf-dpo', why: '对齐人类偏好的两条主流路线' },
        { title: '指令数据工程', refId: 'instruction-data-engineering', why: '微调效果的上限由数据质量决定' }
      ] },
      { title: '阶段三·推理与部署优化', goal: '把模型便宜地跑起来', items: [
        { title: 'vLLM 部署', refId: 'vllm-deployment', why: '高吞吐推理的事实标准' },
        { title: '模型量化', refId: 'llm-quantization', why: '砍显存、提速度的第一手段' },
        { title: 'KV Cache 与长上下文', refId: 'kv-cache-long-context', why: '理解推理加速的底层机制' },
        { title: '投机解码', refId: 'speculative-decoding', why: '小模型打草稿大模型批改的加速思路' },
        { title: '模型压缩', refId: 'model-compression', why: '剪枝/蒸馏的系统方法' }
      ] },
      { title: '阶段四·保持前沿', goal: '跟得上模型演进速度', items: [
        { title: 'ArXiv 论文跟踪', refId: 'arxiv', why: '第一手论文来源' },
        { title: '深度研究产品', refId: 'deep-research-products', why: '看顶级产品怎么把研究能力工程化' }
      ] }
    ]
  }
];

for (const r of ROUTES) {
  const exists = await db.prepare('SELECT id FROM learning_paths WHERE title = ? AND is_official = 1').get(r.title);
  if (exists) { console.log(`⏭  路线《${r.title}》已存在`); continue; }
  // 引用校验：refId 必须已存在（静态笔记或刚种的待学节点），失效的置空
  const ids = new Set((await db.prepare('SELECT id FROM ai_nodes').all()).map(x => x.id));
  const bundle = await db.prepare('SELECT id FROM notes').all();
  bundle.forEach(x => ids.add(x.id));
  const fix = it => {
    it.refId = it.refId && ids.has(it.refId) ? it.refId : '';
    (it.children || []).forEach(fix);
  };
  r.stages.forEach(st => st.items.forEach(fix));
  await db.prepare(`INSERT INTO learning_paths(title, goal, tree, is_official, created_by) VALUES (?, ?, ?, 1, 'official')`)
    .run(r.title, '官方预置路线（可直接选择学习）', JSON.stringify({ title: r.title, summary: r.summary, stages: r.stages }));
  console.log(`✔  官方路线《${r.title}》已写入`);
}

console.log('\n种子完成。打开「🗺 学习路线」页即可直接选择官方路线。');
await closeDb();
