import { useEffect, useState, useCallback, useRef } from 'react';
import { Table, Button, Tag, Drawer, Space, Popconfirm, message, Progress, Alert } from 'antd';

const headers = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${localStorage.getItem('llm_learn_token')}`,
});

export default function InterviewTab() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewItem, setViewItem] = useState<any>(null);
  const [generating, setGenerating] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/admin/annotations/interview', { headers: headers() })
      .then(r => r.json()).then(d => setItems(d.items || []))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); return () => { if (pollRef.current) clearInterval(pollRef.current); }; }, []);

  const generate = async (nodeId?: string) => {
    const r = await fetch('/api/admin/annotations/interview/generate', {
      method: 'POST', headers: headers(),
      body: JSON.stringify(nodeId ? { nodeId } : {}),
    });
    const d = await r.json();
    if (!r.ok) return message.error(d.message || '发起失败');
    if (!d.started) return message.info(d.message || '没有缺失的');
    message.success(`已开始生成 ${d.total} 篇`);
    setGenerating(true);
    pollRef.current = setInterval(() => {
      fetch('/api/admin/annotations/interview', { headers: headers() })
        .then(r => r.json()).then(d => {
          setItems(d.items || []);
          const missing = (d.items || []).filter((x: any) => !x.has).length;
          if (missing === 0) { setGenerating(false); clearInterval(pollRef.current); message.success('全部生成完成'); }
        });
    }, 5000);
  };

  const missing = items.filter((x: any) => !x.has).length;
  const columns = [
    { title: '笔记', key: 'title', render: (_: any, r: any) => (
      <div>
        <div>{r.title}</div>
        <span style={{ color: '#c0c4cc', fontSize: 11, fontFamily: 'monospace' }}>{r.nodeId}</span>
      </div>
    )},
    { title: '状态', key: 'status', width: 130, render: (_: any, r: any) => (
      r.has ? (
        <Tag color={r.source === 'system' ? 'success' : 'processing'}>
          {r.source === 'system' ? '✅ 原文提取' : '✅ AI 生成'}
        </Tag>
      ) : <Tag color="error">❌ 缺失</Tag>
    )},
    { title: '更新时间', dataIndex: 'updatedAt', width: 140, render: (v: string) =>
      v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '—' },
    { title: '操作', key: 'ops', width: 200, render: (_: any, r: any) => (
      <Space size={4}>
        {r.has && (
          <Button onClick={() => setViewItem(r)}>查看</Button>
        )}
        <Button type={r.has ? 'default' : 'primary'} loading={generating}
          onClick={() => generate(r.nodeId)}>
          {r.has ? '重新生成' : 'AI 生成'}
        </Button>
        {r.has && r.source !== 'system' && (
          <Popconfirm title="确定删除这条面试题注解？" onConfirm={async () => {
            await fetch(`/api/ai/annotations/${r.annoId}`, { method: 'DELETE', headers: headers() });
            message.success('已删除'); load();
          }}>
            <Button danger>删除</Button>
          </Popconfirm>
        )}
      </Space>
    )},
  ];

  return (
    <>
      <div style={{ marginBottom: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
        <Button type="primary" loading={generating} disabled={missing === 0}
          onClick={() => generate()}>
          🤖 一键补全缺失（{missing} 篇）
        </Button>
        <span style={{ color: '#8c8c8c', fontSize: 12 }}>
          {items.length - missing}/{items.length} 篇已有 · 面试题以注解形式呈现，点「查看」在弹窗中阅读
        </span>
      </div>
      {generating && <Alert type="info" message="⏳ 正在后台生成，本页自动刷新进度…" style={{ marginBottom: 12 }} closable />}
      <Table dataSource={items} columns={columns} rowKey="nodeId" loading={loading}
        pagination={{ pageSize: 10, showTotal: (t) => `共 ${t} 篇笔记` }} />

      <Drawer
        open={!!viewItem} onClose={() => setViewItem(null)}
        title={`💼 高频面试题 · ${viewItem?.title || ''}`} width={520}
      >
        {viewItem && (
          <>
            <Tag color={viewItem.source === 'system' ? 'success' : 'processing'}>
              {viewItem.source === 'system' ? '原文提取' : 'AI 生成'}
            </Tag>
            <div
              style={{ marginTop: 16, lineHeight: 1.8, fontSize: 14 }}
              dangerouslySetInnerHTML={{ __html: formatMd(viewItem.answer) }}
            />
          </>
        )}
      </Drawer>
    </>
  );
}

function formatMd(md: string): string {
  // 简易 markdown 渲染（粗体、标题、列表）
  return String(md || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/^# (.+)$/gm, '<h2>$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>')
    .replace(/\n/g, '<br/>');
}
