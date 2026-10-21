import { useEffect, useState, useCallback } from 'react';
import {
  Table, Button, Tag, Drawer, Radio, Select, Input, Space, Modal, Card, message, Empty,
} from 'antd';

const headers = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${localStorage.getItem('llm_learn_token')}`,
});

export default function UploadsTab() {
  const [status, setStatus] = useState('extracted');
  const [uploads, setUploads] = useState<any[]>([]);
  const [collections, setCollections] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewUpload, setViewUpload] = useState<any>(null);
  const [colEdit, setColEdit] = useState<Record<number, { mode: string; title: string; summary: string; mergeId: string }>>({});
  const [deletedItems, setDeletedItems] = useState<Record<string, boolean>>({});

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/admin/uploads?status=${status}`, { headers: headers() })
      .then(r => r.json()).then(d => {
        setUploads(d.uploads || []);
        setCollections(d.collections || []);
        const edits: any = {};
        for (const u of d.uploads || []) {
          const sug = u.collectionSuggestion || { mode: 'new', title: '', summary: '', mergeId: '' };
          edits[u.id] = { mode: sug.mode || 'new', title: sug.title || u.title || '', summary: sug.summary || '', mergeId: sug.mergeId || '' };
        }
        setColEdit(edits);
      }).finally(() => setLoading(false));
  }, [status]);
  useEffect(() => { load(); }, [status]);

  const approve = async (u: any) => {
    const items = (u.items || [])
      .filter((it: any) => !deletedItems[`${u.id}-${it.id}`])
      .map((it: any) => ({ id: it.id, title: it.title, tags: it.tags, links: it.links }));
    if (!items.length) return message.warning('请至少保留一个知识点');
    const col = colEdit[u.id];
    const r = await fetch(`/api/admin/uploads/${u.id}/approve`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({
        items,
        deletedIds: (u.items || []).filter((it: any) => deletedItems[`${u.id}-${it.id}`]).map((it: any) => it.id),
        collection: col,
      }),
    });
    const d = await r.json();
    if (r.ok) { message.success(`✅ 已入库（${d.itemCount} 篇，+${d.points} 分）`); setViewUpload(null); load(); }
    else message.error(d.message || '入库失败');
  };

  const columns = [
    { title: '来源', key: 'src', ellipsis: true, render: (_: any, r: any) =>
      r.kind === 'url' ? r.url : `📝《${r.title}》` },
    { title: '提交者', dataIndex: 'submittedBy', width: 80 },
    { title: '状态', key: 'st', width: 100, render: (_: any, r: any) => {
      const map: Record<string, [string, string]> = {
        extracting: ['processing', '⏳ 拆解中'], extracted: ['warning', '📦 待审核'],
        approved: ['success', '✅ 已入库'], rejected: ['error', '❌ 已驳回'],
        extract_failed: ['error', '⚠️ 失败'],
      };
      const [c, t] = map[r.status] || ['default', r.status];
      return <Tag color={c}>{t}</Tag>;
    }},
    { title: '知识点', key: 'items', width: 60, render: (_: any, r: any) =>
      r.items?.length || 0 },
    { title: '操作', key: 'ops', width: 130, render: (_: any, r: any) => (
      <Space size={4}>
        {r.status === 'extracted' && (
          <Button type="primary" onClick={() => setViewUpload(r)}>审核入库</Button>
        )}
        {r.status === 'extract_failed' && (
          <Button onClick={async () => {
            await fetch(`/api/admin/uploads/${r.id}/retry`, { method: 'POST', headers: headers() });
            message.success('已重新拆解'); setTimeout(load, 2000);
          }}>重试</Button>
        )}
        {(r.status === 'extracted' || r.status === 'extract_failed') && (
          <Button danger onClick={() => {
            Modal.confirm({
              title: '驳回上传', content: <Input id="upload-reject" placeholder="理由" />,
              onOk: async () => {
                const reason = (document.getElementById('upload-reject') as HTMLInputElement)?.value;
                if (!reason?.trim()) return Promise.reject();
                await fetch(`/api/admin/uploads/${r.id}/reject`, {
                  method: 'POST', headers: headers(), body: JSON.stringify({ reason }),
                });
                message.success('已驳回'); load();
              },
            });
          }}>驳回</Button>
        )}
      </Space>
    )},
  ];

  const currentCol = viewUpload ? colEdit[viewUpload.id] : null;

  return (
    <div>
      <Radio.Group value={status} onChange={e => setStatus(e.target.value)} style={{ marginBottom: 12 }}>
        <Radio.Button value="extracted">待审核</Radio.Button>
        <Radio.Button value="approved">已入库</Radio.Button>
        <Radio.Button value="rejected">已驳回</Radio.Button>
        <Radio.Button value="extract_failed">失败</Radio.Button>
      </Radio.Group>
      <Table dataSource={uploads} columns={columns} rowKey="id" loading={loading}
        pagination={{ pageSize: 8 }} />

      <Drawer
        open={!!viewUpload} onClose={() => setViewUpload(null)}
        title={`审核入库 · ${viewUpload?.kind === 'url' ? viewUpload?.url?.slice(0, 30) : viewUpload?.title}`} width={620}
        extra={<Button type="primary" onClick={() => approve(viewUpload)}>✅ 通过并入库</Button>}
      >
        {viewUpload && currentCol && (
          <>
            <Card title={`AI 拆解出 ${viewUpload.items.length} 个知识点`} style={{ marginBottom: 16 }}>
              {viewUpload.items.map((it: any) => (
                <div key={it.id} style={{
                  border: deletedItems[`${viewUpload.id}-${it.id}`] ? '1px solid #d9d9d9' : '1px solid #e8e8e8',
                  borderRadius: 8, padding: 10, marginBottom: 8, opacity: deletedItems[`${viewUpload.id}-${it.id}`] ? 0.4 : 1,
                }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <Input value={it.title} style={{ flex: 1 }}
                      onChange={e => { it.title = e.target.value; setUploads([...uploads]); }} />
                    <Button danger type="text"
                      onClick={() => setDeletedItems(prev => ({ ...prev, [`${viewUpload.id}-${it.id}`]: !prev[`${viewUpload.id}-${it.id}`] }))}>
                      {deletedItems[`${viewUpload.id}-${it.id}`] ? '恢复' : '删'}
                    </Button>
                  </div>
                  <div style={{ color: '#8c8c8c', fontSize: 12, marginTop: 4 }}>
                    标签：{(it.tags || []).join(', ')}
                  </div>
                  <details style={{ marginTop: 6 }}>
                    <summary style={{ cursor: 'pointer', fontSize: 12, color: '#8c8c8c' }}>查看内容</summary>
                    <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.7, maxHeight: 200, overflowY: 'auto' }}>
                      {it.content}
                    </div>
                  </details>
                </div>
              ))}
            </Card>

            <Card title="专栏归属">
              <Space direction="vertical" style={{ width: '100%' }} size={8}>
                <Space>
                  <Select value={currentCol.mode} style={{ width: 130 }}
                    onChange={v => setColEdit(prev => ({ ...prev, [viewUpload.id]: { ...prev[viewUpload.id], mode: v } }))}
                    options={[{ value: 'new', label: '新建专栏' }, { value: 'merge', label: '并入已有' }]} />
                  {currentCol.mode === 'new' ? (
                    <Input value={currentCol.title} style={{ width: 220 }} placeholder="专栏名"
                      onChange={e => setColEdit(prev => ({ ...prev, [viewUpload.id]: { ...prev[viewUpload.id], title: e.target.value } }))} />
                  ) : (
                    <Select value={currentCol.mergeId || undefined} style={{ width: 240 }}
                      placeholder="选择专栏" allowClear
                      onChange={v => setColEdit(prev => ({ ...prev, [viewUpload.id]: { ...prev[viewUpload.id], mergeId: v || '' } }))}
                      options={collections.map(c => ({ value: c.id, label: c.title }))} />
                  )}
                </Space>
                <Input value={currentCol.summary} placeholder="专栏导读（一句话，新建时）"
                  onChange={e => setColEdit(prev => ({ ...prev, [viewUpload.id]: { ...prev[viewUpload.id], summary: e.target.value } }))} />
              </Space>
            </Card>
          </>
        )}
      </Drawer>
    </div>
  );
}
