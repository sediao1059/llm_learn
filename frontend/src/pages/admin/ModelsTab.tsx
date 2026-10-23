import { useCallback, useEffect, useState } from 'react';
import {
  Table, Button, Tag, Drawer, Form, Input, InputNumber, Select, Switch, Space,
  Popconfirm, Tooltip, message,
} from 'antd';
import { PlusOutlined, ApiOutlined } from '@ant-design/icons';
import { trackLlmCall } from '../../utils/llmQueueNotice';

const TOKEN = () => localStorage.getItem('llm_learn_token');

async function req(path: string, method: string, body?: any) {
  const r = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN()}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.message || `HTTP ${r.status}`);
  return d;
}

/** 管理页「模型配置」：LLM 模型 CRUD + 测试连通 + 全局默认切换（SPEC §4.1） */
export default function ModelsTab() {
  const [models, setModels] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null); // null = 新增
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [form] = Form.useForm();

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/llm/models', { headers: { Authorization: `Bearer ${TOKEN()}` } })
      .then(r => r.json())
      .then(d => setModels(d.models || []))
      .catch(() => message.error('加载模型列表失败'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ protocol: 'openai', maxTokens: 8192, status: true });
    setEditOpen(true);
  };

  const openEdit = (m: any) => {
    setEditing(m);
    form.setFieldsValue({
      name: m.name, protocol: m.protocol, baseUrl: m.baseUrl,
      apiKey: '', // 编辑时留空表示沿用原 Key（列表只有脱敏值）
      modelId: m.modelId, maxTokens: m.maxTokens || 8192, status: m.status === 'enabled',
    });
    setEditOpen(true);
  };

  const save = async () => {
    const v = await form.validateFields();
    setSaving(true);
    try {
      const body = {
        name: v.name, protocol: v.protocol, baseUrl: v.baseUrl,
        modelId: v.modelId, maxTokens: v.maxTokens,
        status: v.status ? 'enabled' : 'disabled',
        ...(v.apiKey ? { apiKey: v.apiKey } : {}),
      };
      if (editing) await req(`/llm/models/${editing.id}`, 'PUT', body);
      else await req('/llm/models', 'POST', body);
      message.success('已保存');
      setEditOpen(false);
      load();
    } catch (e: any) { message.error(e.message || '保存失败'); }
    finally { setSaving(false); }
  };

  const test = async (m: any) => {
    setTestingId(m.id);
    try {
      await trackLlmCall(req(`/llm/models/${m.id}/test`, 'POST'));
      message.success(`「${m.name}」连接成功`);
    } catch (e: any) { message.error(`「${m.name}」连接失败：${e.message}`); }
    finally { setTestingId(null); }
  };

  const toggleStatus = async (m: any) => {
    try {
      await req(`/llm/models/${m.id}`, 'PUT', { status: m.status === 'enabled' ? 'disabled' : 'enabled' });
      load();
    } catch (e: any) { message.error(e.message); }
  };

  const setGlobal = async (m: any) => {
    try {
      await req(`/llm/models/${m.id}/global`, 'PUT');
      message.success(`已把「${m.name}」设为全局默认`);
      load();
    } catch (e: any) { message.error(e.message); }
  };

  const remove = async (m: any) => {
    try {
      await req(`/llm/models/${m.id}`, 'DELETE');
      message.success('已删除');
      load();
    } catch (e: any) { message.error(e.message); }
  };

  const columns = [
    {
      title: '全局', dataIndex: 'isGlobal', width: 76,
      render: (v: boolean, r: any) => v
        ? <Tag color="gold">⭐ 默认</Tag>
        : (r.status === 'enabled'
          ? <Tooltip title="设为全局默认（对话与 AI 功能默认用它）">
              <Button size="small" type="link" onClick={() => setGlobal(r)}>设默认</Button>
            </Tooltip>
          : '—'),
    },
    { title: '名称', dataIndex: 'name', width: 140 },
    {
      title: '协议', dataIndex: 'protocol', width: 90,
      render: (v: string) => v === 'anthropic'
        ? <Tag color="purple">anthropic</Tag>
        : <Tag color="blue">openai 兼容</Tag>,
    },
    { title: 'Base URL', dataIndex: 'baseUrl', ellipsis: true,
      render: (v: string) => <span style={{ fontSize: 12, fontFamily: 'monospace' }}>{v}</span> },
    { title: '模型 ID', dataIndex: 'modelId', width: 160, ellipsis: true,
      render: (v: string) => <span style={{ fontSize: 12, fontFamily: 'monospace' }}>{v}</span> },
    { title: 'API Key', dataIndex: 'apiKeyMasked', width: 120,
      render: (v: string) => <span style={{ fontSize: 12, fontFamily: 'monospace' }}>{v || '—'}</span> },
    { title: '最大输出', dataIndex: 'maxTokens', width: 84,
      render: (v: number) => v || 8192 },
    {
      title: '状态', dataIndex: 'status', width: 76,
      render: (v: string, r: any) => (
        <Switch size="small" checked={v === 'enabled'}
          checkedChildren="启用" unCheckedChildren="停用"
          onChange={() => toggleStatus(r)} />
      ),
    },
    {
      title: '操作', key: 'ops', width: 210,
      render: (_: any, r: any) => (
        <Space size={4}>
          <Button size="small" icon={<ApiOutlined />} loading={testingId === r.id}
            onClick={() => test(r)}>测试连接</Button>
          <Button size="small" onClick={() => openEdit(r)}>编辑</Button>
          <Popconfirm title={`删除模型「${r.name}」？`} onConfirm={() => remove(r)}>
            <Button size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: '#8c8c8c', fontSize: 12 }}>
          对话与所有 AI 功能默认用「全局默认」模型；首个启用的模型自动成为全局默认。密钥明文存库、列表脱敏显示。
        </span>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增模型</Button>
      </div>
      <Table
        dataSource={models} columns={columns} rowKey="id"
        loading={loading} pagination={false} scroll={{ x: 1000 }}
      />

      <Drawer
        open={editOpen} onClose={() => setEditOpen(false)}
        title={editing ? `编辑模型：${editing.name}` : '新增模型'} width={420}
        extra={<Button type="primary" loading={saving} onClick={save}>保存</Button>}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请填名称' }]}>
            <Input placeholder="如：DeepSeek-V3" maxLength={100} />
          </Form.Item>
          <Form.Item name="protocol" label="协议" rules={[{ required: true }]}>
            <Select options={[
              { value: 'openai', label: 'openai 兼容（DeepSeek / GLM / Qwen / GPT 等）' },
              { value: 'anthropic', label: 'anthropic（Claude）' },
            ]} />
          </Form.Item>
          <Form.Item name="baseUrl" label="Base URL"
            rules={[{ required: true, message: '请填 Base URL' }, { pattern: /^https?:\/\//, message: '需以 http(s):// 开头' }]}>
            <Input placeholder="https://api.deepseek.com（自动补 /v1，带不带版本段都行）" />
          </Form.Item>
          <Form.Item name="apiKey" label={editing ? 'API Key（留空 = 不修改）' : 'API Key'}
            rules={editing ? [] : [{ required: true, message: '请填 API Key' }]}>
            <Input.Password placeholder={editing ? '••••（原密钥已保存）' : 'sk-…'} autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="modelId" label="模型 ID" rules={[{ required: true, message: '请填模型 ID' }]}>
            <Input placeholder="如：deepseek-chat" maxLength={150} />
          </Form.Item>
          <Form.Item name="maxTokens" label="单次最大输出 tokens"
            rules={[{ required: true, message: '请填' }]}>
            <InputNumber min={256} max={131072} step={256} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="status" label="启用状态" valuePropName="checked">
            <Switch checkedChildren="启用" unCheckedChildren="停用" />
          </Form.Item>
          <p style={{ color: '#8c8c8c', fontSize: 12 }}>
            「测试连接」会用该配置真发一句话验证可用，不是 ping。
          </p>
        </Form>
      </Drawer>
    </>
  );
}
