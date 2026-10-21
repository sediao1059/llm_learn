import { useState } from 'react';
import { Modal, Tabs, Form, Input, Button, Radio, Checkbox, Tooltip, message } from 'antd';
import { useAuth } from '../store/auth';

// 「记住账号密码」只存本机浏览器；密码 base64 遮蔽（防直视，非加密），公用电脑不应勾选
const REMEMBER_KEY = 'llm_learn_remember_login';

function loadRemembered() {
  try {
    const saved = JSON.parse(localStorage.getItem(REMEMBER_KEY) || '');
    return {
      username: typeof saved.username === 'string' ? saved.username : '',
      password: typeof saved.password === 'string' ? decodeURIComponent(atob(saved.password)) : '',
      remember: true,
    };
  } catch {
    return { username: '', password: '', remember: false };
  }
}

function saveRemembered(username: string, password: string, remember: boolean) {
  if (remember && username && password) {
    localStorage.setItem(REMEMBER_KEY, JSON.stringify({
      username,
      password: btoa(encodeURIComponent(password)),
    }));
  } else {
    localStorage.removeItem(REMEMBER_KEY);
  }
}

export default function LoginModal({
  open, onClose, onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const { login, register } = useAuth();
  const [mode, setMode] = useState('login');
  const [loading, setLoading] = useState(false);

  const onFinish = async (values: any) => {
    setLoading(true);
    try {
      if (mode === 'login') {
        await login(values.username, values.password);
        saveRemembered(values.username, values.password, !!values.remember);
      } else {
        await register(values);
      }
      message.success(mode === 'login' ? '登录成功' : '注册成功');
      onClose();
      onSuccess?.();
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
          <Form onFinish={onFinish} labelCol={{ span: 6 }} wrapperCol={{ span: 16 }} initialValues={loadRemembered()}>
            <Form.Item name="username" label="用户名" rules={[{ required: true }]}>
              <Input maxLength={20} />
            </Form.Item>
            <Form.Item name="password" label="密码" rules={[{ required: true }]}>
              <Input.Password maxLength={64} />
            </Form.Item>
            <Tooltip title="勾选后，账号和密码会记在这台电脑的浏览器里，下次打开自动填好、不用再手动输入。公用电脑请不要勾选。">
              <Form.Item name="remember" valuePropName="checked" wrapperCol={{ offset: 6, span: 16 }}>
                <Checkbox>记住账号密码</Checkbox>
              </Form.Item>
            </Tooltip>
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
