import { useEffect, useRef, useState } from 'react';
import { Modal, Button, Tag } from 'antd';
import { RedoOutlined, LoadingOutlined } from '@ant-design/icons';
import MarkdownContent from './MarkdownContent';

interface Props {
  open: boolean;
  onClose: () => void;
  nodeId: string;
  nodeTitle?: string;
  /** 生成完成且已落库：通知父级刷新注解列表（底部条目变为可读状态） */
  onSaved: () => void;
}

/**
 * 「💼 高频面试题」懒加载生成弹窗：笔记还没有面试题注解时，点击条目触发——
 * SSE 流式生成一套面试题（4~6 题 + 参考答案），边流边按 markdown 渲染；
 * 生成完服务端直接存为 approved 注解共享，下次点击直接读缓存不再调模型。
 */
export default function InterviewGenModal({ open, onClose, nodeId, nodeTitle, onSaved }: Props) {
  const [content, setContent] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  /** 消费 SSE：delta 增量边流边渲染，result 收尾（cached=缓存命中），error 报错 */
  const stream = async (signal: AbortSignal) => {
    try {
      const resp = await fetch('/api/ai/annotations/interview/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('llm_learn_token')}`,
        },
        signal,
        body: JSON.stringify({ nodeId }),
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
            } else if (ev === 'result') {
              setContent(payload.content || full);
              if (!payload.cached) { setSaved(true); onSaved(); }
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
      if (e?.name === 'AbortError') return; // 关闭弹窗主动中断，不算错误
      setError(e.message || '生成失败');
    } finally {
      setStreaming(false);
    }
  };

  // 打开即发起流式生成
  useEffect(() => {
    if (!open || !nodeId) return;
    setContent('');
    setError('');
    setSaved(false);
    const ac = new AbortController();
    abortRef.current = ac;
    setStreaming(true);
    stream(ac.signal);
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, nodeId]);

  /** 重新生成（后端 force 覆盖旧 AI 版） */
  const regenerate = () => {
    if (streaming) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setContent('');
    setError('');
    setSaved(false);
    setStreaming(true);
    stream(ac.signal);
  };

  return (
    <Modal
      open={open} onCancel={onClose}
      title={<span style={{ fontSize: 15 }}>💼 高频面试题 · {nodeTitle || ''}</span>}
      width={680}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {saved && <Tag color="success" style={{ marginRight: 'auto' }}>✅ 已保存共享，之后点条目直接读</Tag>}
          <Button size="small" icon={streaming ? <LoadingOutlined /> : <RedoOutlined />}
            onClick={regenerate} disabled={streaming}>
            重新生成
          </Button>
          <Button size="small" type="primary" onClick={onClose}>关闭</Button>
        </div>
      }
      maskClosable={!streaming}
      keyboard={!streaming}
    >
      {error ? (
        <div style={{ color: '#ff4d4f', fontSize: 13, padding: '24px 0', textAlign: 'center' }}>
          <div style={{ marginBottom: 12 }}>⚠ {error}</div>
          <Button size="small" onClick={regenerate} icon={<RedoOutlined />}>重试</Button>
        </div>
      ) : content ? (
        <div style={{ paddingRight: 8, maxHeight: 'calc(100vh - 260px)', overflowY: 'auto' }}>
          <MarkdownContent content={content} />
          {streaming && (
            <span style={{ display: 'inline-block', color: '#1677ff', fontSize: 20, lineHeight: 1, animation: 'blink 1s infinite' }}>▍</span>
          )}
        </div>
      ) : (
        <div style={{ textAlign: 'center', color: '#8c8c8c', fontSize: 13, padding: '60px 0' }}>
          <LoadingOutlined style={{ fontSize: 22, marginBottom: 10, display: 'block', color: '#1677ff' }} />
          AI 面试官正在基于这篇笔记出题…
          <div style={{ fontSize: 11, marginTop: 6 }}>生成后所有人可见，下次点开秒开</div>
        </div>
      )}
    </Modal>
  );
}
