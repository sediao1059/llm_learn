import { useEffect, useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Button, Modal, Form, Input, Select, Radio, message, Space, Tag, App } from 'antd';
import { useAuth } from '../store/auth';
import LoginModal from './LoginModal';
import ProfileModal from './ProfileModal';

const { Header, Content } = Layout;

export default function AppLayout() {
  const nav = useNavigate();
  const loc = useLocation();
  const { user, logout, refresh } = useAuth();
  const [loginOpen, setLoginOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  useEffect(() => { refresh(); }, []);

  const items = [
    { key: '/', label: '🧠 知识图谱' },
    { key: '/paths', label: '🗺 学习路线' },
    { key: '/upload', label: '📤 上传知识' },
    ...(user?.role === 'admin' ? [{ key: '/admin', label: '🛡 管理' }] : []),
  ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: '#fff', borderBottom: '1px solid #e5e6eb', padding: '0 20px', height: 56,
      }}>
        <Menu
          mode="horizontal" selectedKeys={[loc.pathname]} items={items}
          onClick={({ key }) => nav(key)}
          style={{ flex: 1, borderBottom: 'none', background: 'transparent' }}
        />
        <Space>
          {user ? (
            <>
              <span style={{ fontSize: 13 }}>
                👤 {user.nickname || user.username}
                {user.role === 'admin' && <Tag color="success" style={{ marginLeft: 4 }}>管理员</Tag>}
              </span>
              <Button size="small" onClick={() => setProfileOpen(true)}>⚙ 我的</Button>
              <Button size="small" onClick={() => logout()}>退出</Button>
            </>
          ) : (
            <Button size="small" onClick={() => setLoginOpen(true)}>登录 / 注册</Button>
          )}
        </Space>
      </Header>
      <Content><Outlet /></Content>

      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
      {user && <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} />}
    </Layout>
  );
}
