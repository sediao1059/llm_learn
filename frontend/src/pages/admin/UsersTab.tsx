import { useEffect, useState, useCallback } from 'react';
import { Table, Button, Tag, Drawer, Form, Select, Space, Popconfirm, message } from 'antd';

const FOCUS = [
  { value: 'rag', label: '应用与RAG' }, { value: 'agent', label: 'Agent开发' },
  { value: 'train', label: '训练微调' }, { value: 'infra', label: '推理部署' },
];

export default function UsersTab() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [editUser, setEditUser] = useState<any>(null);
  const [form] = Form.useForm();

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/admin/users', {
      headers: { Authorization: `Bearer ${localStorage.getItem('llm_learn_token')}` },
    }).then(r => r.json()).then(d => setUsers(d.users || [])).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, []);

  const patch = async (id: number, data: any) => {
    try {
      const r = await fetch(`/api/admin/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('llm_learn_token')}` },
        body: JSON.stringify(data),
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d.message || '操作失败'); }
      message.success('已保存');
      load();
    } catch (e: any) { message.error(e.message); }
  };

  const columns = [
    { title: '用户', key: 'user', render: (_: any, r: any) => (
      <div>
        <b>{r.username}</b>
        {r.nickname && <span style={{ color: '#8c8c8c', marginLeft: 6, fontSize: 12 }}>{r.nickname}</span>}
      </div>
    )},
    { title: '角色', dataIndex: 'role', width: 90, render: (v: string) =>
      v === 'admin' ? <Tag color="success">🛡 管理员</Tag> : <Tag>普通用户</Tag> },
    { title: '对话', dataIndex: 'totalChats', width: 60, render: (v: number) => v || 0 },
    { title: 'Token', dataIndex: 'totalTokens', width: 80,
      render: (v: number) => v ? (v > 999 ? `${(v / 1000).toFixed(1)}k` : v) : '0' },
    { title: '最后活跃', dataIndex: 'lastActive', width: 120,
      render: (v: string) => v ? new Date(v).toLocaleString('zh-CN', { hour12: false }).slice(5, 16) : '—' },
    { title: '画像', key: 'tags', width: 200, render: (_: any, r: any) => (
      <Space size={4} wrap>
        <Tag color={r.profileTags?.level === 'expert' ? 'warning' : 'success'}>
          {r.profileTags?.level === 'expert' ? '🦅' : '🐣'}
        </Tag>
        {(r.profileTags?.focus || []).map((f: string) => (
          <Tag key={f} style={{ fontSize: 11 }}>{FOCUS.find(x => x.value === f)?.label || f}</Tag>
        ))}
      </Space>
    )},
    { title: '邀请码', dataIndex: 'inviteCode', width: 110, render: (v: string) =>
      <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{v || '—'}</span> },
    { title: '状态', dataIndex: 'status', width: 70, render: (v: string) =>
      v === 'enabled' ? <Tag color="success">启用</Tag> : <Tag color="error">禁用</Tag> },
    { title: 'AI', dataIndex: 'llmBanned', width: 50, render: (v: boolean) =>
      v ? <Tag color="error">🚫</Tag> : <Tag color="success">✓</Tag> },
    { title: '操作', key: 'ops', width: 200, render: (_: any, r: any) => (
      <Space size={4}>
        <Button onClick={() => {
          setEditUser(r);
          form.setFieldsValue({ level: r.profileTags?.level, focus: r.profileTags?.focus || [] });
        }}>画像</Button>
        <Popconfirm title={`确定${r.status === 'enabled' ? '禁用' : '启用'}「${r.username}」？`}
          onConfirm={() => patch(r.id, { status: r.status === 'enabled' ? 'disabled' : 'enabled' })}>
          <Button size="small" danger={r.status === 'enabled'}>
            {r.status === 'enabled' ? '禁用' : '启用'}
          </Button>
        </Popconfirm>
        <Popconfirm title={`${r.llmBanned ? '恢复' : '禁止'}「${r.username}」使用 AI 功能？${r.llmBanned ? '' : '（不影响浏览知识图谱）'}`}
          onConfirm={() => patch(r.id, { llmBanned: !r.llmBanned })}>
          <Button size="small" danger={!r.llmBanned}>
            {r.llmBanned ? '恢复AI' : '禁AI'}
          </Button>
        </Popconfirm>
        {r.role !== 'admin' ? (
          <Popconfirm title={`确定提升「${r.username}」为管理员？`} onConfirm={() => patch(r.id, { role: 'admin' })}>
            <Button>设管理</Button>
          </Popconfirm>
        ) : r.username !== JSON.parse(localStorage.getItem('llm_learn_user') || '{}').username ? (
          <Popconfirm title={`确定收回「${r.username}」管理员权限？`} onConfirm={() => patch(r.id, { role: 'user' })}>
            <Button>撤管理</Button>
          </Popconfirm>
        ) : null}
      </Space>
    )},
  ];

  return (
    <>
      <Table
        dataSource={users} columns={columns} rowKey="id"
        loading={loading}
        pagination={{ pageSize: 10, showTotal: (t) => `共 ${t} 个用户`, showSizeChanger: false }}
      />
      <Drawer
        open={!!editUser} onClose={() => setEditUser(null)}
        title={`编辑画像：${editUser?.username || ''}`} width={380}
        extra={<Button type="primary" onClick={async () => {
          const v = await form.validateFields();
          await patch(editUser.id, { profileTags: v });
          setEditUser(null);
        }}>保存</Button>}
      >
        <Form form={form} labelCol={{ span: 8 }} wrapperCol={{ span: 14 }}>
          <Form.Item name="level" label="大模型经验">
            <Select options={[
              { value: 'novice', label: '🐣 新手（AI 用大白话+例子回答）' },
              { value: 'expert', label: '🦅 老手（AI 直接给专业细节）' },
            ]} />
          </Form.Item>
          <Form.Item name="focus" label="方向偏好">
            <Select mode="multiple" options={FOCUS} placeholder="选择 1~4 个方向" />
          </Form.Item>
          <p style={{ color: '#8c8c8c', fontSize: 12, marginTop: 16 }}>
            画像决定该用户提问时 AI 的回答风格与学习路线推荐方向。
          </p>
        </Form>
      </Drawer>
    </>
  );
}
