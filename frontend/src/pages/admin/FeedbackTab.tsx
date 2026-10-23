import { useEffect, useState, useCallback } from 'react';
import { Table, Button, Tag, Popconfirm, message } from 'antd';
import dayjs from 'dayjs';
import { api } from '../../api/client';

/** 管理端「💬 反馈」页签：查看/删除用户与游客提交的反馈 */
export default function FeedbackTab() {
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/admin/feedback')
      .then((r) => setList(r.data?.list || []))
      .catch(() => message.error('加载失败'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const remove = async (id: number) => {
    await api.delete(`/admin/feedback/${id}`);
    message.success('已删除');
    load();
  };

  const columns = [
    { title: '时间', dataIndex: 'createdAt', width: 140, render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm') },
    { title: '提交人', dataIndex: 'createdBy', width: 110,
      render: (v: string) => (v ? <Tag color="blue">{v}</Tag> : <Tag>游客</Tag>) },
    { title: '联系方式', dataIndex: 'contact', width: 140, render: (v: string) => v || '—' },
    { title: '反馈内容', dataIndex: 'content', render: (v: string) => (
      <div style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{v}</div>
    )},
    { title: '操作', key: 'ops', width: 80, render: (_: any, r: any) => (
      <Popconfirm title="确定删除这条反馈？" onConfirm={() => remove(r.id)}>
        <Button size="small" danger>删除</Button>
      </Popconfirm>
    )},
  ];

  return (
    <Table dataSource={list} columns={columns} rowKey="id" loading={loading} size="small"
      scroll={{ x: 640 }} pagination={{ pageSize: 10, showTotal: (t) => `共 ${t} 条反馈` }} />
  );
}
