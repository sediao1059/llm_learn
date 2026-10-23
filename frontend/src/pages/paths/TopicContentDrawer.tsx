import { useEffect, useRef, useState } from 'react';
import { Drawer, Tag, Button, Tooltip, message } from 'antd';
import { RedoOutlined, LoadingOutlined } from '@ant-design/icons';
import MarkdownContent from '../../components/MarkdownContent';
import AnnotationModal from '../graph/AnnotationModal';
import AnnotationFloatButton from '../../components/AnnotationFloatButton';
import AnnotationReadModal from '../../components/AnnotationReadModal';
import AnnotationEntries from '../../components/AnnotationEntries';
import useSelectionAnno from '../../hooks/useSelectionAnno';
import { useResponsive } from '../../hooks/useResponsive';
import { applyAnnoMarks, findAnnoByClickTarget } from '../../utils/annotate';
import { useAuth } from '../../store/auth';
import { showQueuedNotice, hideQueueNotice } from '../../utils/llmQueueNotice';

interface Props {
  open: boolean;
  onClose: () => void;
  pathId: number;
  /** 主题在路线树中的定位：addr[0]=阶段下标，addr[1]=主题下标，之后为子主题下标链 */
  addr: number[];
  /** 本地路线树上的条目快照（含已缓存的 content） */
  topic: { title: string; why?: string; content?: string } | null;
  stageTitle?: string;
  /** 流式生成完成（含缓存命中不触发），把内容回写本地树 */
  onGenerated: (content: string) => void;
}

/**
 * 「新主题」懒加载抽屉：点击路线里未关联知识点的新主题时打开，
 * 未生成过则 SSE 流式生成一篇学习内容——过程中边流边按 markdown 渲染；
 * 生成完由后端缓存进路线树，下次点击直接读缓存不再调模型。
 * 生成的内容同样支持划词注解（选中 → 💡 解答 → 存注解 → 荧光高亮阅读），
 * 主题条目不是图谱节点，用稳定合成 nodeId `path-{路线id}-topic-{定位链}` 存取注解。
 */
export default function TopicContentDrawer({
  open, onClose, pathId, addr, topic, stageTitle, onGenerated,
}: Props) {
  const { user } = useAuth();
  const { isMobile } = useResponsive(); // 手机端抽屉全屏铺满
  const [content, setContent] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  // 划词注解
  const contentRef = useRef<HTMLDivElement>(null);
  const { anchorText, selectionPos, setSelectionPos, handleMouseUp } = useSelectionAnno(contentRef);
  const [annoOpen, setAnnoOpen] = useState(false);
  const [annoKey, setAnnoKey] = useState(0);
  const [readingAnno, setReadingAnno] = useState<any>(null);
  const [annotations, setAnnotations] = useState<any[]>([]);
  const annoNodeId = `path-${pathId}-topic-${addr.join('.')}`;

  // 加载该主题的注解（登录可见）
  useEffect(() => {
    if (!open || !user) { setAnnotations([]); return; }
    fetch(`/api/ai/annotations?nodeId=${encodeURIComponent(annoNodeId)}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('llm_learn_token')}` },
    })
      .then(r => r.json())
      .then(d => setAnnotations(d.annotations || []))
      .catch(() => setAnnotations([]));
  }, [open, annoNodeId, user, annoKey]);

  // 划线每次渲染后重画（react-markdown 内联 components 会随状态变化整体重建正文 DOM）
  useEffect(() => {
    if (!open) return;
    applyAnnoMarks(contentRef.current, annotations);
  });

  const openAnnotation = () => {
    if (!user) { message.info('请先登录后使用划词解答'); return; }
    setAnnoOpen(true);
    setSelectionPos(null);
    window.getSelection()?.removeAllRanges();
  };

  // 点击荧光高亮 → 打开注解阅读弹窗
  const onContentClick = (e: React.MouseEvent) => {
    const anno = findAnnoByClickTarget(e.target as HTMLElement, annotations);
    if (anno) setReadingAnno(anno);
  };

  /** 消费 SSE：delta 增量边流边渲染，result 收尾，error 报错 */
  const stream = async (signal: AbortSignal, force: boolean) => {
    try {
      const resp = await fetch(`/api/ai/paths/${pathId}/topic-content`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('llm_learn_token')}`,
        },
        signal,
        body: JSON.stringify({ stageIdx: addr[0], itemPath: addr.slice(1), force }),
      });
      if (!resp.ok || !resp.body) {
        const d = await resp.json().catch(() => ({}));
        throw new Error(d.message || `HTTP ${resp.status}`);
      }
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let full = '';
      const pump = async (): Promise<void> => {
        const { done, value } = await reader.read();
        if (done) return;
        buf += dec.decode(value, { stream: true });
        const frames = buf.split('\n\n');
        buf = frames.pop() || '';
        for (const frame of frames) {
          let ev = '';
          let data = '';
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) ev = line.slice(6).trim();
            else if (line.startsWith('data:')) data += line.slice(5).trim();
          }
          if (!ev || !data) continue;
          try {
            const payload = JSON.parse(data);
            if (ev === 'delta' && payload.text) {
              full += payload.text;
              setContent(full);
            } else if (ev === 'queued') {
              showQueuedNotice(payload);
            } else if (ev === 'start') {
              hideQueueNotice();
            } else if (ev === 'result') {
              setContent(payload.content || full);
              if (!payload.cached) onGenerated(payload.content || full);
            } else if (ev === 'error') {
              throw new Error(payload.error || '生成失败');
            }
          } catch (e: any) {
            if (e instanceof SyntaxError) continue; // JSON 解析失败跳过
            throw e;
          }
        }
        return pump();
      };
      await pump();
    } catch (e: any) {
      if (e?.name === 'AbortError') return; // 关闭抽屉主动中断，不算错误
      setError(e.message || '生成失败');
    } finally {
      hideQueueNotice();
      setStreaming(false);
    }
  };

  // 打开/切换主题时：有缓存直接展示；没有则发起流式生成
  useEffect(() => {
    if (!open || !topic) return;
    setError('');
    setSelectionPos(null);
    if (topic.content) {
      setContent(topic.content);
      return;
    }
    setContent('');
    const ac = new AbortController();
    abortRef.current = ac;
    setStreaming(true);
    stream(ac.signal, false);
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pathId, addr.join('.')]);

  /** 重新生成（force 覆盖缓存） */
  const regenerate = () => {
    if (streaming) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setContent('');
    setError('');
    setStreaming(true);
    stream(ac.signal, true);
  };

  return (
    <>
      <Drawer
        open={open} onClose={onClose} width={isMobile ? '100%' : 640}
        title={
          <span style={{ fontSize: 15 }}>
            ✨ {topic?.title || '学习内容'}
            <Tag color="purple" style={{ marginLeft: 10, fontSize: 11 }}>AI 生成</Tag>
          </span>
        }
        extra={
          <Tooltip title={streaming ? '生成中…' : '不要这篇了？让 AI 重新写一篇'}>
            <Button size="small" icon={streaming ? <LoadingOutlined /> : <RedoOutlined />}
              onClick={regenerate} disabled={streaming}>
              重新生成
            </Button>
          </Tooltip>
        }
        destroyOnClose
        maskClosable={!streaming}
        keyboard={!streaming}
      >
        {stageTitle && (
          <div style={{ color: '#8c8c8c', fontSize: 12, marginBottom: 8 }}>
            所属阶段：{stageTitle}
          </div>
        )}
        {topic?.why && !content && !error && (
          <div style={{ color: '#8c8c8c', fontSize: 12, marginBottom: 8 }}>🎯 {topic.why}</div>
        )}

        {error ? (
          <div style={{ color: '#ff4d4f', fontSize: 13, padding: '24px 0', textAlign: 'center' }}>
            <div style={{ marginBottom: 12 }}>⚠ {error}</div>
            <Button size="small" onClick={regenerate} icon={<RedoOutlined />}>重试</Button>
          </div>
        ) : !topic ? (
          <div style={{ textAlign: 'center', color: '#8c8c8c', fontSize: 13, padding: '60px 0' }}>
            该主题已不在当前路线中（路线可能被 AI 调整过），请重新点击主题打开
          </div>
        ) : content ? (
          <div
            ref={contentRef}
            onMouseUp={handleMouseUp}
            onClick={onContentClick}
            className="knowledge-drawer"
            style={{ paddingRight: 8, userSelect: 'text' }}
          >
            <MarkdownContent content={content} />
            {streaming && (
              <span style={{ display: 'inline-block', color: '#1677ff', fontSize: 20, lineHeight: 1, animation: 'blink 1s infinite' }}>▍</span>
            )}
            {/* 正文里锚不上的注解（整篇注解 / 重新生成后定位失败）：正文末尾合成条目兜底 */}
            {!streaming && user && (
              <AnnotationEntries annotations={annotations} content={content} onRead={setReadingAnno} />
            )}
          </div>
        ) : (
          <div style={{ textAlign: 'center', color: '#8c8c8c', fontSize: 13, padding: '60px 0' }}>
            <LoadingOutlined style={{ fontSize: 22, marginBottom: 10, display: 'block', color: '#1677ff' }} />
            AI 正在按路线上下文写这篇内容…
            <div style={{ fontSize: 11, marginTop: 6 }}>生成后会缓存，下次点开秒开</div>
          </div>
        )}
      </Drawer>

      {/* 浮动"解答"按钮 — 紧贴选区上方 */}
      <AnnotationFloatButton pos={selectionPos} onClick={openAnnotation} />

      {/* 划词注解弹窗（与图谱笔记完全一致：SSE 流式对话 + AI 提炼 + 存为注解） */}
      {user && (
        <AnnotationModal
          key={annoKey}
          open={annoOpen}
          onClose={() => setAnnoOpen(false)}
          nodeId={annoNodeId}
          nodeTitle={topic?.title || '新主题'}
          anchorText={anchorText}
          onSaved={() => { message.success('注解已保存'); setAnnoKey(k => k + 1); }}
          userRole={user.role || 'user'}
        />
      )}

      {/* 注解阅读弹窗 */}
      <AnnotationReadModal anno={readingAnno} onClose={() => setReadingAnno(null)} />
    </>
  );
}
