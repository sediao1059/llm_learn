import { useEffect, useState, useRef } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Button, Tag, Space, Tooltip, message } from 'antd';
import {
  MessageOutlined, BulbOutlined, InboxOutlined, CommentOutlined,
} from '@ant-design/icons';
import { useAuth } from '../store/auth';
import { useTour, isTourDone } from '../store/tour';
import LoginModal from './LoginModal';
import ProfileModal from './ProfileModal';
import AssistantDrawer from './AssistantDrawer';
import HistoryPopup from './HistoryPopup';
import FavoritesPopup from './FavoritesPopup';
import NodeReadDrawer from './NodeReadDrawer';
import MyAnnotationsModal from './MyAnnotationsModal';
import DepositCenterModal from './DepositCenterModal';
import FeedbackModal from './FeedbackModal';
import GuideTour from './GuideTour';

const { Header, Content } = Layout;

/** 需要登录才能访问的路径 */
const AUTH_REQUIRED = ['/paths', '/upload', '/mine'];

export default function AppLayout() {
  const nav = useNavigate();
  const loc = useLocation();
  const { user, loading, logout, refresh } = useAuth();
  const startTour = useTour((s) => s.start);
  const [loginOpen, setLoginOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [myAnnoOpen, setMyAnnoOpen] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  // 足迹/收藏点行：在当前页原地打开笔记浮窗（不跳转图谱页）
  const [readNodeId, setReadNodeId] = useState<string | null>(null);
  const [version, setVersion] = useState('');
  const [verDate, setVerDate] = useState('');
  const [verChanges, setVerChanges] = useState<string[]>([]);
  const pendingNav = useRef<string | null>(null);

  /** 未登录时点击需登录的功能：引导登录 */
  const requireLogin = () => {
    setLoginOpen(true);
    message.info('请先登录后使用该功能');
  };

  /** 我的注解/沉淀中心 → 回到图谱页并打开那篇笔记 */
  const openNode = (nodeId: string) => {
    nav(`/?node=${encodeURIComponent(nodeId)}`);
  };

  useEffect(() => { refresh(); }, []);

  /** 新手引导自动触发（一次性，看过即存 localStorage 不再自动弹）：
   *  游客在首页看「图谱怎么用 + 引导登录/反馈」；登录/注册成功后看「学习路线 + AI 助手 + 划词注解」 */
  useEffect(() => {
    if (loading) return;
    if (!user && loc.pathname === '/' && !isTourDone('guest')) startTour('guest');
    if (user && !isTourDone('user')) startTour('user');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user, loc.pathname]);

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
    { key: '/library', label: '📚 知识库' },
    { key: '/recent', label: '🆕 最近更新' },
    { key: '/paths', label: '🗺 学习路线' },
    { key: '/upload', label: '📤 上传知识' },
    { key: '/mine', label: '📋 我的提交' },
    ...(user?.role === 'admin' ? [{ key: '/admin', label: '🛡 管理' }] : []),
  ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: '#fff', borderBottom: '1px solid #e5e6eb', padding: '0 20px', height: 56,
      }}>
        <div id="app-nav-menu" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
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
            <Button size="small" id="app-assistant-btn" type={user ? 'primary' : 'default'} ghost={!!user}
              icon={<MessageOutlined />}
              onClick={() => (user ? setAssistantOpen(true) : requireLogin())}>
              助手
            </Button>
          </Tooltip>
          <Tooltip title="意见或 bug 反馈：登录前后都能提，开发者会在后台看到">
            <Button size="small" id="app-feedback-btn" icon={<CommentOutlined />}
              onClick={() => setFeedbackOpen(true)}>
              反馈
            </Button>
          </Tooltip>
          <Tooltip title="新手引导 · 随时重看">
            <Button
              size="small" type="text" id="app-guide-btn"
              className={!user && !loading ? 'guide-bulb-blink' : undefined}
              icon={<BulbOutlined style={{ color: '#faad14', fontSize: 16 }} />}
              onClick={() => startTour(user ? 'user' : 'guest')}
            />
          </Tooltip>
          {user && (
            <>
              <HistoryPopup onOpenNode={setReadNodeId} />
              <FavoritesPopup onOpenNode={setReadNodeId} />
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
            <Button size="small" id="app-login-btn" onClick={() => setLoginOpen(true)}>登录 / 注册</Button>
          )}
        </Space>
      </Header>
      <Content><Outlet /></Content>

      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} onSuccess={onLoginSuccess} />
      <FeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
      <GuideTour openAssistant={setAssistantOpen} openNode={setReadNodeId} />
      {user && <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} />}

      {/* 全局 AI 助手抽屉（个人会话 + 沉淀为知识点） */}
      <AssistantDrawer open={assistantOpen} onClose={() => setAssistantOpen(false)} />
      {user && (
        <>
          <MyAnnotationsModal open={myAnnoOpen} onClose={() => setMyAnnoOpen(false)}
            onOpenNode={openNode} onOpenPath={() => nav('/paths')} />
          <DepositCenterModal open={depositOpen} onClose={() => setDepositOpen(false)}
            onOpenNode={openNode} />
          {/* 足迹/收藏点行打开的笔记浮窗：与图谱页同一个，任意页面原地弹出 */}
          <NodeReadDrawer open={!!readNodeId} onClose={() => setReadNodeId(null)} nodeId={readNodeId} />
        </>
      )}
    </Layout>
  );
}
