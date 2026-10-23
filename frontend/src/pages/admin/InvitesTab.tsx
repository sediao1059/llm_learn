import { useEffect, useState, useCallback } from 'react';
import { Table, Button, Tag, Modal, Form, Input, Switch, Space, Popconfirm, message } from 'antd';

const API = '/api';
const headers = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${localStorage.getItem('llm_learn_token')}`,
});

export default function InvitesTab() {
  const [invites, setInvites] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();

  const load = useCallback(() => {
    setLoading(true);
    fetch(`${API}/admin/invites`, { headers: headers() })
      .then(r => r.json()).then(d => setInvites(d.invites || []))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, []);

  const toggle = async (id: number, current: string) => {
    await fetch(`${API}/admin/invites/${id}`, {
      method: 'PATCH', headers: headers(),
      body: JSON.stringify({ status: current === 'enabled' ? 'disabled' : 'enabled' }),
    });
    load();
  };

  const columns = [
    { title: '邀请码', dataIndex: 'code', width: 160, render: (v: string) =>
      <b style={{ fontFamily: 'monospace' }}>{v}</b> },
    { title: '备注', dataIndex: 'note' },
    { title: '已注册', dataIndex: 'useCount', width: 70, render: (v: number) => `${v} 人` },
    { title: '状态', dataIndex: 'status', width: 80, render: (v: string, r: any) => (
      <Switch checked={v === 'enabled'} checkedChildren="启用" unCheckedChildren="停用"
        onChange={() => toggle(r.id, v)} />
    )},
    { title: '操作', key: 'ops', width: 130, render: (_: any, r: any) => (
      <Space size={4}>
        <Button onClick={() => {
          navigator.clipboard?.writeText(r.code).then(() => message.success(`已复制：${r.code}`));
        }}>复制</Button>
        <Popconfirm title={`确定删除「${r.code}」？`} onConfirm={async () => {
          await fetch(`${API}/admin/invites/${r.id}`, { method: 'DELETE', headers: headers() });
          message.success('已删除'); load();
        }}>
          <Button danger>删除</Button>
        </Popconfirm>
      </Space>
    )},
  ];

  return (
    <>
      <div style={{ marginBottom: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
        <Button type="primary" onClick={() => setOpen(true)}>＋ 新建邀请码</Button>
        <span style={{ color: '#8c8c8c', fontSize: 12 }}>
          邀请码可重复使用（一码多人），停用后不能再注册
        </span>
      </div>
      <Table dataSource={invites} columns={columns} rowKey="id" loading={loading}
        scroll={{ x: 640 }} pagination={{ pageSize: 10, showTotal: (t) => `共 ${t} 条` }} />
      <Modal open={open} onCancel={() => setOpen(false)} title="新建邀请码" width={380}
        onOk={async () => {
          const v = await form.validateFields();
          const r = await fetch(`${API}/admin/invites`, {
            method: 'POST', headers: headers(), body: JSON.stringify(v),
          });
          const d = await r.json();
          if (r.ok) {
            message.success(`已创建：${d.invite.code}`);
            setOpen(false); form.resetFields(); load();
          } else message.error(d.message || '创建失败');
        }}>
        <Form form={form} labelCol={{ span: 7 }}>
          <Form.Item name="code" label="邀请码（可空）">
            <Input placeholder="留空自动生成" maxLength={32} />
          </Form.Item>
          <Form.Item name="note" label="备注">
            <Input placeholder="发给谁 / 干什么用" maxLength={100} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
