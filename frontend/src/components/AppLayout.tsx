import { useEffect, useState, useRef } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Button, Tag, Space, Tooltip, message } from 'antd';
import {
  MessageOutlined, BulbOutlined, InboxOutlined,
} from '@ant-design/icons';
import { useAuth } from '../store/auth';
import LoginModal from './LoginModal';
import ProfileModal from './ProfileModal';
import AssistantDrawer from './AssistantDrawer';
import HistoryPopup from './HistoryPopup';
import FavoritesPopup from './FavoritesPopup';
import MyAnnotationsModal from './MyAnnotationsModal';
import DepositCenterModal from './DepositCenterModal';

const { Header, Content } = Layout;

/** 需要登录才能访问的路径 */
const AUTH_REQUIRED = ['/paths', '/upload'];

export default function AppLayout() {
  const nav = useNavigate();
  const loc = useLocation();
  const { user, logout, refresh } = useAuth();
  const [loginOpen, setLoginOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [myAnnoOpen, setMyAnnoOpen] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const [version, setVersion] = useState('');
  const [verDate, setVerDate] = useState('');
  const [verChanges, setVerChanges] = useState<string[]>([]);
  const pendingNav = useRef<string | null>(null);

  /** 未登录时点击需登录的功能：引导登录 */
  const requireLogin = () => {
    setLoginOpen(true);
    message.info('请先登录后使用该功能');
  };

  /** 足迹/收藏/我的注解/沉淀中心 → 回到图谱页并打开那篇笔记 */
  const openNode = (nodeId: string) => {
    nav(`/?node=${encodeURIComponent(nodeId)}`);
  };

  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    fetch('/api/versions/latest')
      .then(r => r.json())
      .then(d => {
        setVersion(d.version || '');
        setVerDate(d.date || '');
        setVerChanges(d.changes || []);
      })
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
            onClick={onNavClick} disabledOverflow
            style={{ borderBottom: 'none', background: 'transparent' }}
          />
          {version && (
            <Tooltip
              placement="bottom"
              title={
                <div style={{ maxWidth: 600 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>
                    🚀 本次更新 v{version}{verDate ? `（${verDate}）` : ''}
                  </div>
                  {verChanges.length ? (
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {verChanges.map((c, i) => (
                        <li key={i} style={{ lineHeight: '22px' }}>{c}</li>
                      ))}
                    </ul>
                  ) : (
                    <span>暂无更新说明</span>
                  )}
                </div>
              }
            >
              <Tag
                color="blue"
                style={{
                  cursor: 'pointer', fontSize: 11, lineHeight: '18px',
                  padding: '0 6px', borderRadius: 4, fontWeight: 600,
                }}
              >
                v{version}
              </Tag>
            </Tooltip>
          )}
        </div>
        <Space>
          <Tooltip title="全局 AI 助手：随时提问，满意可沉淀为知识点">
            <Button size="small" type={user ? 'primary' : 'default'} ghost={!!user}
              icon={<MessageOutlined />}
              onClick={() => (user ? setAssistantOpen(true) : requireLogin())}>
              助手
            </Button>
          </Tooltip>
          {user && (
            <>
              <HistoryPopup onOpenNode={openNode} />
              <FavoritesPopup onOpenNode={openNode} />
              <Tooltip title="我划词沉淀过的全部注解">
                <Button size="small" icon={<BulbOutlined />}
                  onClick={() => setMyAnnoOpen(true)}>注解</Button>
              </Tooltip>
              {user.role !== 'admin' && (
                <Tooltip title="我提交的知识点沉淀进度">
                  <Button size="small" icon={<InboxOutlined />}
                    onClick={() => setDepositOpen(true)}>沉淀</Button>
                </Tooltip>
              )}
            </>
          )}
          <Tooltip title="联系开发者">
            <a href="mailto:sediao666@qq.com" style={{ fontSize: 12, color: '#86909c' }}>
              ✉ sediao666@qq.com
            </a>
          </Tooltip>
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

      {/* 全局 AI 助手抽屉（全员共享会话池 + 沉淀为知识点） */}
      <AssistantDrawer open={assistantOpen} onClose={() => setAssistantOpen(false)} />
      {user && (
        <>
          <MyAnnotationsModal open={myAnnoOpen} onClose={() => setMyAnnoOpen(false)}
            onOpenNode={openNode} onOpenPath={() => nav('/paths')} />
          <DepositCenterModal open={depositOpen} onClose={() => setDepositOpen(false)}
            onOpenNode={openNode} />
        </>
      )}
    </Layout>
  );
}
