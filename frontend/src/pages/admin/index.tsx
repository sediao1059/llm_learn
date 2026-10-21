import { useEffect, useState, useCallback } from 'react';
import {
  Tabs, Table, Button, Modal, Form, Input, Select, Switch, Tag, Card,
  message, Popconfirm, Space, Badge, Progress, Alert,
} from 'antd';
import { api } from '../../api/client';

// ============ Users Tab ============
function UsersTab() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [editUser, setEditUser] = useState<any>(null);
  const [form] = Form.useForm();

  const load = useCallback(() => {
    setLoading(true);
    api.get('/admin/users').then(r => setUsers(r.data.users || [])).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, []);

  const patch = async (id: number, data: any) => {
    try {
      await api.patch(`/admin/users/${id}`, data);
      message.success('已保存');
      load();
    } catch (e: any) { message.error(e?.response?.data?.message || '操作失败'); }
  };

  const columns = [
    { title: '用户', dataIndex: 'username', key: 'username', render: (v: string, r: any) => (
      <div><b>{v}</b>{r.nickname && <span style={{ color: '#909399', marginLeft: 4 }}>({r.nickname})</span>}</div>
    )},
    { title: '角色', dataIndex: 'role', render: (v: string) =>
      v === 'admin' ? <Tag color="success">🛡 管理员</Tag> : <Tag>普通用户</Tag> },
    { title: '画像', dataIndex: 'profileTags', render: (v: any) => (
      <span>
        <Tag color={v?.level === 'expert' ? 'warning' : 'success'}>{v?.level === 'expert' ? '🦅' : '🐣'}</Tag>
        {(v?.focus || []).map((f: string) => <Tag key={f}>{f}</Tag>)}
      </span>
    )},
    { title: '邀请码', dataIndex: 'inviteCode', render: (v: string) => v || '—' },
    { title: '状态', dataIndex: 'status', render: (v: string) =>
      v === 'enabled' ? <Tag color="success">启用</Tag> : <Tag color="error">禁用</Tag> },
    { title: '操作', render: (_: any, r: any) => (
      <Space>
        <Button size="small" onClick={() => { setEditUser(r); form.setFieldsValue({ level: r.profileTags?.level, focus: r.profileTags?.focus || [] }); }}>画像</Button>
        <Button size="small" danger={r.status === 'enabled'} onClick={() => patch(r.id, { status: r.status === 'enabled' ? 'disabled' : 'enabled' })}>
          {r.status === 'enabled' ? '禁用' : '启用'}
        </Button>
      </Space>
    )},
  ];

  return (
    <>
      <Table dataSource={users} columns={columns} rowKey="id" loading={loading} size="small" />
      <Modal open={!!editUser} onCancel={() => setEditUser(null)} title={`编辑画像：${editUser?.username}`}
        onOk={async () => {
          const v = await form.validateFields();
          await patch(editUser.id, { profileTags: v });
          setEditUser(null);
        }}>
        <Form form={form} labelCol={{ span: 6 }}>
          <Form.Item name="level" label="大模型经验">
            <Select options={[
              { value: 'novice', label: '🐣 新手' }, { value: 'expert', label: '🦅 老手' },
            ]} />
          </Form.Item>
          <Form.Item name="focus" label="方向偏好">
            <Select mode="multiple" options={[
              { value: 'rag', label: '应用与RAG' }, { value: 'agent', label: 'Agent开发' },
              { value: 'train', label: '训练微调' }, { value: 'infra', label: '推理部署' },
            ]} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

// ============ Invites Tab ============
function InvitesTab() {
  const [invites, setInvites] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();

  const load = useCallback(() => {
    api.get('/admin/invites').then(r => setInvites(r.data.invites || []));
  }, []);
  useEffect(() => { load(); }, []);

  const columns = [
    { title: '邀请码', dataIndex: 'code', key: 'code', render: (v: string) => <b>{v}</b> },
    { title: '备注', dataIndex: 'note' },
    { title: '已注册', dataIndex: 'useCount', render: (v: number) => `${v} 人` },
    { title: '状态', dataIndex: 'status', render: (v: string, r: any) => (
      <Switch checked={v === 'enabled'} onChange={() => api.patch(`/admin/invites/${r.id}`, { status: v === 'enabled' ? 'disabled' : 'enabled' }).then(load)} />
    )},
    { title: '操作', render: (_: any, r: any) => (
      <Popconfirm title="确定删除？" onConfirm={() => api.delete(`/admin/invites/${r.id}`).then(load)}>
        <Button size="small" danger>删除</Button>
      </Popconfirm>
    )},
  ];

  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <Button type="primary" onClick={() => setOpen(true)}>＋ 新建邀请码</Button>
      </div>
      <Table dataSource={invites} columns={columns} rowKey="id" size="small" />
      <Modal open={open} onCancel={() => setOpen(false)} title="新建邀请码"
        onOk={async () => {
          const v = await form.validateFields();
          await api.post('/admin/invites', v);
          message.success('已创建');
          setOpen(false); form.resetFields(); load();
        }}>
        <Form form={form} labelCol={{ span: 6 }}>
          <Form.Item name="code" label="邀请码（可空）"><Input placeholder="留空自动生成" /></Form.Item>
          <Form.Item name="note" label="备注"><Input /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}

// ============ Jobs Tab ============
function JobsTab() {
  const [jobs, setJobs] = useState<any[]>([]);
  const load = useCallback(() => {
    api.get('/admin/jobs').then(r => setJobs(r.data.jobs || []));
  }, []);
  useEffect(() => { load(); }, []);

  return (
    <Table dataSource={jobs} rowKey="id" size="small" columns={[
      { title: '任务', dataIndex: 'name' },
      { title: '说明', dataIndex: 'desc' },
      { title: '上次执行', dataIndex: 'lastRun', render: (v: string) => v || '—' },
      { title: '状态', dataIndex: 'running', render: (v: boolean) =>
        v ? <Tag color="processing">⏳ 运行中</Tag> : <Tag color="success">空闲</Tag> },
      { title: '操作', render: (_: any, r: any) => (
        <Button size="small" type="primary" disabled={r.running} onClick={() => {
          api.post(`/admin/jobs/${r.id}/run`).then(() => { message.success('已触发'); setTimeout(load, 1500); });
        }}>▶ 立即执行</Button>
      )},
    ]} />
  );
}

// ============ Main Admin Page ============
export default function AdminPage() {
  return (
    <div style={{ padding: 16, maxWidth: 1200, margin: '0 auto' }}>
      <Card>
        <Tabs items={[
          { key: 'users', label: '用户管理', children: <UsersTab /> },
          { key: 'invites', label: '邀请码', children: <InvitesTab /> },
          { key: 'jobs', label: '定时任务', children: <JobsTab /> },
        ]} />
      </Card>
    </div>
  );
}
