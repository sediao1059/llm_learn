import { useEffect, useState, useRef } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Button, Tag, Space, Tooltip, message, Drawer, Dropdown } from 'antd';
import {
  MessageOutlined, BulbOutlined, InboxOutlined, CommentOutlined,
  MenuOutlined, UserOutlined, SettingOutlined, LogoutOutlined,
} from '@ant-design/icons';
import { useAuth } from '../store/auth';
import { useTour, isTourDone } from '../store/tour';
import { useResponsive } from '../hooks/useResponsive';
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
  // 手机 / iPad 竖屏（<1024px）顶栏折叠：左侧导航收进汉堡抽屉、右侧按钮图标化、用户区收进下拉
  const { isMobile, isPad } = useResponsive();
  const compact = isMobile || isPad;
  const [navOpen, setNavOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [myAnnoOpen, setMyAnnoOpen] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  // 足迹/收藏点行：在当前页原地打开笔记浮窗（不跳转图谱页）
  const [readNodeId, setReadNodeId] = useState<string | null>(null);
  // 版本徽章：hover 展示最近几个版本的更新说明（只含用户可见条目，全部隐藏的版本后端已跳过）
  const [verList, setVerList] = useState<{ version: string; date: string; changes: string[] }[]>([]);
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
   *  游客在首页看「图谱怎么用 + 引导登录/反馈」；登录/注册成功后看「学习路线 + AI 助手 + 划词注解」。
   *  引导播放中（含跨页跳转导致 pathname 变化）不重复触发——否则步骤被重置回第 0 步、
   *  页面来回跳转形成导航死循环（表现为浏览器闪烁刷新 + 灰色遮罩反复出现） */
  const tourActive = useTour((s) => s.type !== null);
  useEffect(() => {
    if (loading || tourActive) return;
    if (!user && loc.pathname === '/' && !isTourDone('guest')) startTour('guest');
    if (user && !isTourDone('user')) startTour('user');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user, loc.pathname, tourActive]);

  useEffect(() => {
    fetch('/api/versions')
      .then(r => r.json())
      .then(d => setVerList((d.versions || []).slice(0, 3)))
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

  /** 汉堡导航抽屉内的菜单点击：先收起抽屉再走原导航逻辑（含登录拦截） */
  const onDrawerNavClick = (e: { key: string }) => {
    setNavOpen(false);
    onNavClick(e);
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
        {compact ? (
          <div id="app-nav-menu" style={{ display: 'flex', alignItems: 'center' }}>
            <Tooltip title="导航菜单">
              <Button size="small" type="text" aria-label="导航菜单"
                icon={<MenuOutlined style={{ fontSize: 16 }} />} onClick={() => setNavOpen(true)} />
            </Tooltip>
          </div>
        ) : (
        <div id="app-nav-menu" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Menu
            mode="horizontal" selectedKeys={[loc.pathname]} items={items}
            onClick={onNavClick} disabledOverflow
            style={{ borderBottom: 'none', background: 'transparent' }}
          />
          {verList.length > 0 && (
            <Tooltip
              placement="bottom"
              title={
                <div style={{ maxWidth: 600 }}>
                  {verList.map((v, i) => (
                    <div key={i} style={i ? { marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.18)' } : undefined}>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>
                        {i === 0 ? '🚀 ' : ''}v{v.version}{v.date ? `（${v.date}）` : ''}
                      </div>
                      {v.changes.length ? (
                        <ul style={{ margin: 0, paddingLeft: 18 }}>
                          {v.changes.map((c, j) => (
                            <li key={j} style={{ lineHeight: '22px' }}>{c}</li>
                          ))}
                        </ul>
                      ) : (
                        <span>暂无更新说明</span>
                      )}
                    </div>
                  ))}
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
                v{verList[0].version}
              </Tag>
            </Tooltip>
          )}
        </div>
        )}
        <Space size={compact ? 4 : 8}>
          <Tooltip title="全局 AI 助手：随时提问，满意可沉淀为知识点">
            <Button size="small" id="app-assistant-btn" type={user ? 'primary' : 'default'} ghost={!!user}
              icon={<MessageOutlined />}
              onClick={() => (user ? setAssistantOpen(true) : requireLogin())}>
              {compact ? null : '助手'}
            </Button>
          </Tooltip>
          <Tooltip title="意见或 bug 反馈：登录前后都能提，开发者会在后台看到">
            <Button size="small" id="app-feedback-btn" icon={<CommentOutlined />}
              onClick={() => setFeedbackOpen(true)}>
              {compact ? null : '反馈'}
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
              <HistoryPopup onOpenNode={setReadNodeId} compact={compact} />
              <FavoritesPopup onOpenNode={setReadNodeId} compact={compact} />
              <Tooltip title="我划词沉淀过的全部注解">
                <Button size="small" icon={<BulbOutlined />}
                  onClick={() => setMyAnnoOpen(true)}>{compact ? null : '注解'}</Button>
              </Tooltip>
              {user.role !== 'admin' && (
                <Tooltip title="我提交的知识点沉淀进度">
                  <Button size="small" icon={<InboxOutlined />}
                    onClick={() => setDepositOpen(true)}>{compact ? null : '沉淀'}</Button>
                </Tooltip>
              )}
            </>
          )}
          {!compact && (
            <Tooltip title="联系开发者">
              <a href="mailto:sediao666@qq.com" style={{ fontSize: 12, color: '#86909c' }}>
                ✉ sediao666@qq.com
              </a>
            </Tooltip>
          )}
          {user ? (
            compact ? (
              <Dropdown
                menu={{
                  items: [
                    { key: 'profile', icon: <SettingOutlined />, label: '⚙ 我的（个人中心）' },
                    ...(user.role === 'admin' ? [{ key: 'admin', label: '🛡 管理' }] : []),
                    { type: 'divider' as const },
                    { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', danger: true },
                  ],
                  onClick: ({ key }: { key: string }) => {
                    if (key === 'profile') setProfileOpen(true);
                    else if (key === 'admin') nav('/admin');
                    else if (key === 'logout') logout();
                  },
                }}
              >
                <Button size="small" icon={<UserOutlined />}>
                  {(user.nickname || user.username).slice(0, 6)}
                </Button>
              </Dropdown>
            ) : (
              <>
                <span style={{ fontSize: 13 }}>
                  👤 {user.nickname || user.username}
                  {user.role === 'admin' && <Tag color="success" style={{ marginLeft: 4 }}>管理员</Tag>}
                </span>
                <Button size="small" onClick={() => setProfileOpen(true)}>⚙ 我的</Button>
                <Button size="small" onClick={() => logout()}>退出</Button>
              </>
            )
          ) : (
            <Button size="small" id="app-login-btn" onClick={() => setLoginOpen(true)}>
              {compact ? '登录' : '登录 / 注册'}
            </Button>
          )}
        </Space>
      </Header>

      {/* 手机 / iPad 竖屏：导航收进左侧汉堡抽屉（版本徽章与邮箱也搬到这里） */}
      <Drawer
        title="🧠 LLM 学习知识图谱" placement="left" width="min(280px, 80vw)"
        open={navOpen} onClose={() => setNavOpen(false)}
        styles={{ body: { padding: 0, display: 'flex', flexDirection: 'column' } }}
      >
        <Menu
          mode="vertical" selectedKeys={[loc.pathname]} items={items}
          onClick={onDrawerNavClick} style={{ borderInlineEnd: 'none', flex: 1, paddingTop: 4 }}
        />
        <div style={{ borderTop: '1px solid #f0f0f0', padding: '10px 16px' }}>
          {verList.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <Tag color="blue" style={{ fontSize: 11, lineHeight: '18px', padding: '0 6px', borderRadius: 4, fontWeight: 600 }}>
                v{verList[0].version}
              </Tag>
              {verList[0].date && <span style={{ fontSize: 12, color: '#86909c' }}>发布于 {verList[0].date}</span>}
            </div>
          )}
          <a href="mailto:sediao666@qq.com" style={{ fontSize: 12, color: '#86909c' }}>✉ sediao666@qq.com</a>
        </div>
      </Drawer>
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
