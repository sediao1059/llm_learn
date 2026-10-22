import { useState } from 'react';
import { Modal, Form, Input, Button, Tooltip, message } from 'antd';
import { useAuth } from '../store/auth';
import { api } from '../api/client';

/** 意见反馈：登录前后都能提；登录后自动关联账号（无需填联系方式） */
export default function FeedbackModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);

  const onFinish = async (values: any) => {
    setLoading(true);
    try {
      await api.post('/feedback', { content: values.content, contact: values.contact });
      message.success('感谢反馈！我们会尽快查看');
      onClose();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '提交失败，请稍后再试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onCancel={onClose} footer={null} width={440} title="💬 意见反馈">
      <Form onFinish={onFinish} layout="vertical">
        <Form.Item
          name="content"
          label="你的意见或发现的 bug"
          rules={[
            { required: true, message: '请写下内容' },
            { min: 5, message: '至少 5 个字' },
          ]}
        >
          <Input.TextArea
            rows={4} maxLength={1000} showCount
            placeholder="比如：某个页面打不开了 / 希望增加××功能 / 某篇笔记有写错的地方…"
          />
        </Form.Item>
        {!user && (
          <Tooltip title="选填。想收到回复就留一个联系方式（如邮箱），不填也完全可以。">
            <Form.Item name="contact" label="联系方式（可选）">
              <Input maxLength={50} placeholder="邮箱 / 微信等，不填则匿名" />
            </Form.Item>
          </Tooltip>
        )}
        {user && (
          <div style={{ fontSize: 12, color: '#86909c', marginBottom: 12 }}>
            将以「{user.nickname || user.username}」的名义提交
          </div>
        )}
        <Button type="primary" htmlType="submit" block loading={loading}>提交反馈</Button>
      </Form>
    </Modal>
  );
}
