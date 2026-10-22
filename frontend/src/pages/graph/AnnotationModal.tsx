import { useState, useRef, useEffect } from 'react';
import { Modal, Input, Button, Tag, message, Spin } from 'antd';
import { SendOutlined, SaveOutlined } from '@ant-design/icons';
import { showQueuedNotice, hideQueueNotice, trackLlmCall } from '../../utils/llmQueueNotice';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  nodeId: string;
  nodeTitle: string;
  anchorText: string;
  onSaved: () => void;
  userRole: string;
  /** 笔记正文（截断后传入）：整篇追问（无选区）时作为 AI 上下文 */
  nodeContent?: string;
  /** 保存成功后把注解对象回传父级（父级可借此直接转「注解阅读」弹窗继续讨论） */
  onSavedAnno?: (anno: any) => void;
}

/** 自动检测注解类型：<10 字=词，≥10 字=句，无选中文本=整篇 */
function detectType(text: string): string {
  if (!text) return 'document';
  return text.trim().length < 10 ? 'word' : 'sentence';
}

export default function AnnotationModal({
  open, onClose, nodeId, nodeTitle, anchorText, onSaved, userRole, nodeContent, onSavedAnno,
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [distilling, setDistilling] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const chatBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setMessages([]);
      setInput('');
      setPreview(null);
    }
  }, [open]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  const token = localStorage.getItem('llm_learn_token');

  const send = async () => {
    if (!input.trim() || streaming || distilling) return;
    const question = input.trim();
    setInput('');

    const history = messages.map(m => ({ role: m.role, content: m.content }));
    setMessages(prev => [...prev, { role: 'user', content: question }, { role: 'assistant', content: '' }]);
    setStreaming(true);

    try {
      const resp = await fetch('/api/ai/annotations/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ anchorText, question, nodeTitle, nodeContent: nodeContent || '', history }),
      });
      if (!resp.ok || !resp.body) {
        const d = await resp.json().catch(() => ({}));
        throw new Error(d.message || `HTTP ${resp.status}`);
      }

      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let full = '';

      setMessages(prev => {
        const next = [...prev];
        return next;
      });

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
              setMessages(prev => {
                const next = [...prev];
                next[next.length - 1] = { role: 'assistant', content: full };
                return next;
              });
            } else if (ev === 'queued') {
              showQueuedNotice(payload);
            } else if (ev === 'start') {
              hideQueueNotice();
            } else if (ev === 'error') {
              message.error(payload.error || '生成失败');
            }
          } catch {}
        }
        return pump();
      };
      await pump();
    } catch (e: any) {
      message.error(e.message || '生成失败');
      // 移除空的 assistant 消息
      setMessages(prev => prev.filter(m => m.content || m.role === 'user'));
    } finally {
      hideQueueNotice();
      setStreaming(false);
    }
  };

  const distill = async () => {
    const validMessages = messages.filter(m => m.content.trim());
    if (!validMessages.length) return message.warning('请先提问生成一些内容');
    setDistilling(true);
    try {
      const r = await trackLlmCall(fetch('/api/ai/annotations/distill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ anchorText, nodeTitle, messages: validMessages }),
      }));
      const d = await r.json();
      if (!r.ok) throw new Error(d.message || '提炼失败');
      setPreview(d.answer);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setDistilling(false);
    }
  };

  const save = async () => {
    if (!preview) return;
    const type = detectType(anchorText);
    const r = await fetch('/api/ai/annotations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        nodeId, anchorText, type,
        question: messages.find(m => m.role === 'user')?.content || '',
        answer: preview,
      }),
    });
    if (r.ok) {
      const d = await r.json().catch(() => ({}));
      message.success('注解已保存');
      onSaved();
      onSavedAnno?.(d.annotation);
      onClose();
    } else {
      const d = await r.json();
      message.error(d.message || '保存失败');
    }
  };

  const typeLabel = detectType(anchorText) === 'word' ? '词' : detectType(anchorText) === 'sentence' ? '句' : '整篇';

  return (
    <Modal
      open={open} onCancel={onClose}
      title={anchorText ? `💡 划词解答 · ${typeLabel}注` : '✨ 向 AI 追问 · 整篇注解'} width={520}
      footer={null} destroyOnClose
      maskClosable={!(streaming || distilling)} keyboard={!(streaming || distilling)}
    >
      {/* 选中文本引用 */}
      {anchorText && (
        <div style={{
          borderLeft: '3px solid #1677ff', background: '#f5f5f5', borderRadius: '0 8px 8px 0',
          padding: '8px 12px', marginBottom: 12, fontSize: 13, color: '#555',
          maxHeight: 80, overflow: 'hidden',
        }}>
          「{anchorText.slice(0, 100)}{anchorText.length > 100 ? '…' : ''}」
        </div>
      )}
      {!anchorText && (
        <Tag style={{ marginBottom: 12 }}>📝 整篇注解 · {nodeTitle}</Tag>
      )}

      {/* 预览模式 */}
      {preview !== null ? (
        <div>
          <p style={{ color: '#8c8c8c', fontSize: 12, marginBottom: 8 }}>AI 已将对话提炼为以下注解（可直接编辑）：</p>
          <Input.TextArea
            value={preview} onChange={e => setPreview(e.target.value)}
            rows={8} style={{ fontSize: 13, lineHeight: 1.8 }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
            <Button onClick={() => setPreview(null)}>← 返回对话</Button>
            <Button type="primary" icon={<SaveOutlined />} onClick={save}>
              确认存为注解
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* 对话区域 */}
          <div ref={chatBoxRef} style={{
            height: 280, overflowY: 'auto', marginBottom: 12,
            padding: '0 4px', display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            {messages.length === 0 && (
              <div style={{ textAlign: 'center', paddingTop: 80, color: '#8c8c8c', fontSize: 13 }}>
                <div style={{ fontSize: 24, marginBottom: 8 }}>💡</div>
                <p>{anchorText ? '输入问题，AI 会针对选中的文字进行解答' : '输入问题，AI 会结合这篇笔记的内容解答'}</p>
                <p style={{ fontSize: 11 }}>可以多次追问 · 满意后点「存为注解」提炼入库</p>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} style={{
                display: 'flex',
                justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
              }}>
                <div style={{
                  maxWidth: '85%',
                  padding: m.role === 'user' ? '6px 12px' : '8px 12px',
                  borderRadius: m.role === 'user' ? '10px 10px 2px 10px' : '10px 10px 10px 2px',
                  background: m.role === 'user' ? '#1677ff' : '#f5f5f5',
                  color: m.role === 'user' ? '#fff' : '#333',
                  fontSize: 13, lineHeight: 1.7,
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {m.content || (streaming && i === messages.length - 1 ? <Spin size="small" /> : '')}
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>

          {/* 输入区 */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <Input.TextArea
              value={input} onChange={e => setInput(e.target.value)}
              onPressEnter={e => { if (!e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="输入问题…（Enter 发送，Shift+Enter 换行）"
              autoSize={{ minRows: 1, maxRows: 3 }} maxLength={500}
              disabled={streaming || distilling}
            />
            <Button type="primary" icon={<SendOutlined />} loading={streaming} onClick={send}
              disabled={!input.trim()}>
              发送
            </Button>
          </div>

          {/* 底部操作 */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
            <Button icon={<SaveOutlined />} loading={distilling} onClick={distill}
              disabled={messages.filter(m => m.content.trim()).length === 0}>
              💾 存为注解（AI 提炼）
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
