import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Drawer, Tag, Card, Button, Popover, Tooltip, Modal, Input, message,
  Divider, Empty, FloatButton,
} from 'antd';
import {
  LeftOutlined, RightOutlined, PlusOutlined, LoadingOutlined,
  ExpandAltOutlined, CompressOutlined,
} from '@ant-design/icons';
import MarkdownContent from './MarkdownContent';
import AnnotationModal from '../pages/graph/AnnotationModal';

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

  // 划词注释
  const [anchorText, setAnchorText] = useState('');
  const [selectionPos, setSelectionPos] = useState<{x: number; y: number} | null>(null);
  const [annoOpen, setAnnoOpen] = useState(false);
  const [annoKey, setAnnoKey] = useState(0);

  // 放大阅读
  const [readerOpen, setReaderOpen] = useState(false);
  const [fontSize, setFontSize] = useState(17);

  // 个人笔记
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState('');

  // 清空选区
  useEffect(() => {
    setAnchorText('');
    setSelectionPos(null);
    setReaderOpen(false);
  }, [nodeId, open]);

  // 划词检测 — 不要求登录也能选中
  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) { setSelectionPos(null); return; }
    const text = sel.toString().trim();
    if (!text || text.length < 2 || text.length > 1000) { setSelectionPos(null); return; }
    const range = sel.getRangeAt(0);
    const container = contentRef.current;
    if (!container || !container.contains(range.commonAncestorContainer)) { setSelectionPos(null); return; }
    const rect = range.getBoundingClientRect();
    setAnchorText(text);
    setSelectionPos({ x: rect.left + rect.width / 2, y: rect.top });
  }, []);

  // 全局 mousedown 关闭浮动按钮
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.anno-float-btn')) setSelectionPos(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

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

  const levelPopover = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {LEVELS.map(l => (
        <button key={l.v}
          onClick={() => onLevelChange?.(nodeId, l.v)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px',
            border: 'none', background: level === l.v ? '#f0f5ff' : 'transparent',
            borderRadius: 4, cursor: 'pointer', fontSize: 13,
            color: level === l.v ? '#1677ff' : '#333',
            fontWeight: level === l.v ? 600 : 400,
          }}>
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

  return (
    <>
      <Drawer
        open={open} onClose={onClose}
        width={500}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ flex: 1, fontSize: 16, fontWeight: 600 }}>{nodeData?.title || nodeId}</span>
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
          <div ref={contentRef} onMouseUp={handleMouseUp} style={{ userSelect: 'text', paddingBottom: 60 }}>
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
                {nodeData.tags.map((t: string) => <Tag key={t}>#{t}</Tag>)}
              </div>
            )}

            {/* Markdown 正文 */}
            <MarkdownContent content={displayContent} />

            {/* 关联知识点 */}
            {linkedNodes && linkedNodes.length > 0 && (
              <>
                <Divider>🔗 关联知识点</Divider>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {linkedNodes.map(l => (
                    <Tag key={l.id} color="success" style={{ cursor: onOpenLinked ? 'pointer' : 'default' }}
                      onClick={() => onOpenLinked?.(l.id)}>
                      {l.title} ↗
                    </Tag>
                  ))}
                </div>
              </>
            )}

            {/* 注释列表 */}
            {annotations.length > 0 && (
              <Card title={`💬 本篇注释（${annotations.length}）`} size="small" style={{ marginTop: 16 }}>
                {annotations.map((a: any) => (
                  <div key={a.id} style={{ marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid #f0f0f0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <Tag style={{ fontSize: 10 }}>
                        {a.type === 'word' ? '词' : a.type === 'sentence' ? '句' : a.type === 'document' ? '整篇' : a.type}
                      </Tag>
                      <Tag color={a.status === 'approved' ? 'success' : a.status === 'pending' ? 'warning' : 'error'} style={{ fontSize: 10 }}>
                        {a.status === 'approved' ? '已审核' : a.status === 'pending' ? '待审核' : '驳回'}
                      </Tag>
                      <span style={{ fontSize: 11, color: '#bfbfbf', marginLeft: 'auto' }}>{a.createdBy}</span>
                    </div>
                    {a.anchorText && <div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 4 }}>「{a.anchorText.slice(0, 50)}…」</div>}
                    <MarkdownContent content={a.answer || ''} fontSize={12.5} />
                  </div>
                ))}
              </Card>
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

              {/* 学习程度 */}
              {onLevelChange && (
                <Popover content={levelPopover} trigger="click" title="标注学习程度">
                  <Tooltip title={`当前：${current.name}（点击修改）`}>
                    <span style={{
                      cursor: 'pointer', fontSize: 18, color: current.color,
                      width: 24, textAlign: 'center', userSelect: 'none',
                      marginLeft: onNavigate ? 'auto' : 0,
                    }}>{current.icon}</span>
                  </Tooltip>
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
      {selectionPos && (
        <button
          className="anno-float-btn"
          onClick={openAnnotation}
          style={{
            position: 'fixed',
            left: Math.max(8, Math.min(selectionPos.x - 34, window.innerWidth - 90)),
            top: selectionPos.y - 32,
            zIndex: 1100,
            padding: '3px 10px', borderRadius: 6,
            background: '#1677ff', color: '#fff', border: 'none',
            cursor: 'pointer', fontSize: 12, fontWeight: 500,
            boxShadow: '0 2px 6px rgba(22,119,255,0.4)',
            transition: 'opacity 0.15s',
          }}
        >
          💡 解答
        </button>
      )}

      {/* 划词注释弹窗 */}
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
    </>
  );
}
