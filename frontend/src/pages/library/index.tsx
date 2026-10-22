import { useEffect, useMemo, useState } from 'react';
import { Input, Table, Tag, Tooltip, Spin, Select, message } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useKnowledgeBase, invalidateKnowledgeBundle } from '../../hooks/useKnowledgeBase';
import NodeReadDrawer from '../../components/NodeReadDrawer';

const DIFFICULTY_OPTIONS = [
  { value: '入门', label: '入门' },
  { value: '进阶', label: '进阶' },
  { value: '深入', label: '深入' },
];

/** 知识库：表格形式查全部知识，按关键词搜标题 / 摘要 / 分类 / 标签，点击行打开笔记浮窗；管理员可在难度列直接下拉改（含未标注的） */
export default function LibraryPage() {
  const { data, aiData, user } = useKnowledgeBase();
  const isAdmin = user?.role === 'admin';
  // 关键词持久化：刷新后保持上次的查询，点输入框的 × 清除即重置
  const [keyword, setKeyword] = useState(() => localStorage.getItem('library.keyword') || '');
  const [kw, setKw] = useState(() => localStorage.getItem('library.keyword') || ''); // 防抖后再过滤
  const [selected, setSelected] = useState<string | null>(null);

  const onKeywordChange = (v: string) => {
    setKeyword(v);
    localStorage.setItem('library.keyword', v);
  };

  useEffect(() => {
    const t = setTimeout(() => setKw(keyword), 300);
    return () => clearTimeout(t);
  }, [keyword]);

  const rows = useMemo(() => {
    // _static 标记来源：静态笔记有难度字段（可改），AI 沉淀/专栏节点没有（只展示）
    const statics = (data?.nodes || []).map((n: any) => ({ ...n, _static: true }));
    const ais = (aiData?.nodes || []).map((n: any) => ({ ...n, _static: false }));
    const all = [...statics, ...ais];
    const k = kw.trim().toLowerCase();
    if (!k) return all;
    return all.filter(n =>
      String(n.title || '').toLowerCase().includes(k) ||
      String(n.summary || '').toLowerCase().includes(k) ||
      String(n.category || '').toLowerCase().includes(k) ||
      String(n.layer || '').toLowerCase().includes(k) ||
      (n.tags || []).some((t: string) => t.toLowerCase().includes(k)));
  }, [data, aiData, kw]);

  /** 管理员内联改难度：清空 = 未标注；成功后刷 bundle，图谱/浮窗同步生效 */
  const changeDifficulty = async (n: any, v?: string) => {
    try {
      const r = await fetch(`/api/admin/notes/${encodeURIComponent(n.id)}/difficulty`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('llm_learn_token')}`,
        },
        body: JSON.stringify({ difficulty: v || '' }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message || `HTTP ${r.status}`);
      message.success(`《${n.title}》难度已改为「${v || '未标注'}」`);
      invalidateKnowledgeBundle();
    } catch (e: any) {
      message.error(e.message || '难度更新失败');
    }
  };

  const columns: ColumnsType<any> = [
    {
      title: '标题', dataIndex: 'title', key: 'title',
      render: (_, n) => (
        <a onClick={() => setSelected(n.id)}>
          {n.ai !== undefined || String(n.id).startsWith('ai-') || String(n.id).startsWith('col-')
            ? '✨ ' : ''}{n.title}
        </a>
      ),
    },
    { title: '分类', dataIndex: 'category', key: 'category', width: 130,
      render: (v: string) => v ? <Tag color="geekblue">{v}</Tag> : '-' },
    { title: '层次', dataIndex: 'layer', key: 'layer', width: 130,
      render: (v: string) => v && v !== '未分层' ? <Tag color="blue">{v}</Tag> : '未分层' },
    { title: '难度', dataIndex: 'difficulty', key: 'difficulty', width: isAdmin ? 112 : 90,
      render: (_, n) => isAdmin && n._static ? (
        <span onClick={(e) => e.stopPropagation()}>
          <Tooltip title="点击下拉修改难度，清空 = 未标注">
            <Select
              size="small" variant="borderless" allowClear
              value={DIFFICULTY_OPTIONS.some(o => o.value === n.difficulty) ? n.difficulty : undefined}
              options={DIFFICULTY_OPTIONS}
              placeholder="未标注"
              onChange={(v) => changeDifficulty(n, v)}
              style={{ width: 86, marginLeft: -8 }}
            />
          </Tooltip>
        </span>
      ) : (
        n.difficulty && n.difficulty !== '未标注' ? <Tag color="orange">{n.difficulty}</Tag> : '未标注'
      ) },
    {
      title: '标签', dataIndex: 'tags', key: 'tags',
      render: (tags: string[]) => !tags?.length ? '-' : (
        <>
          {tags.slice(0, 4).map(t => <Tag key={t}>{t}</Tag>)}
          {tags.length > 4 && <Tag>+{tags.length - 4}</Tag>}
        </>
      ),
    },
    { title: '更新', key: 'updatedAt', width: 110,
      render: (_, n) => n.updatedAt || String(n.createdAt || '').slice(0, 10) || '-',
      sorter: (a: any, b: any) =>
        String(a.updatedAt || a.createdAt || '').localeCompare(String(b.updatedAt || b.createdAt || '')),
    },
  ];

  return (
    <div style={{ padding: 16, maxWidth: 1100, margin: '0 auto' }}>
      <Input
        allowClear
        size="large"
        prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />}
        placeholder="输入关键词查知识：搜标题、摘要、分类、层次或标签"
        value={keyword}
        onChange={e => onKeywordChange(e.target.value)}
        style={{ marginBottom: 16 }}
      />
      {!data ? (
        <div style={{ textAlign: 'center', padding: 80, color: '#8c8c8c' }}>
          <Spin /> 正在加载知识…
        </div>
      ) : (
        <Table
          rowKey="id"
          size="middle"
          columns={columns}
          dataSource={rows}
          onRow={(n) => ({ onClick: () => setSelected(n.id), style: { cursor: 'pointer' } })}
          pagination={{ pageSize: 20, showSizeChanger: false,
            showTotal: (t) => `共 ${t} 篇${kw.trim() ? ` · 命中关键词「${kw.trim()}」` : ''}` }}
          locale={{ emptyText: kw.trim() ? `没有匹配「${kw.trim()}」的知识，换个关键词试试` : '暂无知识' }}
        />
      )}

      {/* 点击行打开的笔记浮窗（与图谱页同一个，支持划词注解/收藏/学习程度） */}
      <NodeReadDrawer open={!!selected} onClose={() => setSelected(null)} nodeId={selected} />
    </div>
  );
}
