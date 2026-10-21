import { useEffect, useState } from 'react';
import { Modal, Form, Input, Radio, Checkbox, Button, message, Statistic, Divider } from 'antd';
import { useAuth } from '../store/auth';
import { api } from '../api/client';

const FOCUS = [
  { k: 'rag', label: '应用与RAG' }, { k: 'agent', label: 'Agent开发' },
  { k: 'train', label: '训练微调' }, { k: 'infra', label: '推理部署' },
];

export default function ProfileModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, updateProfile } = useAuth();
  const [form] = Form.useForm();
  const [contrib, setContrib] = useState({ total: 0, days: [] as any[] });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && user) {
      form.setFieldsValue({
        nickname: user.nickname, phone: user.phone, email: user.email,
        level: user.profileTags?.level, focus: user.profileTags?.focus || [],
      });
      api.get('/contributions/me').then(r => setContrib(r.data)).catch(() => {});
    }
  }, [open, user]);

  const onSave = async () => {
    const values = await form.validateFields();
    setLoading(true);
    try {
      await updateProfile(values);
      message.success('已保存');
      onClose();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '保存失败');
    } finally { setLoading(false); }
  };

  const activeDays = contrib.days.filter((d: any) => d.count > 0).length;

  return (
    <Modal open={open} onCancel={onClose} title="⚙ 我的 · 用户画像" footer={[
      <Button key="cancel" onClick={onClose}>取消</Button>,
      <Button key="save" type="primary" loading={loading} onClick={onSave}>保存</Button>,
    ]}>
      <div style={{ marginBottom: 12 }}>
        <Statistic title="累计贡献分" value={contrib.total} style={{ display: 'inline-block', marginRight: 24 }} />
        <span style={{ color: '#909399', fontSize: 13 }}>近 90 天活跃 {activeDays} 天</span>
      </div>
      <Divider />
      <Form form={form} labelCol={{ span: 6 }} wrapperCol={{ span: 16 }}>
        <Form.Item name="nickname" label="昵称"><Input maxLength={20} /></Form.Item>
        <Form.Item name="phone" label="手机号"><Input maxLength={11} /></Form.Item>
        <Form.Item name="email" label="邮箱"><Input maxLength={120} /></Form.Item>
        <Form.Item name="level" label="大模型经验">
          <Radio.Group>
            <Radio.Button value="novice">🐣 新手</Radio.Button>
            <Radio.Button value="expert">🦅 老手</Radio.Button>
          </Radio.Group>
        </Form.Item>
        <Form.Item name="focus" label="方向偏好">
          <Checkbox.Group options={FOCUS.map(f => ({ label: f.label, value: f.k }))} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
