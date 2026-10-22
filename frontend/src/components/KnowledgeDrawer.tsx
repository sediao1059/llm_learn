import { useState, useEffect, useRef } from 'react';
import {
  Drawer, Tag, Button, Popover, Tooltip, Modal, Input, message,
  Divider, Empty, FloatButton,
} from 'antd';
import {
  LeftOutlined, RightOutlined, PlusOutlined, LoadingOutlined,
  ExpandAltOutlined, CompressOutlined, StarOutlined, StarFilled,
} from '@ant-design/icons';
import MarkdownContent from './MarkdownContent';
import AnnotationModal from '../pages/graph/AnnotationModal';
import InterviewGenModal from './InterviewGenModal';
import AnnotationFloatButton from './AnnotationFloatButton';
import AnnotationReadModal from './AnnotationReadModal';
import AnnotationEntries from './AnnotationEntries';
import useSelectionAnno from '../hooks/useSelectionAnno';
import { applyAnnoMarks, findAnnoByClickTarget } from '../utils/annotate';

const LEVELS = [
  { v: 0, name: '未学习', icon: '○', color: '#d9d9d9' },
  { v: 1, name: '了解',   icon: '●', color: '#1677ff' },
  { v: 2, name: '熟悉',   icon: '●', color: '#52c41a' },
  { v: 3, name: '掌握',   icon: '★', color: '#faad14' },
];

export interface KnowledgeDrawerProps {
  open: boolean;
  onClose: () => void;
  nodeId: string;
  nodeData: any;
  level?: number;
  onLevelChange?: (refId: string, level: number) => void;
  prevId?: string;
  nextId?: string;
  onNavigate?: (refId: string) => void;
  routeId?: number;
  routeTitle?: string;
  routeSummary?: string;
  inRoute?: boolean;
  onExtendRoute?: (nodeId: string) => Promise<void>;
  extending?: boolean;
  linkedNodes?: { id: string; title: string }[];
  onOpenLinked?: (refId: string) => void;
  userRole?: string;
  isLoggedIn?: boolean;
  onAnnotationSaved?: () => void;
  annotations?: any[];
}

// 浏览足迹：同一节点连续打开只记一次（模块级记录上一个上报的节点）
let lastReportedNode: string | null = null;

export default function KnowledgeDrawer({
  open, onClose, nodeId, nodeData, level = 0, onLevelChange,
  prevId, nextId, onNavigate,
  routeId, routeTitle, routeSummary, inRoute, onExtendRoute, extending,
  linkedNodes, onOpenLinked,
  userRole, isLoggedIn, onAnnotationSaved,
  annotations = [],
}: KnowledgeDrawerProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const current = LEVELS[level] || LEVELS[0];

  // 划词注解（选区检测 + 浮动按钮位置由共享 hook 提供）
  const { anchorText, selectionPos, setSelectionPos, handleMouseUp } = useSelectionAnno(contentRef);
  const [annoOpen, setAnnoOpen] = useState(false);
  const [annoKey, setAnnoKey] = useState(0);

  // 放大阅读
  const [readerOpen, setReaderOpen] = useState(false);
  const [fontSize, setFontSize] = useState(17);

  // 个人笔记
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState('');

  // 收藏
  const [fav, setFav] = useState(false);

  // 注解阅读弹窗 + 放大阅读容器
  const [readingAnno, setReadingAnno] = useState<any>(null);
  const readerRef = useRef<HTMLDivElement>(null);
  // 面试题懒加载生成弹窗（ivForce=true 为管理员从阅读弹窗发起的覆盖重生成）
  const [ivGenOpen, setIvGenOpen] = useState(false);
  const [ivForce, setIvForce] = useState(false);

  // 打开面板：查收藏状态 + 上报浏览足迹（仅登录；同一节点连续打开只记一次）
  useEffect(() => {
    if (!open || !nodeId || !isLoggedIn) return;
    fetch('/api/favorites', {
      headers: { Authorization: `Bearer ${localStorage.getItem('llm_learn_token')}` },
    })
      .then(r => r.json())
      .then(d => setFav((d.favorites || []).some((f: any) => f.nodeId === nodeId)))
      .catch(() => {});
    if (lastReportedNode !== nodeId) {
      lastReportedNode = nodeId;
      fetch('/api/history', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('llm_learn_token')}`,
        },
        body: JSON.stringify({ nodeId }),
      }).catch(() => {});
    }
  }, [open, nodeId, isLoggedIn]);

  const toggleFav = async () => {
    const next = !fav;
    setFav(next); // 乐观更新
    try {
      await fetch('/api/favorites', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('llm_learn_token')}`,
        },
        body: JSON.stringify({ nodeId, on: next }),
      });
    } catch {
      setFav(!next);
      message.error('操作失败，请重试');
    }
  };

  // 清空选区
  useEffect(() => {
    setSelectionPos(null);
    setReaderOpen(false);
  }, [nodeId, open]);

  const openAnnotation = () => {
    if (!isLoggedIn) {
      message.info('请先登录后使用划词解答');
      return;
    }
    setAnnoOpen(true);
    setSelectionPos(null);
    window.getSelection()?.removeAllRanges();
  };

  const openNote = async () => {
    try {
      const r = await fetch(`/api/notes?nodeId=${nodeId}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('llm_learn_token')}` },
      });
      const d = await r.json();
      setNoteText(d.note || '');
    } catch { setNoteText(''); }
    setNoteOpen(true);
  };

  const saveNote = async () => {
    await fetch('/api/notes', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('llm_learn_token')}`,
      },
      body: JSON.stringify({ nodeId, content: noteText }),
    });
    message.success('笔记已保存');
    setNoteOpen(false);
  };

  // 正文 / 放大阅读渲染后画划线。注意：MarkdownContent 的 components 是内联函数，
  // 本组件任何状态变化（开关弹窗等）都会让 react-markdown 整体重建正文 DOM、划线被冲掉，
  // 因此必须每次渲染后重画（无依赖数组），不能只在内容变化时画一次。
  useEffect(() => {
    if (!open) return;
    applyAnnoMarks(contentRef.current, annotations);
  });

  useEffect(() => {
    if (!readerOpen) return;
    applyAnnoMarks(readerRef.current, annotations);
  });

  // 点击荧光高亮 → 打开注解阅读弹窗
  const onContentClick = (e: React.MouseEvent) => {
    const anno = findAnnoByClickTarget(e.target as HTMLElement, annotations);
    if (anno) setReadingAnno(anno);
  };

  // 切换节点时正文滚回顶部
  useEffect(() => {
    contentRef.current?.closest('.ant-drawer-body')?.scrollTo({ top: 0 });
  }, [nodeId]);

  const levelPopover = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {LEVELS.map(l => (
        <button key={l.v}
          onClick={() => onLevelChange?.(nodeId, l.v)}
          className={`level-option${level === l.v ? ' active' : ''}`}>
          <span style={{ color: l.color, fontSize: 14, width: 16, textAlign: 'center' }}>{l.icon}</span>
          {l.name}
        </button>
      ))}
    </div>
  );

  // 摘要去重
  const stripOneliner = (content: string | undefined, summary?: string): string => {
    if (!content || !summary) return content || '';
    const lines = content.split('\n');
    const start = lines.findIndex(l => l.trimStart().startsWith('>'));
    if (start < 0 || !/^>\s*\*\*一句话\*\*\s*[:：]/.test(lines[start])) return content;
    let end = start;
    while (end < lines.length && lines[end].trimStart().startsWith('>')) end++;
    if (lines[end] && !lines[end].trim()) end++;
    return lines.slice(0, start).concat(lines.slice(end)).join('\n');
  };

  const displayContent = stripOneliner(nodeData?.content, nodeData?.summary);

  // 面试题注解：正文有「高频面试题」标题则由划线承载；否则在正文末尾合成条目（已生成→读，未生成→懒加载 AI 出题）
  const interviewAnno = annotations.find((a: any) => a.type === 'interview') || null;
  const needsInterviewEntry = interviewAnno ? !displayContent.includes('高频面试题') : true;

  return (
    <>
      <Drawer
        open={open} onClose={onClose}
        width={500}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ flex: 1, fontSize: 16, fontWeight: 600 }}>{nodeData?.title || nodeId}</span>
            {isLoggedIn && (
              <Tooltip title={fav ? '取消收藏（顶栏 ⭐ 收藏可随时找回）' : '收藏这篇笔记（仅自己可见）'}>
                <Button type="text" size="small"
                  icon={fav ? <StarFilled style={{ color: '#faad14' }} /> : <StarOutlined />}
                  onClick={toggleFav} />
              </Tooltip>
            )}
            <Tooltip title="放大阅读（全屏，可调字号）">
              <Button type="text" size="small" icon={<ExpandAltOutlined />}
                onClick={() => setReaderOpen(true)} />
            </Tooltip>
          </div>
        }
        className="knowledge-drawer"
        destroyOnClose={false}
        afterOpenChange={(visible) => {
          if (visible) {
            // Drawer 打开后确保 ref 已挂载
            // Ant Design 的 destroyOnClose=false 保证 DOM 不会被销毁
          }
        }}
      >
        {nodeData ? (
          <div ref={contentRef} onMouseUp={handleMouseUp} onClick={onContentClick} style={{ userSelect: 'text', paddingBottom: 60 }}>
            {/* 标签区 */}
            <div style={{ marginBottom: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {nodeData.layer && <Tag color="blue">{nodeData.layer}</Tag>}
              {nodeData.category && <Tag color="geekblue">{nodeData.category}</Tag>}
              {nodeData.difficulty && <Tag color="orange">{nodeData.difficulty}</Tag>}
              {nodeData.status === 'todo' && <Tag>待学习</Tag>}
              {nodeData.ai && <Tag color="purple">✨ AI 沉淀</Tag>}
            </div>

            {/* 摘要 */}
            {nodeData.summary && (
              <div style={{
                borderLeft: '3px solid #1677ff', background: '#f6f8fa',
                borderRadius: '0 8px 8px 0', padding: '8px 12px',
                fontSize: 13, color: '#555', marginBottom: 12,
              }}>{nodeData.summary}</div>
            )}

            {/* 标签 */}
            {nodeData.tags?.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                {nodeData.tags.map((t: string) => <Tag key={t}>{t}</Tag>)}
              </div>
            )}

            {/* Markdown 正文 */}
            <MarkdownContent content={displayContent} />

            {/* 关联知识点 */}
            {linkedNodes && linkedNodes.length > 0 && (
              <>
                <Divider>🔗 关联知识点（点击打开）</Divider>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {linkedNodes.map(l => (
                    <Tooltip key={l.id} title={`打开关联笔记《${l.title}》`}>
                      <Tag color="success" style={{ cursor: onOpenLinked ? 'pointer' : 'default' }}
                        onClick={() => onOpenLinked?.(l.id)}>
                        {l.title} ↗
                      </Tag>
                    </Tooltip>
                  ))}
                </div>
              </>
            )}

            {/* 面试题入口：正文有「高频面试题」标题且已有注解 → 由 💼 高亮承载；否则正文末尾合成条目（未生成→懒加载） */}
            {isLoggedIn && needsInterviewEntry && (
              <div
                className="anno-entry"
                style={{ marginTop: 14 }}
                onClick={() => {
                  if (interviewAnno) { setReadingAnno(interviewAnno); return; }
                  setIvForce(false);
                  setIvGenOpen(true);
                }}>
                {interviewAnno
                  ? '💼 高频面试题 · 点击阅读'
                  : '💼 高频面试题 · 还没有，点击让 AI 现场出题（生成后共享，下次秒开）'}
              </div>
            )}

            {/* 正文里锚不上的其他注解（整篇注解 / 定位失败）：正文末尾合成条目兜底 */}
            {isLoggedIn && (
              <AnnotationEntries annotations={annotations} content={displayContent} onRead={setReadingAnno} />
            )}

            {/* 底部操作栏（sticky） */}
            <div style={{
              position: 'sticky', bottom: 0, background: '#fff',
              borderTop: '1px solid #f0f0f0', paddingTop: 12, marginTop: 16,
              display: 'flex', alignItems: 'center', gap: 8, zIndex: 10,
            }}>
              {/* 路线导航（可选） */}
              {onNavigate && (
                <>
                  <Button size="small" icon={<LeftOutlined />} disabled={!prevId}
                    onClick={() => prevId && onNavigate(prevId)}>
                    上一个
                  </Button>
                  <Button size="small" disabled={!nextId}
                    onClick={() => nextId && onNavigate(nextId)}>
                    下一个 <RightOutlined />
                  </Button>
                </>
              )}

              {/* 学习程度：明确的文字按钮，点开选掌握程度 */}
              {onLevelChange && (
                <Popover
                  content={levelPopover}
                  trigger="click" placement="topRight"
                  title={<span>标注这篇的学习程度<small style={{ color: '#999', fontWeight: 400 }}>（图谱「按掌握度着色」会用它）</small></span>}>
                  <Button size="small"
                    icon={<span style={{ color: current.color }}>{current.icon}</span>}
                    style={{ marginLeft: onNavigate ? 'auto' : 0 }}>
                    学习程度：{current.name} ▾
                  </Button>
                </Popover>
              )}

              {/* 加入本路线（可选） */}
              {routeId && !inRoute && onExtendRoute && (
                <Tooltip title={`加入「${routeTitle || ''}」— ${routeSummary || ''}`}>
                  <Button size="small" type="primary"
                    icon={extending ? <LoadingOutlined /> : <PlusOutlined />}
                    loading={extending}
                    onClick={() => onExtendRoute(nodeId)}
                    style={{ marginLeft: 'auto' }}>
                    {extending ? 'AI 整合中…' : '加入本路线'}
                  </Button>
                </Tooltip>
              )}
            </div>
          </div>
        ) : <Empty description="暂无内容" />}
      </Drawer>

      {/* 浮动"解答"按钮 — 紧贴选区上方 4px */}
      <AnnotationFloatButton pos={selectionPos} onClick={openAnnotation} />

      {/* 划词注解弹窗 */}
      {isLoggedIn && nodeId && (
        <AnnotationModal
          key={annoKey}
          open={annoOpen}
          onClose={() => setAnnoOpen(false)}
          nodeId={nodeId}
          nodeTitle={nodeData?.title || ''}
          anchorText={anchorText}
          onSaved={() => { onAnnotationSaved?.(); setAnnoKey(k => k + 1); }}
          userRole={userRole || 'user'}
        />
      )}

      {/* 面试题懒加载生成弹窗：拿到结果（新生成/命中缓存）后自动切换到注解阅读弹窗（md 渲染 + 角色化按钮） */}
      {isLoggedIn && nodeId && (
        <InterviewGenModal
          open={ivGenOpen}
          onClose={() => setIvGenOpen(false)}
          nodeId={nodeId}
          nodeTitle={nodeData?.title}
          initialForce={ivForce}
          onSaved={() => onAnnotationSaved?.()}
          onResult={async () => {
            onAnnotationSaved?.(); // 通知父级刷新注解列表（底部条目变为可读状态）
            try {
              const r = await fetch(`/api/ai/annotations?nodeId=${encodeURIComponent(nodeId)}`, {
                headers: { Authorization: `Bearer ${localStorage.getItem('llm_learn_token')}` },
              });
              const d = await r.json();
              // 优先取 AI 生成版：覆盖重生成后新 AI 版与 build 提取的 system 版并存，应展示新生成的
              const list = (d.annotations || []).filter((a: any) => a.type === 'interview');
              const anno = list.find((a: any) => a.createdBy !== 'system') || list[0];
              if (anno) {
                setIvGenOpen(false);
                setReadingAnno(anno);
              }
              // 拉取失败或没找到：留在生成弹窗（内容已完整展示，不打断用户）
            } catch { /* 留在生成弹窗 */ }
          }}
        />
      )}

      {/* 放大阅读 Modal */}
      <Modal
        open={readerOpen} onCancel={() => setReaderOpen(false)}
        title={nodeData?.title || ''}
        width="92vw" style={{ top: 20 }}
        footer={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Button size="small" onClick={() => setFontSize(f => Math.max(12, f - 1))}>A−</Button>
            <span style={{ fontSize: 12, color: '#8c8c8c', minWidth: 40, textAlign: 'center' }}>{fontSize}px</span>
            <Button size="small" onClick={() => setFontSize(f => Math.min(26, f + 1))}>A＋</Button>
            <Button size="small" icon={<CompressOutlined />} onClick={() => setReaderOpen(false)}
              style={{ marginLeft: 'auto' }}>
              退出全屏
            </Button>
          </div>
        }
      >
        <div
          ref={readerRef}
          onClick={onContentClick}
          className="knowledge-drawer"
          style={{ maxHeight: 'calc(100vh - 180px)', overflowY: 'auto', padding: '0 8px', userSelect: 'text' }}
        >
          {nodeData?.summary && (
            <div style={{
              borderLeft: '3px solid #1677ff', background: '#f6f8fa',
              borderRadius: '0 8px 8px 0', padding: '8px 12px',
              fontSize: 14, color: '#555', marginBottom: 16,
            }}>{nodeData.summary}</div>
          )}
          <MarkdownContent content={displayContent} fontSize={fontSize} />
        </div>
      </Modal>

      {/* 个人笔记 FloatButton */}
      {isLoggedIn && open && nodeId && (
        <FloatButton
          icon={<span style={{ fontSize: 18 }}>📝</span>}
          tooltip="写只给自己看的笔记"
          style={{ right: 520, bottom: 24 }}
          onClick={openNote}
        />
      )}

      {/* 个人笔记 Modal */}
      <Modal
        open={noteOpen} onCancel={() => setNoteOpen(false)}
        title={`📝 我的笔记 · ${nodeData?.title || ''}`}
        onOk={saveNote}
      >
        <Input.TextArea rows={8} value={noteText} onChange={e => setNoteText(e.target.value)}
          placeholder="写点只有自己看的理解/待办/联想…保存在你的账号下，换设备也在" />
      </Modal>

      {/* 注解阅读弹窗（点正文荧光高亮 / 正文末尾兜底条目打开） */}
      <AnnotationReadModal
        anno={readingAnno}
        onClose={() => setReadingAnno(null)}
        onRegenerateInterview={() => {
          // 管理员覆盖重生成：关阅读弹窗 → 以 force 模式打开生成弹窗（完成后再自动切回阅读态）
          setReadingAnno(null);
          setIvForce(true);
          setIvGenOpen(true);
        }}
      />
    </>
  );
}
