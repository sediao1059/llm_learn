import { useEffect, useMemo, useState } from 'react';
import { Input, Table, Tag, Tooltip, Spin, Select, Space, Button, message } from 'antd';
import { SearchOutlined, ClearOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useKnowledgeBase, invalidateKnowledgeBundle } from '../../hooks/useKnowledgeBase';
import NodeReadDrawer from '../../components/NodeReadDrawer';
import { api } from '../../api/client';

const DIFFICULTY_OPTIONS = [
  { value: '入门', label: '入门' },
  { value: '进阶', label: '进阶' },
  { value: '深入', label: '深入' },
];
// 掌握程度档位（与笔记浮窗里的「学习程度」标注一致）
const LEVEL_OPTIONS = [
  { value: 0, label: '未学习' },
  { value: 1, label: '了解' },
  { value: 2, label: '熟悉' },
  { value: 3, label: '掌握' },
];
// 标准四层（判据见 docs/content-style-guide.md §5）；下拉选项 = 标准 ∪ 库里已有的层次
const STANDARD_LAYERS = ['L1-算法底层', 'L2-大模型底层', 'L3-应用工程层', 'L4-业务应用层'];

/** 筛选条件持久化（与关键词一致：刷新后保持，点「清空筛选」才重置） */
function loadList<T>(key: string, fallback: T): T {
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : fallback; } catch { return fallback; }
}

/** 知识库：表格形式查全部知识。筛选 = 关键词 × 分类 × 难度 × 掌握程度（登录后）AND 叠加；
 * 点击行打开笔记浮窗；管理员可在难度/层次列直接下拉改（手工笔记与 AI 沉淀/上传/专栏节点都行）。 */
export default function LibraryPage() {
  const { data, aiData, progress, user } = useKnowledgeBase();
  const isAdmin = user?.role === 'admin';
  // 关键词持久化：刷新后保持上次的查询，点输入框的 × 清除即重置
  const [keyword, setKeyword] = useState(() => localStorage.getItem('library.keyword') || '');
  const [kw, setKw] = useState(() => localStorage.getItem('library.keyword') || ''); // 防抖后再过滤
  const [categories, setCategories] = useState<string[]>(() => loadList('library.categories', []));
  const [difficulties, setDifficulties] = useState<string[]>(() => loadList('library.difficulties', []));
  const [levels, setLevels] = useState<number[]>(() => loadList('library.levels', []));
  const [selected, setSelected] = useState<string | null>(null);

  const onKeywordChange = (v: string) => {
    setKeyword(v);
    localStorage.setItem('library.keyword', v);
  };

  useEffect(() => {
    const t = setTimeout(() => setKw(keyword), 300);
    return () => clearTimeout(t);
  }, [keyword]);

  /** 分类下拉选项：静态 + AI 节点里出现过的全部分类 */
  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    (data?.nodes || []).forEach((n: any) => set.add(n.category || '未分类'));
    (aiData?.nodes || []).forEach((n: any) => set.add(n.category || '未分类'));
    return [...set].sort().map(c => ({ value: c, label: c }));
  }, [data, aiData]);

  /** 层次下拉选项：标准 L1~L4 ∪ 库里已有的层次（兼容历史自定义值） */
  const layerOptions = useMemo(() => {
    const set = new Set<string>(STANDARD_LAYERS);
    [...(data?.nodes || []), ...(aiData?.nodes || [])].forEach((n: any) => {
      if (n.layer && n.layer !== '未分层') set.add(n.layer);
    });
    return [...set].sort().map(l => ({ value: l, label: l }));
  }, [data, aiData]);

  const allRows = useMemo(() => {
    // 静态笔记与 AI 沉淀节点合并；难度缺失（AI 节点未手改过）按「未标注」参与筛选与展示
    const statics = (data?.nodes || []).map((n: any) => ({ ...n }));
    const ais = (aiData?.nodes || []).map((n: any) => ({ ...n }));
    return [...statics, ...ais];
  }, [data, aiData]);

  const rows = useMemo(() => {
    let all = allRows;
    const k = kw.trim().toLowerCase();
    if (k) {
      all = all.filter(n =>
        String(n.title || '').toLowerCase().includes(k) ||
        String(n.summary || '').toLowerCase().includes(k) ||
        String(n.category || '').toLowerCase().includes(k) ||
        String(n.layer || '').toLowerCase().includes(k) ||
        (n.tags || []).some((t: string) => t.toLowerCase().includes(k)));
    }
    if (categories.length) all = all.filter(n => categories.includes(n.category || '未分类'));
    if (difficulties.length) all = all.filter(n => difficulties.includes(n.difficulty || '未标注'));
    if (levels.length) all = all.filter(n => levels.includes(progress[n.id] || 0));
    return all;
  }, [allRows, kw, categories, difficulties, levels, progress]);

  const hasFilter = !!(kw.trim() || categories.length || difficulties.length || levels.length);

  const clearAll = () => {
    onKeywordChange('');
    setCategories([]); localStorage.removeItem('library.categories');
    setDifficulties([]); localStorage.removeItem('library.difficulties');
    setLevels([]); localStorage.removeItem('library.levels');
  };

  /** 管理员内联改难度/层次：成功后按节点来源刷新对应数据层，图谱/浮窗同步生效 */
  const changeMeta = async (n: any, patch: { difficulty?: string; layer?: string }) => {
    try {
      const r = await api.patch(`/admin/knowledge/${encodeURIComponent(n.id)}/meta`, patch);
      if (patch.difficulty !== undefined) {
        message.success(`《${n.title}》难度已改为「${patch.difficulty || '未标注'}」`);
      } else {
        message.success(`《${n.title}》层次已改为「${patch.layer || '未分层'}」`);
      }
      // AI 动态层没有 bundle 缓存，广播事件让 hook 重拉即可
      if (r.data?.source === 'aiNode') window.dispatchEvent(new Event('kg:ai-knowledge-updated'));
      else invalidateKnowledgeBundle();
    } catch (e: any) {
      message.error(e?.response?.data?.message || e.message || '保存失败');
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
    { title: '层次', dataIndex: 'layer', key: 'layer', width: isAdmin ? 168 : 130,
      render: (_, n) => isAdmin ? (
        <span onClick={(e) => e.stopPropagation()}>
          <Tooltip title="点击下拉修改层次，清空 = 未分层">
            <Select
              size="small" variant="borderless" allowClear showSearch
              value={n.layer && n.layer !== '未分层' ? n.layer : undefined}
              options={layerOptions}
              placeholder="未分层"
              onChange={(v) => changeMeta(n, { layer: v || '' })}
              style={{ width: 142, marginLeft: -8 }}
            />
          </Tooltip>
        </span>
      ) : (
        n.layer && n.layer !== '未分层' ? <Tag color="blue">{n.layer}</Tag> : '未分层'
      ) },
    { title: '难度', dataIndex: 'difficulty', key: 'difficulty', width: isAdmin ? 112 : 90,
      render: (_, n) => isAdmin ? (
        <span onClick={(e) => e.stopPropagation()}>
          <Tooltip title="点击下拉修改难度，清空 = 未标注">
            <Select
              size="small" variant="borderless" allowClear
              value={DIFFICULTY_OPTIONS.some(o => o.value === n.difficulty) ? n.difficulty : undefined}
              options={DIFFICULTY_OPTIONS}
              placeholder="未标注"
              onChange={(v) => changeMeta(n, { difficulty: v || '' })}
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
        style={{ marginBottom: 12 }}
      />
      <Space wrap style={{ marginBottom: 16 }}>
        <Tooltip title="只看选中的分类（可多选）">
          <Select
            mode="multiple" allowClear maxTagCount="responsive"
            style={{ minWidth: 170 }} placeholder="📋 按分类筛选"
            options={categoryOptions} value={categories}
            onChange={(v: string[]) => { setCategories(v); localStorage.setItem('library.categories', JSON.stringify(v)); }}
          />
        </Tooltip>
        <Tooltip title="入门=新手也能懂；进阶=需要一些基础；深入=老手进阶用；未标注=还没标难度的知识">
          <Select
            mode="multiple" allowClear maxTagCount="responsive"
            style={{ minWidth: 170 }} placeholder="🎯 按难度筛选"
            options={[...DIFFICULTY_OPTIONS, { value: '未标注', label: '未标注' }]}
            value={difficulties}
            onChange={(v: string[]) => { setDifficulties(v); localStorage.setItem('library.difficulties', JSON.stringify(v)); }}
          />
        </Tooltip>
        <Tooltip title={user ? '按你自己标过的学习程度筛选（在笔记浮窗底部标的那个）' : '登录后才能按你的掌握程度筛选'}>
          <Select
            mode="multiple" allowClear maxTagCount="responsive" disabled={!user}
            style={{ minWidth: 170 }} placeholder="📈 按掌握程度筛选"
            options={LEVEL_OPTIONS} value={levels}
            onChange={(v: number[]) => { setLevels(v); localStorage.setItem('library.levels', JSON.stringify(v)); }}
          />
        </Tooltip>
        {hasFilter && (
          <Button icon={<ClearOutlined />} onClick={clearAll}>
            清空筛选
          </Button>
        )}
      </Space>
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
          scroll={{ x: 860 }}
          onRow={(n) => ({ onClick: () => setSelected(n.id), style: { cursor: 'pointer' } })}
          pagination={{ pageSize: 20, showSizeChanger: false,
            showTotal: (t) => hasFilter ? `筛出 ${t} 篇 / 共 ${allRows.length} 篇` : `共 ${t} 篇` }}
          locale={{ emptyText: hasFilter ? '没有符合筛选条件的知识，试试放宽条件或点「清空筛选」' : '暂无知识' }}
        />
      )}

      {/* 点击行打开的笔记浮窗（与图谱页同一个，支持划词注解/收藏/学习程度） */}
      <NodeReadDrawer open={!!selected} onClose={() => setSelected(null)} nodeId={selected} />
    </div>
  );
}
