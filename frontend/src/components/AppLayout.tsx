import { useEffect, useState, useRef } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Button, Tag, Space, Tooltip, message } from 'antd';
import { useAuth } from '../store/auth';
import LoginModal from './LoginModal';
import ProfileModal from './ProfileModal';
import ChangelogDrawer from './ChangelogDrawer';

const { Header, Content } = Layout;

/** 需要登录才能访问的路径 */
const AUTH_REQUIRED = ['/paths', '/upload'];

export default function AppLayout() {
  const nav = useNavigate();
  const loc = useLocation();
  const { user, logout, refresh } = useAuth();
  const [loginOpen, setLoginOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [version, setVersion] = useState('');
  const pendingNav = useRef<string | null>(null);

  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    fetch('/api/versions/latest')
      .then(r => r.json())
      .then(d => setVersion(d.version || ''))
      .catch(() => {});
  }, []);

  const onNavClick = ({ key }: { key: string }) => {
    if (AUTH_REQUIRED.includes(key) && !user) {
      pendingNav.current = key;
      setLoginOpen(true);
      message.info('请先登录后使用该功能');
      return;
    }
    nav(key);
  };

  const onLoginSuccess = () => {
    setLoginOpen(false);
    if (pendingNav.current) {
      const target = pendingNav.current;
      pendingNav.current = null;
      nav(target);
    }
  };

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Menu
            mode="horizontal" selectedKeys={[loc.pathname]} items={items}
            onClick={onNavClick}
            style={{ borderBottom: 'none', background: 'transparent' }}
          />
          {version && (
            <Tooltip title="查看更新日志" placement="bottom">
              <Tag
                color="blue"
                style={{
                  cursor: 'pointer', fontSize: 11, lineHeight: '18px',
                  padding: '0 6px', borderRadius: 4, fontWeight: 600,
                }}
                onClick={() => setChangelogOpen(true)}
              >
                v{version}
              </Tag>
            </Tooltip>
          )}
        </div>
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

      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} onSuccess={onLoginSuccess} />
      {user && <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} />}
      <ChangelogDrawer open={changelogOpen} onClose={() => setChangelogOpen(false)} />
    </Layout>
  );
}
