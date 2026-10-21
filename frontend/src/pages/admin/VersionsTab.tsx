import { useEffect, useState, useCallback } from 'react';
import { Table, Button, Tag, Modal, Form, Input, DatePicker, Space, Popconfirm, message } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';

const headers = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${localStorage.getItem('llm_learn_token')}`,
});

export default function VersionsTab() {
  const [versions, setVersions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form] = Form.useForm();

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/versions', { headers: headers() })
      .then(r => r.json()).then(d => setVersions(d.versions || []))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ date: dayjs(), changes: [''] });
    setModalOpen(true);
  };

  const openEdit = (r: any) => {
    setEditing(r);
    form.setFieldsValue({
      version: r.version,
      date: dayjs(r.date || undefined),
      changes: r.changes.length ? r.changes : [''],
    });
    setModalOpen(true);
  };

  const save = async () => {
    const values = await form.validateFields();
    const body = {
      version: values.version,
      date: values.date?.format('YYYY-MM-DD') || '',
      changes: (values.changes || []).filter(Boolean),
    };
    const url = editing ? `/api/admin/versions/${editing.id}` : '/api/admin/versions';
    const method = editing ? 'PUT' : 'POST';
    const r = await fetch(url, {
      method, headers: headers(), body: JSON.stringify(body),
    });
    if (r.ok) {
      message.success(editing ? '已保存' : '已发布');
      setModalOpen(false);
      load();
    } else {
      const d = await r.json();
      message.error(d.message || '操作失败');
    }
  };

  const columns = [
    { title: '版本', dataIndex: 'version', width: 100, render: (v: string) => <Tag color="blue">v{v}</Tag> },
    { title: '日期', dataIndex: 'date', width: 110 },
    { title: '变更', key: 'changes', render: (_: any, r: any) => (
      <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: '#555' }}>
        {r.changes.slice(0, 3).map((c: string, i: number) => <li key={i}>{c}</li>)}
        {r.changes.length > 3 && <li style={{ color: '#bfbfbf' }}>…共 {r.changes.length} 条</li>}
      </ul>
    )},
    { title: '操作', key: 'ops', width: 130, render: (_: any, r: any) => (
      <Space size={4}>
        <Button size="small" onClick={() => openEdit(r)}>编辑</Button>
        <Popconfirm title={`确定删除 v${r.version}？`} onConfirm={async () => {
          await fetch(`/api/admin/versions/${r.id}`, { method: 'DELETE', headers: headers() });
          message.success('已删除'); load();
        }}>
          <Button size="small" danger>删除</Button>
        </Popconfirm>
      </Space>
    )},
  ];

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <Button type="primary" size="small" icon={<PlusOutlined />} onClick={openCreate}>
          发布新版本
        </Button>
      </div>
      <Table dataSource={versions} columns={columns} rowKey="id" loading={loading} size="small"
        pagination={{ pageSize: 8, showTotal: (t) => `共 ${t} 个版本` }} />

      <Modal
        open={modalOpen} onCancel={() => setModalOpen(false)}
        title={editing ? `编辑 v${editing.version}` : '发布新版本'} width={480}
        onOk={save}
      >
        <Form form={form} labelCol={{ span: 5 }} wrapperCol={{ span: 17 }}>
          <Form.Item name="version" label="版本号" rules={[
            { required: true, message: '必填' },
            { pattern: /^\d+\.\d+\.\d+/, message: '格式如 1.0.0' },
          ]}>
            <Input placeholder="1.0.0" maxLength={20} />
          </Form.Item>
          <Form.Item name="date" label="发布日期" rules={[{ required: true }]}>
            <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
          </Form.Item>
          <Form.Item label="变更说明" required>
            <Form.List name="changes">
              {(fields, { add, remove }) => (
                <>
                  {fields.map(({ key, name, ...restField }) => (
                    <Space key={key} style={{ display: 'flex', marginBottom: 4 }} align="baseline">
                      <Form.Item {...restField} name={name} style={{ margin: 0, flex: 1 }} noStyle>
                        <Input placeholder="✨ 新增了… / 🎨 优化了… / 🐛 修复了…" style={{ width: 320 }} />
                      </Form.Item>
                      <DeleteOutlined onClick={() => remove(name)} style={{ color: '#999', cursor: 'pointer' }} />
                    </Space>
                  ))}
                  <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={() => add()} block>
                    添加一条
                  </Button>
                </>
              )}
            </Form.List>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
