import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Table, Button, Tag, Drawer, Form, Input, Select, AutoComplete, Space, Segmented,
  Popconfirm, message,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { invalidateKnowledgeBundle } from '../../hooks/useKnowledgeBase';
import MarkdownContent from '../../components/MarkdownContent';

const TOKEN = () => localStorage.getItem('llm_learn_token');

async function req(path: string, method: string, body?: any) {
  const r = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN()}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.message || `HTTP ${r.status}`);
  return d;
}

const parseArr = (s: string): string[] => {
  try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
};

const DIFFICULTY_COLOR: Record<string, string> = { '入门': 'green', '进阶': 'orange', '深入': 'red' };

/** 管理页「笔记管理」：手工笔记 CRUD（MySQL 为唯一创作源头，2026-10 起 notes/ 文件链路废弃） */
export default function NotesTab() {
  const [notes, setNotes] = useState<any[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null); // null = 新增
  const [saving, setSaving] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [view, setView] = useState<'edit' | 'preview'>('edit');
  const [form] = Form.useForm();
  const content = Form.useWatch('content', form);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (category) params.set('category', category);
    req(`/admin/notes?${params.toString()}`, 'GET')
      .then(d => { setNotes(d.notes || []); setCategories(d.categories || []); })
      .catch((e: any) => message.error(e.message || '加载笔记列表失败'))
      .finally(() => setLoading(false));
  }, [q, category]);
  useEffect(() => { load(); }, [load]);

  // 下拉选项：分层取现有值去重；links 选项 = 全部笔记（id + 标题）
  const layers = useMemo(() => [...new Set(notes.map((n: any) => n.layer).filter(Boolean))], [notes]);
  const linkOptions = useMemo(
    () => notes.map((n: any) => ({ value: n.id, label: `${n.id}（${n.title}）` })),
    [notes],
  );

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ status: 'learned' });
    setView('edit');
    setEditOpen(true);
  };

  const openEdit = async (r: any) => {
    setEditing(r);
    setView('edit');
    setEditOpen(true);
    setDetailLoading(true);
    form.resetFields();
    try {
      // 详情接口会把「高频面试题」章节体拼回正文，保证再保存时不丢面试题注解
      const d = await req(`/admin/notes/${encodeURIComponent(r.id)}`, 'GET');
      const n = d.note;
      form.setFieldsValue({
        id: n.id,
        title: n.title,
        category: n.category === '未分类' ? '' : n.category,
        layer: n.layer === '未分层' ? '' : n.layer,
        path: n.path || '',
        difficulty: n.difficulty === '未标注' ? undefined : n.difficulty,
        status: n.status,
        tags: parseArr(n.tags),
        links: parseArr(n.links),
        sources: parseArr(n.sources),
        content: n.content || '',
      });
    } catch (e: any) {
      message.error(e.message || '加载笔记失败');
      setEditOpen(false);
    } finally {
      setDetailLoading(false);
    }
  };

  const save = async () => {
    const v = await form.validateFields();
    setSaving(true);
    try {
      const body = {
        title: v.title,
        category: v.category || '',
        layer: v.layer || '',
        difficulty: v.difficulty || '',
        path: v.path || '',
        status: v.status || 'learned',
        tags: v.tags || [],
        links: v.links || [],
        sources: v.sources || [],
        content: v.content || '',
        ...(editing ? {} : { id: v.id }),
      };
      const d = editing
        ? await req(`/admin/notes/${encodeURIComponent(editing.id)}`, 'PUT', body)
        : await req('/admin/notes', 'POST', body);
      invalidateKnowledgeBundle();
      message.success('已保存，图谱数据已刷新（其他已打开页面的用户刷新后可见）');
      (d.warnings || []).forEach((w: string) => message.warning(w, 4));
      setEditOpen(false);
      load();
    } catch (e: any) {
      message.error(e.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (r: any) => {
    try {
      await req(`/admin/notes/${encodeURIComponent(r.id)}`, 'DELETE');
      invalidateKnowledgeBundle();
      message.success('已删除');
      load();
    } catch (e: any) { message.error(e.message); }
  };

  const columns = [
    {
      title: 'id', dataIndex: 'id', width: 180, ellipsis: true,
      render: (v: string) => <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{v}</span>,
    },
    { title: '标题', dataIndex: 'title', ellipsis: true },
    {
      title: '分类', dataIndex: 'category', width: 120, ellipsis: true,
      render: (v: string) => v === '未分类' ? <Tag>{v}</Tag> : <Tag color="blue">{v}</Tag>,
    },
    {
      title: '分层', dataIndex: 'layer', width: 110, ellipsis: true,
      render: (v: string) => v === '未分层' ? <Tag>{v}</Tag> : <Tag color="geekblue">{v}</Tag>,
    },
    { title: '路线', dataIndex: 'route', width: 150, ellipsis: true, render: (v: string) => v || '—' },
    {
      title: '难度', dataIndex: 'difficulty', width: 78,
      render: (v: string) => <Tag color={DIFFICULTY_COLOR[v] || ''}>{v}</Tag>,
    },
    {
      title: '状态', dataIndex: 'status', width: 78,
      render: (v: string) => v === 'todo' ? <Tag color="gold">待学</Tag> : <Tag color="green">已学</Tag>,
    },
    {
      title: '标签', dataIndex: 'tags', width: 200,
      render: (v: string) => {
        const arr = parseArr(v);
        if (!arr.length) return '—';
        return <>{arr.slice(0, 3).map(t => <Tag key={t}>{t}</Tag>)}{arr.length > 3 ? <Tag>+{arr.length - 3}</Tag> : null}</>;
      },
    },
    { title: '更新', dataIndex: 'updatedAt', width: 96 },
    {
      title: '操作', key: 'ops', width: 132,
      render: (_: any, r: any) => (
        <Space size={4}>
          <Button size="small" onClick={() => openEdit(r)}>编辑</Button>
          <Popconfirm
            title={`删除「${r.title}」？`}
            description="该知识点的用户收藏/学习进度/注解讨论会一并删除，不可恢复"
            onConfirm={() => remove(r)}
          >
            <Button size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ color: '#8c8c8c', fontSize: 12 }}>
          MySQL 是唯一创作源头：保存时自动提取首行「&gt; **一句话**」作摘要；「## 高频面试题」章节自动转成面试题注解；图谱缓存保存后自动刷新。
        </span>
        <Space>
          <Input.Search allowClear placeholder="搜 id / 标题 / 摘要" style={{ width: 200 }}
            onSearch={v => setQ(v)} />
          <Select allowClear placeholder="按分类筛选" style={{ width: 150 }}
            value={category} onChange={setCategory}
            options={categories.map(c => ({ value: c, label: c }))} />
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增笔记</Button>
        </Space>
      </div>
      <Table
        dataSource={notes} columns={columns} rowKey="id"
        loading={loading} pagination={{ pageSize: 10, showSizeChanger: false }}
      />

      <Drawer
        open={editOpen} onClose={() => setEditOpen(false)}
        title={editing ? `编辑笔记：${editing.id}` : '新增笔记'} width={760}
        extra={<Button type="primary" loading={saving} onClick={save}>保存</Button>}
      >
        <Form form={form} layout="vertical" disabled={detailLoading}>
          <Form.Item name="id" label="id（知识点唯一标识，创建后不可改）"
            rules={[
              { required: !editing, message: '请填 id' },
              { pattern: /^[A-Za-z0-9._-]+$/, message: '仅字母、数字、点、下划线、中划线' },
            ]}>
            <Input disabled={!!editing} placeholder="如 rag-vector-kb" maxLength={120} />
          </Form.Item>
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请填标题' }]}>
            <Input maxLength={200} placeholder="如 RAG 与向量知识库" />
          </Form.Item>
          <Space size={12} style={{ display: 'flex' }} align="start">
            <Form.Item name="category" label="分类" style={{ flex: 1, minWidth: 200 }}>
              <AutoComplete allowClear options={categories.map(c => ({ value: c }))} placeholder="不填归入「未分类」" />
            </Form.Item>
            <Form.Item name="layer" label="分层" style={{ flex: 1, minWidth: 180 }}>
              <AutoComplete allowClear options={layers.map(l => ({ value: l }))} placeholder="不填归入「未分层」" />
            </Form.Item>
          </Space>
          <Space size={12} style={{ display: 'flex' }} align="start">
            <Form.Item name="difficulty" label="难度" style={{ flex: 1, minWidth: 120 }}>
              <Select allowClear options={[
                { value: '入门', label: '入门' },
                { value: '进阶', label: '进阶' },
                { value: '深入', label: '深入' },
              ]} placeholder="不填标为「未标注」" />
            </Form.Item>
            <Form.Item name="status" label="学习状态" style={{ flex: 1, minWidth: 120 }}>
              <Select options={[
                { value: 'learned', label: '已学' },
                { value: 'todo', label: '待学' },
              ]} />
            </Form.Item>
            <Form.Item name="path" label="学习路线位置" style={{ flex: 2, minWidth: 200 }}
              rules={[{ pattern: /^\d+\.\d+$/, message: '格式：路线号.步骤号（如 1.2）' }]}>
              <Input placeholder="如 1.2（路线 1 第 2 步），留空不挂路线" maxLength={10} />
            </Form.Item>
          </Space>
          <Form.Item name="tags" label="标签">
            <Select mode="tags" allowClear placeholder="回车添加，如 RAG、向量检索" />
          </Form.Item>
          <Form.Item name="links" label="关联知识点（links）">
            <Select mode="tags" allowClear showSearch options={linkOptions}
              tokenSeparators={[',']} placeholder="从下拉选，或输入知识点 id" />
          </Form.Item>
          <Form.Item name="sources" label="来源（sources）">
            <Select mode="tags" allowClear placeholder="如 课程名 / 论文 / 博客链接" />
          </Form.Item>
          <Form.Item label="正文（Markdown）" required>
            <Segmented value={view} onChange={v => setView(v as 'edit' | 'preview')}
              options={[{ label: '编辑', value: 'edit' }, { label: '预览', value: 'preview' }]}
              style={{ marginBottom: 8 }} />
            {view === 'edit' ? (
              <Form.Item name="content" noStyle>
                <Input.TextArea
                  autoSize={{ minRows: 18, maxRows: 32 }}
                  style={{ fontFamily: 'monospace', fontSize: 12 }}
                  placeholder={'> **一句话**：……（首行大白话摘要，图谱 tooltip 与笔记面板用它）\n\n## 是什么\n……\n\n## 高频面试题\n……（该章节保存时自动转成面试题注解，正文保留标题）'}
                />
              </Form.Item>
            ) : (
              <div style={{ border: '1px solid #d9d9d9', borderRadius: 6, padding: '8px 14px', maxHeight: 560, overflow: 'auto', background: '#fafafa' }}>
                <MarkdownContent content={content || '_（暂无内容）_'} />
              </div>
            )}
          </Form.Item>
          <p style={{ color: '#8c8c8c', fontSize: 12 }}>
            内容规范（章节模板、字段判据、大白话铁律）见 docs/content-style-guide.md；保存时服务端会做缺摘要/缺分层等软告警提示。
          </p>
        </Form>
      </Drawer>
    </>
  );
}
