import { useEffect, useState, useCallback } from 'react';
import {
  Table, Button, Tag, Drawer, Radio, Select, Space, Modal, Input, message, Card, Descriptions, Empty,
} from 'antd';

const headers = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${localStorage.getItem('llm_learn_token')}`,
});

const FOCUS = [
  { value: 'rag', label: 'RAG' }, { value: 'agent', label: 'Agent' },
  { value: 'train', label: '训练' }, { value: 'infra', label: '推理' },
];

export default function ReviewsTab() {
  const [status, setStatus] = useState('pending');
  const [subs, setSubs] = useState<any[]>([]);
  const [annos, setAnnos] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewSub, setViewSub] = useState<any>(null);
  const [drafts, setDrafts] = useState<Record<number, any>>({});
  const [extracting, setExtracting] = useState<Record<number, boolean>>({});

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch(`/api/admin/submissions?status=${status}`, { headers: headers() }).then(r => r.json()),
      fetch(`/api/admin/annotations?status=${status}`, { headers: headers() }).then(r => r.json()),
    ]).then(([s, a]) => {
      setSubs(s.submissions || []);
      setAnnos(a.annotations || []);
    }).finally(() => setLoading(false));
  }, [status]);
  useEffect(() => { load(); }, [status]);

  const doExtract = async (sub: any) => {
    setExtracting(prev => ({ ...prev, [sub.id]: true }));
    try {
      const r = await fetch(`/api/admin/submissions/${sub.id}/extract`, {
        method: 'POST', headers: headers(),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message || '提取失败');
      setDrafts(prev => ({
        ...prev,
        [sub.id]: {
          decision: d.decision,
          tags: { level: sub.profileTags?.level || 'novice', focus: sub.profileTags?.focus || [] },
        },
      }));
      setViewSub(sub);
    } catch (e: any) { message.error(e.message); }
    finally { setExtracting(prev => ({ ...prev, [sub.id]: false })); }
  };

  const approve = async (sub: any) => {
    const draft = drafts[sub.id];
    if (!draft) return message.warning('请先「AI 提取并预览」');
    const r = await fetch(`/api/admin/submissions/${sub.id}/approve`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ decision: draft.decision, profileTags: draft.tags }),
    });
    if (r.ok) { message.success('已通过并写入图谱'); setViewSub(null); load(); }
    else message.error((await r.json()).message || '写入失败');
  };

  const reject = (sub: any) => {
    Modal.confirm({
      title: '驳回提交', content: (
        <Input.TextArea id="reject-reason" placeholder="驳回理由（提交者可见）" rows={3} />
      ),
      onOk: async () => {
        const reason = (document.getElementById('reject-reason') as HTMLTextAreaElement)?.value?.trim();
        if (!reason) { message.warning('请填写理由'); return Promise.reject(); }
        const r = await fetch(`/api/admin/submissions/${sub.id}/reject`, {
          method: 'POST', headers: headers(), body: JSON.stringify({ reason }),
        });
        if (r.ok) { message.success('已驳回'); load(); }
      },
    });
  };

  const subColumns = [
    { title: '★', dataIndex: 'importance', width: 50, render: (v: number) =>
      <span style={{ color: '#faad14' }}>{'★'.repeat(v)}</span> },
    { title: '摘要', dataIndex: 'questionExcerpt', ellipsis: true },
    { title: '提交者', dataIndex: 'submittedBy', width: 90 },
    { title: '画像', key: 'tags', width: 100, render: (_: any, r: any) => (
      <Tag color={r.profileTags?.level === 'expert' ? 'warning' : 'success'}>
        {r.profileTags?.level === 'expert' ? '🦅' : '🐣'}
      </Tag>
    )},
    { title: '操作', key: 'ops', width: 220, render: (_: any, r: any) => (
      <Space size={4}>
        {r.status === 'pending' && (
          <>
            <Button type="primary" loading={extracting[r.id]} onClick={() => doExtract(r)}>
              🤖 提取
            </Button>
            <Button danger onClick={() => reject(r)}>驳回</Button>
          </>
        )}
        {r.status === 'approved' && <Tag color="success">已通过</Tag>}
        {r.status === 'rejected' && <Tag color="error">已驳回</Tag>}
      </Space>
    )},
  ];

  return (
    <div>
      <Radio.Group value={status} onChange={e => setStatus(e.target.value)} style={{ marginBottom: 12 }}>
        <Radio.Button value="pending">待审核</Radio.Button>
        <Radio.Button value="approved">已通过</Radio.Button>
        <Radio.Button value="rejected">已驳回</Radio.Button>
      </Radio.Group>

      <Card title="知识沉淀" style={{ marginBottom: 16 }}>
        <Table dataSource={subs} columns={subColumns} rowKey="id" loading={loading}
          pagination={{ pageSize: 5 }} />
      </Card>

      <Card title={`划词注释（${annos.length}）`}>
        {annos.length === 0 ? <Empty description="暂无" image={Empty.PRESENTED_IMAGE_SIMPLE} /> :
        annos.map(a => (
          <Card key={a.id} style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Tag>#{a.id} · {a.type}注</Tag>
              <span style={{ fontSize: 12, color: '#8c8c8c' }}>{a.createdBy}</span>
              <Tag color={a.status === 'pending' ? 'warning' : a.status === 'approved' ? 'success' : 'error'}>
                {a.status === 'pending' ? '待审' : a.status === 'approved' ? '已过' : '驳回'}
              </Tag>
              <div style={{ marginLeft: 'auto' }}>
                {a.status === 'pending' && (
                  <Space size={4}>
                    <Button type="primary" onClick={async () => {
                      await fetch(`/api/admin/annotations/${a.id}/approve`, {
                        method: 'POST', headers: headers(), body: JSON.stringify({}),
                      });
                      message.success('已通过'); load();
                    }}>通过</Button>
                    <Button danger onClick={() => {
                      Modal.confirm({
                        title: '驳回注释', content: <Input id="anno-reject" placeholder="理由" />,
                        onOk: async () => {
                          const reason = (document.getElementById('anno-reject') as HTMLInputElement)?.value;
                          if (!reason?.trim()) return Promise.reject();
                          await fetch(`/api/admin/annotations/${a.id}/reject`, {
                            method: 'POST', headers: headers(), body: JSON.stringify({ reason }),
                          });
                          message.success('已驳回'); load();
                        },
                      });
                    }}>驳回</Button>
                  </Space>
                )}
              </div>
            </div>
            <div style={{ marginTop: 6, fontSize: 13 }}>{a.anchorText?.slice(0, 80)}</div>
            <div style={{ color: '#8c8c8c', fontSize: 12, marginTop: 4, maxHeight: 120, overflow: 'hidden' }}>
              {a.answer?.slice(0, 200)}…
            </div>
          </Card>
        ))}
      </Card>

      {/* AI 提取预览 Drawer */}
      <Drawer
        open={!!viewSub} onClose={() => setViewSub(null)}
        title={`AI 提取结果 · ${viewSub?.questionExcerpt?.slice(0, 20) || ''}…`} width={560}
        extra={drafts[viewSub?.id] && (
          <Button type="primary" onClick={() => approve(viewSub)}>✅ 通过并写入</Button>
        )}
      >
        {drafts[viewSub?.id] && (
          <>
            <Descriptions column={1} bordered style={{ marginBottom: 16 }}>
              <Descriptions.Item label="判断">
                <Tag color={drafts[viewSub.id].decision.action === 'create' ? 'success' : 'warning'}>
                  {drafts[viewSub.id].decision.action === 'create' ? '🆕 新建' : '♻️ 合并'}
                </Tag>
                {drafts[viewSub.id].decision.reason}
              </Descriptions.Item>
              <Descriptions.Item label="标题">{drafts[viewSub.id].decision.title}</Descriptions.Item>
            </Descriptions>
            <div style={{
              border: '1px solid #e8e8e8', borderRadius: 8, padding: 12, background: '#fafafa',
              maxHeight: 350, overflowY: 'auto', fontSize: 13, lineHeight: 1.8,
            }}>
              {drafts[viewSub.id].decision.content}
            </div>
            <div style={{ marginTop: 16 }}>
              <span style={{ color: '#8c8c8c', fontSize: 12 }}>沉淀画像（可修正）</span>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <Select value={drafts[viewSub.id].tags.level} style={{ width: 120 }}
                  onChange={v => setDrafts(prev => ({ ...prev, [viewSub.id]: { ...prev[viewSub.id], tags: { ...prev[viewSub.id].tags, level: v } } }))}
                  options={[{ value: 'novice', label: '🐣 新手' }, { value: 'expert', label: '🦅 老手' }]} />
                <Select mode="multiple" value={drafts[viewSub.id].tags.focus} style={{ flex: 1 }}
                  onChange={v => setDrafts(prev => ({ ...prev, [viewSub.id]: { ...prev[viewSub.id], tags: { ...prev[viewSub.id].tags, focus: v } } }))}
                  options={FOCUS} placeholder="方向偏好" />
              </div>
            </div>
          </>
        )}
      </Drawer>
    </div>
  );
}
