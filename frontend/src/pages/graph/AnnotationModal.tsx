import { useState, useRef, useEffect } from 'react';
import { Modal, Input, Button, Tag, message, Spin, Checkbox, Rate } from 'antd';
import { SendOutlined, SaveOutlined } from '@ant-design/icons';
import { showQueuedNotice, hideQueueNotice, trackLlmCall } from '../../utils/llmQueueNotice';
import MarkdownContent from '../../components/MarkdownContent';

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

  // ===== 沉淀为知识点（仅整篇追问 + 真实图谱节点；学习路线主题是 path- 合成 id，不提供）=====
  const canDeposit = !anchorText && !!nodeId && !nodeId.startsWith('path-');
  const [depLoading, setDepLoading] = useState(false);
  const [depPreview, setDepPreview] = useState<any>(null); // {decision, content, sourceNode}
  const [depTitle, setDepTitle] = useState('');
  const [depRelate, setDepRelate] = useState(true);
  const [depApplying, setDepApplying] = useState(false);
  const [subForm, setSubForm] = useState<{ question: string; answer: string } | null>(null);
  const [subStars, setSubStars] = useState(3);
  const [subArticle, setSubArticle] = useState('');
  const [subReview, setSubReview] = useState('');
  const [subSubmitting, setSubSubmitting] = useState(false);

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

  // ===== 沉淀为知识点：取最后一组完整的问答对 =====
  const lastQA = () => {
    let q = '';
    let pair: { question: string; answer: string } | null = null;
    for (const m of messages) {
      if (m.role === 'user') q = m.content;
      else if (m.role === 'assistant' && m.content.trim() && q) pair = { question: q, answer: m.content };
    }
    return pair;
  };

  const startDeposit = () => {
    const pair = lastQA();
    if (!pair) return message.warning('请先提问并得到回答');
    // 管理员预览确认直写；普通用户填表单提交审核（AI 判断是否关联本篇笔记，管理员可改）
    if (userRole === 'admin') {
      setDepLoading(true);
      trackLlmCall(fetch('/api/ai/knowledge/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ question: pair.question, answer: pair.answer, sourceNodeId: nodeId }),
      })).then(async r => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.message || '标题提取失败');
        setDepPreview(d);
        setDepTitle(d.decision?.title || '');
        setDepRelate(d.decision?.relateToSource !== false);
      }).catch((e: any) => message.error(e.message || '标题提取失败'))
        .finally(() => setDepLoading(false));
    } else {
      setSubStars(3); setSubArticle(''); setSubReview('');
      setSubForm(pair);
    }
  };

  const applyDeposit = async () => {
    if (!depPreview) return;
    setDepApplying(true);
    try {
      const decision = {
        ...depPreview.decision,
        title: depTitle.trim() || depPreview.decision.title,
        relateToSource: depRelate,
      };
      const r = await fetch('/api/ai/knowledge/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content: depPreview.content, sourceNodeId: nodeId, decision }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message || '写入失败');
      message.success(`✨ 已沉淀为知识点「${d.title}」${d.linkedToSource ? '，并与本篇建立关联' : ''}`);
      setDepPreview(null);
      window.dispatchEvent(new CustomEvent('kg:ai-knowledge-updated'));
    } catch (e: any) { message.error(e.message || '写入失败'); }
    finally { setDepApplying(false); }
  };

  const submitDeposit = async () => {
    if (!subForm) return;
    setSubSubmitting(true);
    try {
      const r = await fetch('/api/ai/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          questionText: subForm.question, answerText: subForm.answer, sourceNodeId: nodeId,
          importance: subStars, articleNote: subArticle, reviewNote: subReview,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message || '提交失败');
      message.success('✅ 已提交审核，通过后就会出现在图谱上（进度看顶栏「📥 沉淀」）');
      setSubForm(null);
    } catch (e: any) { message.error(e.message || '提交失败'); }
    finally { setSubSubmitting(false); }
  };

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
                <p style={{ fontSize: 11 }}>
                  {canDeposit
                    ? '可以多次追问 · 满意后「💾 存为注解」或「✨ 沉淀为知识点」进图谱'
                    : '可以多次追问 · 满意后点「存为注解」提炼入库'}
                </p>
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
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12, gap: 8 }}>
            {canDeposit && (
              <Button
                loading={depLoading} disabled={streaming || distilling || !lastQA()}
                onClick={startDeposit}
              >{depLoading ? '⏳ AI 正在提取标题…' : '✨ 沉淀为知识点'}</Button>
            )}
            <Button icon={<SaveOutlined />} loading={distilling} onClick={distill}
              disabled={messages.filter(m => m.content.trim()).length === 0}>
              💾 存为注解（AI 提炼）
            </Button>
          </div>
        </>
      )}

      {/* 管理员：沉淀预览（AI 提取标题/分类/标签并判断是否关联本篇，正文 = 回答原文）→ 确认写入 */}
      <Modal
        open={!!depPreview} title="✨ 沉淀为知识点（确认后写入图谱）"
        onCancel={() => setDepPreview(null)}
        width={720}
        footer={[
          <Button key="cancel" onClick={() => setDepPreview(null)}>取消</Button>,
          <Button key="ok" type="primary" loading={depApplying} onClick={applyDeposit}>
            ✅ 确认沉淀
          </Button>,
        ]}
      >
        {depPreview?.decision && (
          <div>
            <div style={{ marginBottom: 8 }}>
              <span style={{ fontSize: 13, marginRight: 8 }}>标题（可修改）：</span>
              <Input value={depTitle} onChange={e => setDepTitle(e.target.value)}
                style={{ width: 360 }} maxLength={80} />
            </div>
            <div style={{ marginBottom: 12, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {depPreview.decision.category && <Tag color="geekblue">{depPreview.decision.category}</Tag>}
              <Tag color="blue">未分层</Tag>
              {(depPreview.decision.tags || []).map((t: string) => <Tag key={t}>{t}</Tag>)}
            </div>
            {depPreview.sourceNode && (
              <div style={{ marginBottom: 12 }}>
                <Checkbox checked={depRelate} onChange={e => setDepRelate(e.target.checked)}>
                  🔗 关联到来源知识点《{depPreview.sourceNode.title}》
                </Checkbox>
                <div style={{ color: '#999', fontSize: 12, marginTop: 2 }}>
                  {depPreview.decision.relateToSource !== false
                    ? 'AI 判断与本篇相关，建议关联（若追问已跑题可取消勾选）'
                    : 'AI 判断可能跑题，默认不关联（确认相关可勾选）'}
                </div>
              </div>
            )}
            <div style={{
              border: '1px solid #f0f0f0', borderRadius: 8,
              maxHeight: '40vh', overflowY: 'auto', padding: '8px 12px', background: '#fafbfc',
            }}>
              <MarkdownContent content={depPreview.content || ''} />
            </div>
            <p style={{ color: '#999', fontSize: 12, marginTop: 8 }}>
              正文为回答原文（不改写、不总结），分类与标签由 AI 顺带给出；关联后新节点会在图谱上连到本篇。
            </p>
          </div>
        )}
      </Modal>

      {/* 普通用户：提交审核表单（管理员审核时 AI 顺带判断是否关联本篇） */}
      <Modal
        open={!!subForm} title="📤 提交给管理员审核"
        onCancel={() => setSubForm(null)}
        onOk={submitDeposit}
        okText="📤 提交审核" cancelText="取消"
        confirmLoading={subSubmitting}
      >
        <p style={{ color: '#888', fontSize: 12, marginBottom: 12 }}>
          提交后不直接进图谱；管理员审核时会用 AI 做信息抽取、并判断是否与本篇笔记建立关联。你填的信息能帮管理员更快判断。
        </p>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 13, marginBottom: 4 }}>重要程度（管理员优先看星级高的）</div>
          <Rate value={subStars} onChange={setSubStars} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 13, marginBottom: 4 }}>文章备注（不超过 100 字，会跟着这篇知识展示）</div>
          <Input value={subArticle} onChange={e => setSubArticle(e.target.value)} maxLength={100}
            placeholder="一句话说明讲什么，如：RAG 检索优化的实战总结" />
        </div>
        <div>
          <div style={{ fontSize: 13, marginBottom: 4 }}>给审核人的备注（可选）</div>
          <Input.TextArea value={subReview} onChange={e => setSubReview(e.target.value)} rows={3} maxLength={500}
            placeholder="想对管理员说的话，如：这块我不确定理解对不对，帮我看看" />
        </div>
      </Modal>
    </Modal>
  );
}
