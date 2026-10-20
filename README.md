# llm_learn — 大模型技术学习仓库

个人大模型（LLM）技术学习项目：**知识点笔记 + 可交互知识图谱**。

- 每学一个新知识点，就在 `notes/` 下写一篇带 frontmatter 的 markdown 笔记；
- 运行一条构建命令，`graph/` 前端项目就会把它变成知识图谱上的一个节点；
- 打开 `graph/index.html`，点击节点即可阅读对应知识点的学习内容。

## 目录结构

```
llm_learn/
├── notes/                 # 全部学习笔记（一个知识点 = 一个 md 文件）
│   └── 01-agent/          # 按主题分类的目录（编号仅用于排序，分类以 frontmatter 为准）
├── graph/                 # 知识图谱前端项目（原生 JS + ECharts，零依赖构建）
│   ├── index.html         # 浏览器直接打开即可使用
│   ├── build.mjs          # 构建脚本：扫描 notes/ 生成图谱数据
│   ├── data/knowledge.js  # 构建产物（随仓库提交，双击 index.html 即可看）
│   └── js/ css/           # 图谱渲染代码与样式
├── README.md
└── .gitignore
```

## 如何新增一个学习点（三步）

1. **写笔记**：在 `notes/<分类目录>/` 下新建 `xxx.md`，文件头带上 frontmatter（模板见下）。
   - 学完了 → `status: learned`；只是先立个"衍生学习/待学"的坑 → `status: todo`（图谱上会以半透明虚线节点显示）。
2. **构建图谱**：`cd graph && npm run build`（等价于 `node build.mjs`）。
3. **查看**：浏览器打开 `graph/index.html`，点击节点学习；节点间连线由 `links` 字段生成。

## frontmatter 模板

```markdown
---
id: my-new-topic                    # 节点 ID，唯一（不填则默认用文件名）
title: 我的新知识点                    # 图谱节点显示名
category: Agent 系统                 # 分类（决定节点颜色，可自由新增）
tags: [Agent, 检索]                  # 标签（用于搜索）
status: learned                     # learned=已学习 / todo=待学习（衍生学习坑位）
links: [manus-multi-step-execution] # 关联的其他知识点 id（生成连线）
sources:                            # 参考资料（markdown 链接）
  - [标题](https://example.com)
---

正文开始，这里写学习内容（Markdown 任意写，支持表格、代码块、ASCII 图）。
```

## 知识图谱说明

- 打开方式：直接双击 `graph/index.html`（ECharts / marked 从 CDN 加载，需联网）；或 `cd graph && npm run serve` 后访问 http://127.0.0.1:8080
- 交互：节点可拖拽、滚轮缩放、搜索框过滤；点击节点 → 右侧面板显示笔记全文、关联知识点（可继续点击跳转）与参考资料
- `status: todo` 的节点在图上呈半透明虚线边框，代表「衍生学习」待办，学完后改状态并重新构建即可

## Git

- 远程仓库：https://gitee.com/sediaoopen/llm_learn.git
