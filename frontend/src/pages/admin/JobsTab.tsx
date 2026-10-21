import { useEffect, useState, useCallback } from 'react';
import { Table, Button, Tag, message } from 'antd';

const headers = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${localStorage.getItem('llm_learn_token')}`,
});

export default function JobsTab() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/admin/jobs', { headers: headers() })
      .then(r => r.json()).then(d => setJobs(d.jobs || []))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const timer = jobs.some(j => j.running) ? setInterval(load, 3000) : null;
    return () => { if (timer) clearInterval(timer); };
  }, [jobs.some(j => j.running)]);

  const columns = [
    { title: '任务', key: 'name', render: (_: any, r: any) => (
      <div><b>{r.name}</b><div style={{ color: '#c0c4cc', fontSize: 11 }}>{r.id}</div></div>
    )},
    { title: '说明', dataIndex: 'desc' },
    { title: '上次执行', dataIndex: 'lastRun', render: (v: string) => v || '—' },
    { title: '状态', dataIndex: 'running', width: 90, render: (v: boolean) =>
      v ? <Tag color="processing">⏳ 运行中</Tag> : <Tag color="success">空闲</Tag> },
    { title: '操作', key: 'ops', width: 100, render: (_: any, r: any) => (
      <Button type="primary" disabled={r.running} onClick={async () => {
        const res = await fetch(`/api/admin/jobs/${r.id}/run`, {
          method: 'POST', headers: headers(),
        });
        if (res.ok) { message.success('已触发'); setTimeout(load, 1500); }
      }}>▶ 立即执行</Button>
    )},
  ];

  return (
    <Table dataSource={jobs} columns={columns} rowKey="id" loading={loading}
      pagination={false} />
  );
}
