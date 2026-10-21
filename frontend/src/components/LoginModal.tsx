import { useState } from 'react';
import { Modal, Tabs, Form, Input, Button, Radio, message } from 'antd';
import { useAuth } from '../store/auth';

export default function LoginModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { login, register } = useAuth();
  const [mode, setMode] = useState('login');
  const [loading, setLoading] = useState(false);

  const onFinish = async (values: any) => {
    setLoading(true);
    try {
      if (mode === 'login') {
        await login(values.username, values.password);
      } else {
        await register(values);
      }
      message.success(mode === 'login' ? '登录成功' : '注册成功');
      onClose();
    } catch (e: any) {
      message.error(e?.response?.data?.message || e?.response?.data?.error || '操作失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onCancel={onClose} footer={null} width={420} title={mode === 'login' ? '登录' : '注册'}>
      <Tabs activeKey={mode} onChange={setMode} items={[
        { key: 'login', label: '登录', children: (
          <Form onFinish={onFinish} labelCol={{ span: 6 }} wrapperCol={{ span: 16 }}>
            <Form.Item name="username" label="用户名" rules={[{ required: true }]}>
              <Input maxLength={20} />
            </Form.Item>
            <Form.Item name="password" label="密码" rules={[{ required: true }]}>
              <Input.Password maxLength={64} />
            </Form.Item>
            <Button type="primary" htmlType="submit" block loading={loading}>登录</Button>
          </Form>
        )},
        { key: 'register', label: '注册', children: (
          <Form onFinish={onFinish} labelCol={{ span: 8 }} wrapperCol={{ span: 16 }} initialValues={{ level: 'novice' }}>
            <Form.Item name="username" label="用户名" rules={[{ required: true }]}>
              <Input maxLength={20} />
            </Form.Item>
            <Form.Item name="password" label="密码" rules={[{ required: true, min: 4 }]}>
              <Input.Password maxLength={64} />
            </Form.Item>
            <Form.Item name="nickname" label="昵称（可选）">
              <Input maxLength={20} />
            </Form.Item>
            <Form.Item name="inviteCode" label="邀请码" rules={[{ required: true, message: '请向管理员索取' }]}>
              <Input maxLength={32} />
            </Form.Item>
            <Form.Item name="level" label="大模型经验">
              <Radio.Group>
                <Radio.Button value="novice">🐣 新手</Radio.Button>
                <Radio.Button value="expert">🦅 老手</Radio.Button>
              </Radio.Group>
            </Form.Item>
            <Button type="primary" htmlType="submit" block loading={loading}>注册并登录</Button>
          </Form>
        )},
      ]} />
    </Modal>
  );
}
