import { useEffect, useMemo, useState } from 'react';
import { Input, Table, Tag, Tooltip, Spin } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useKnowledgeBase } from '../../hooks/useKnowledgeBase';
import NodeReadDrawer from '../../components/NodeReadDrawer';

/** 知识库：表格形式查全部知识，按关键词搜标题 / 摘要 / 分类 / 标签，点击行打开笔记浮窗 */
export default function LibraryPage() {
  const { data, aiData } = useKnowledgeBase();
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
    const all = [...(data?.nodes || []), ...(aiData?.nodes || [])];
    const k = kw.trim().toLowerCase();
    if (!k) return all;
    return all.filter(n =>
      String(n.title || '').toLowerCase().includes(k) ||
      String(n.summary || '').toLowerCase().includes(k) ||
      String(n.category || '').toLowerCase().includes(k) ||
      String(n.layer || '').toLowerCase().includes(k) ||
      (n.tags || []).some((t: string) => t.toLowerCase().includes(k)));
  }, [data, aiData, kw]);

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
    { title: '难度', dataIndex: 'difficulty', key: 'difficulty', width: 90,
      render: (v: string) => v && v !== '未标注' ? <Tag color="orange">{v}</Tag> : '未标注' },
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
