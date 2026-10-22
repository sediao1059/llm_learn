import { useEffect, useState, useCallback } from 'react';
import { Table, Button, Tag, Drawer, Switch, Space, Input, message, Collapse } from 'antd';

const headers = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${localStorage.getItem('llm_learn_token')}`,
});

export default function PathsTab() {
  const [paths, setPaths] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewPath, setViewPath] = useState<any>(null);
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/admin/paths', { headers: headers() })
      .then(r => r.json()).then(d => setPaths(d.paths || []))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, []);

  const columns = [
    { title: '路线', key: 'title', render: (_: any, r: any) => (
      <Space>
        <a onClick={() => {
          setViewPath(r);
          // 列表接口只返回官方+本人路线，私人路线详情走单条接口（管理员可看任何一条）
          fetch(`/api/ai/paths/${r.id}`, { headers: headers() })
            .then(res => res.ok ? res.json() : null)
            .then(d => { if (d?.tree) setViewPath({ ...r, tree: d.tree }); });
        }}>
          <b>{r.title}</b>
        </a>
        {r.isOfficial && <Tag color="warning">⭐ 官方</Tag>}
      </Space>
    )},
    { title: '创建人', dataIndex: 'createdBy', width: 100 },
    { title: '官方', key: 'official', width: 70, render: (_: any, r: any) => (
      <Switch checked={r.isOfficial}
        onChange={async (checked) => {
          await fetch(`/api/admin/paths/${r.id}/official`, {
            method: 'POST', headers: headers(),
            body: JSON.stringify({ official: checked }),
          });
          load();
        }} />
    )},
    { title: '操作', key: 'ops', width: 80, render: (_: any, r: any) => (
      <Button danger onClick={async () => {
        if (!confirm(`确定删除「${r.title}」？`)) return;
        const res = await fetch(`/api/ai/paths/${r.id}`, { method: 'DELETE', headers: headers() });
        if (res.ok) { message.success('已删除'); load(); }
        else message.error((await res.json()).message || '删除失败');
      }}>删除</Button>
    )},
  ];

  return (
    <div>
      <div style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
        <Input value={importUrl} onChange={e => setImportUrl(e.target.value)}
          placeholder="粘贴文章链接，一键转为官方路线" style={{ flex: 1, maxWidth: 400 }} />
        <Button type="primary" loading={importing}
          onClick={async () => {
            if (!importUrl.trim()) return;
            setImporting(true);
            const r = await fetch('/api/admin/paths/import', {
              method: 'POST', headers: headers(), body: JSON.stringify({ url: importUrl.trim() }),
            });
            setImporting(false);
            if (r.ok) { message.success('已开始导入，稍后刷新'); setTimeout(load, 3000); }
            else message.error((await r.json()).message || '导入失败');
          }}>🔗 导入官方路线</Button>
      </div>
      <Table dataSource={paths} columns={columns} rowKey="id" loading={loading}
        pagination={{ pageSize: 10 }} />

      <Drawer open={!!viewPath} onClose={() => setViewPath(null)}
        title={`🗺 ${viewPath?.title || ''}`} width={520}>
        {viewPath?.tree && (
          <>
            {viewPath.tree.summary && (
              <p style={{ color: '#8c8c8c', fontSize: 13 }}>{viewPath.tree.summary}</p>
            )}
            <Collapse>
              {(viewPath.tree.stages || []).map((st: any, i: number) => (
                <Collapse.Panel key={i} header={`阶段 ${i + 1} · ${st.title}`}>
                  {st.goal && <p style={{ color: '#8c8c8c', fontSize: 12 }}>{st.goal}</p>}
                  {(st.items || []).map((it: any, j: number) => (
                    <div key={j} style={{ padding: '4px 0', fontSize: 13, display: 'flex', gap: 8, alignItems: 'center' }}>
                      <b>{it.title}</b>
                      {it.refId ? <Tag color="success">已关联</Tag> : <Tag>新主题</Tag>}
                    </div>
                  ))}
                </Collapse.Panel>
              ))}
            </Collapse>
          </>
        )}
      </Drawer>
    </div>
  );
}
