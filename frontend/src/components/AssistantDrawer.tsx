import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Drawer, Button, Select, Input, Tag, Modal, Rate, Spin, message, Popconfirm,
} from 'antd';
import {
  PlusOutlined, SendOutlined, EditOutlined, DeleteOutlined, LoadingOutlined, RobotOutlined,
} from '@ant-design/icons';
import { useAuth } from '../store/auth';
import MarkdownContent from './MarkdownContent';
import { showQueuedNotice, hideQueueNotice, trackLlmCall } from '../utils/llmQueueNotice';

interface ChatItem {
  id: number; title: string; createdBy: string;
  createdAt: string; updatedAt: string; lastMessage: string; messageCount: number;
}
interface Msg {
  id: number | null; role: string; content: string;
  thinking?: string; error?: string | null;
}

const TOKEN = () => localStorage.getItem('llm_learn_token');

/** SSE 流式请求：手动解析 event/data 帧（`\\n\\n` 分帧，心跳注释行忽略） */
async function streamPost(path: string, body: any, handlers: Record<string, (d: any) => void>) {
  const resp = await fetch('/api' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN()}` },
    body: JSON.stringify(body),
  });
  if (!resp.ok || !resp.body) {
    const d = await resp.json().catch(() => ({}));
    throw new Error(d.message || `HTTP ${resp.status}`);
  }
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    buf += dec.decode(r.value, { stream: true });
    const frames = buf.split('\n\n');
    buf = frames.pop() || '';
    for (const frame of frames) {
      let ev = '', data = '';
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) ev = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (!ev || !data) continue;
      let payload: any;
      try { payload = JSON.parse(data); } catch { continue; }
      handlers[ev]?.(payload);
    }
  }
}

async function jsonFetch(path: string, method: string, body?: any) {
  const r = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN()}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.message || `HTTP ${r.status}`);
  return d;
}

export default function AssistantDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [chats, setChats] = useState<ChatItem[]>([]);
  const [currentChatId, setCurrentChatId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const streamingChat = useRef<number | null>(null);

  const [models, setModels] = useState<any[]>([]);
  const [modelId, setModelId] = useState<number | null>(null);

  const [input, setInput] = useState('');
  const inputRef = useRef<any>(null);
  const msgsRef = useRef<HTMLDivElement>(null);

  // 会话重命名
  const [renaming, setRenaming] = useState<ChatItem | null>(null);
  const [renameVal, setRenameVal] = useState('');

  // 沉淀：管理员预览数据 / 普通用户提交表单
  const [preview, setPreview] = useState<any>(null);
  const [previewTitle, setPreviewTitle] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [subModal, setSubModal] = useState<{ qid: number; aid: number } | null>(null);
  const [subStars, setSubStars] = useState(3);
  const [subArticle, setSubArticle] = useState('');
  const [subReview, setSubReview] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadModels = useCallback(() => {
    fetch('/api/llm/models', { headers: { Authorization: `Bearer ${TOKEN()}` } })
      .then(r => r.json())
      .then(d => {
        const enabled = (d.models || []).filter((m: any) => m.status === 'enabled');
        setModels(enabled);
        const saved = Number(localStorage.getItem('llm_ai_model')) || null;
        const def = enabled.find((m: any) => m.id === saved)
          || enabled.find((m: any) => m.isGlobal) || enabled[0] || null;
        setModelId(def ? def.id : null);
      })
      .catch(() => {});
  }, []);

  const loadChats = useCallback((autoSelect?: boolean) => {
    fetch('/api/ai/chats', { headers: { Authorization: `Bearer ${TOKEN()}` } })
      .then(r => r.json())
      .then(d => {
        setChats(d.chats || []);
        if (autoSelect && !currentChatId && d.chats?.length) selectChat(d.chats[0].id);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentChatId]);

  const selectChat = (id: number) => {
    setCurrentChatId(id);
    setLoadingMsgs(true);
    fetch(`/api/ai/chats/${id}/messages`, { headers: { Authorization: `Bearer ${TOKEN()}` } })
      .then(r => r.json())
      .then(d => setMessages(d.messages || []))
      .catch(() => setMessages([]))
      .finally(() => setLoadingMsgs(false));
  };

  useEffect(() => {
    if (!open || !user) return;
    loadModels();
    loadChats(true);
    setTimeout(() => inputRef.current?.focus(), 200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 消息变化时自动滚到底部
  useEffect(() => {
    const el = msgsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loadingMsgs]);

  const newChat = async () => {
    try {
      const d = await jsonFetch('/ai/chats', 'POST');
      await Promise.resolve(loadChats());
      selectChat(d.chat.id);
    } catch (e: any) { message.error(e.message || '新建会话失败'); }
  };

  const doRename = async () => {
    if (!renaming || !renameVal.trim()) return;
    try {
      await jsonFetch(`/ai/chats/${renaming.id}`, 'PATCH', { title: renameVal.trim() });
      setRenaming(null);
      loadChats();
    } catch (e: any) { message.error(e.message || '重命名失败'); }
  };

  const doDelete = async (c: ChatItem) => {
    try {
      await jsonFetch(`/ai/chats/${c.id}`, 'DELETE');
      if (currentChatId === c.id) { setCurrentChatId(null); setMessages([]); }
      loadChats(true);
    } catch (e: any) { message.error(e.message || '删除失败'); }
  };

  const send = async () => {
    if (streaming) return;
    const content = input.trim();
    if (!content) return;
    if (!modelId) { message.warning('请先让管理员在「🛡 管理 → 模型配置」里配置并启用一个模型'); return; }
    let chatId = currentChatId;
    try {
      if (!chatId) {
        const d = await jsonFetch('/ai/chats', 'POST');
        chatId = d.chat.id;
        setCurrentChatId(chatId);
        loadChats();
      }
      doSend(chatId as number, content);
    } catch (e: any) { message.error(e.message || '发送失败'); }
  };

  const doSend = (chatId: number, content: string) => {
    setInput('');
    setStreaming(true);
    streamingChat.current = chatId;
    const um: Msg = { id: null, role: 'user', content };
    const am: Msg = { id: null, role: 'assistant', content: '', thinking: '', error: null };
    setMessages(prev => [...prev, um, am]);

    const patch = (fn: (m: Msg) => Msg) => {
      setMessages(prev => {
        if (streamingChat.current !== chatId) return prev;
        const i = prev.length - 1;
        if (i < 0 || prev[i].role !== 'assistant') return prev;
        const next = [...prev];
        next[i] = fn(next[i]);
        return next;
      });
    };

    streamPost(`/ai/chats/${chatId}/messages`, { content, modelId }, {
      queued: d => showQueuedNotice(d),
      start: () => hideQueueNotice(),
      delta: d => patch(m => ({ ...m, content: m.content + d.text })),
      thinking: d => patch(m => ({ ...m, thinking: (m.thinking || '') + d.text })),
      result: d => {
        patch(m => ({ ...m, id: d.messageId }));
        // 回填本轮提问的 id：沉淀按钮需要配对的 userMessageId，不回填则当轮刚答完的回答不显示按钮
        if (d.userMessageId) {
          setMessages(prev => {
            if (streamingChat.current !== chatId) return prev;
            for (let i = prev.length - 1; i >= 0; i--) {
              if (prev[i].role !== 'user') continue;
              if (prev[i].id !== null) return prev;
              const next = [...prev];
              next[i] = { ...prev[i], id: d.userMessageId };
              return next;
            }
            return prev;
          });
        }
      },
      error: d => patch(m => ({ ...m, error: d.error })),
    }).then(() => {
      setStreaming(false);
      streamingChat.current = null;
      hideQueueNotice();
      loadChats();
    }).catch(e => {
      setStreaming(false);
      streamingChat.current = null;
      hideQueueNotice();
      // 已有部分内容则保留流式结果，否则在气泡里展示错误；提问本身已保留（SPEC §4.2）
      patch(m => ({ ...m, error: m.content ? null : String(e.message || e) }));
    });
  };

  // ===== 沉淀为知识点 =====
  const startDeposit = async (qid: number, aid: number) => {
    if (!currentChatId || !aid || !qid) {
      message.info('该回答缺少配对的提问记录，无法沉淀');
      return;
    }
    // 普通用户走审核流：填表单提交，管理员审核时才做 AI 信息抽取
    if (!isAdmin) {
      setSubStars(3); setSubArticle(''); setSubReview('');
      setSubModal({ qid, aid });
      return;
    }
    setPreviewLoading(true);
    try {
      const d = await trackLlmCall(jsonFetch('/ai/knowledge/preview', 'POST', {
        chatId: currentChatId, questionId: qid, answerId: aid,
      }));
      setPreview({ ...d, qid, aid });
      setPreviewTitle(d.decision?.title || '');
    } catch (e: any) { message.error(e.message || '标题提取失败'); }
    finally { setPreviewLoading(false); }
  };

  const applyDeposit = async () => {
    if (!preview || !currentChatId) return;
    setApplying(true);
    try {
      const decision = { ...preview.decision, title: previewTitle.trim() || preview.decision.title };
      const d = await jsonFetch('/ai/knowledge/apply', 'POST', {
        chatId: currentChatId, questionId: preview.qid, answerId: preview.aid, decision,
      });
      message.success(`✨ 已沉淀为知识点「${d.title}」并加入图谱`);
      setPreview(null);
      window.dispatchEvent(new CustomEvent('kg:ai-knowledge-updated'));
    } catch (e: any) { message.error(e.message || '写入失败'); }
    finally { setApplying(false); }
  };

  const submitDeposit = async () => {
    if (!subModal || !currentChatId) return;
    setSubmitting(true);
    try {
      await jsonFetch('/ai/submissions', 'POST', {
        chatId: currentChatId, questionId: subModal.qid, answerId: subModal.aid,
        importance: subStars, articleNote: subArticle, reviewNote: subReview,
      });
      message.success('✅ 已提交审核，通过后就会出现在图谱上（进度看顶栏「📥 沉淀」）');
      setSubModal(null);
    } catch (e: any) { message.error(e.message || '提交失败'); }
    finally { setSubmitting(false); }
  };

  // 渲染消息列表：给每条 AI 回答配对它前面最近的一条用户提问（沉淀需要 questionId）
  const renderMessages = () => {
    if (loadingMsgs) {
      return <div style={{ margin: 'auto', color: '#999' }}><Spin /> 加载消息…</div>;
    }
    if (!messages.length) {
      return (
        <div style={{ margin: 'auto', textAlign: 'center', color: '#999', padding: '0 30px' }}>
          <RobotOutlined style={{ fontSize: 40, color: '#d5d8de', marginBottom: 12 }} />
          <div style={{ fontWeight: 600, color: '#666', marginBottom: 4 }}>向 AI 助手提问</div>
          <div style={{ fontSize: 12, lineHeight: 1.8 }}>
            浏览图谱时随时来这里问问题（支持多轮对话）<br />
            满意的回答可「✨ 沉淀为知识点」，审核通过后进入图谱
          </div>
        </div>
      );
    }
    let lastQid: number | null = null;
    return messages.map((m, i) => {
      if (m.role === 'user') {
        if (m.id) lastQid = m.id;
        return (
          <div key={i} style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
            <div style={{
              maxWidth: '86%', background: '#1677ff', color: '#fff',
              borderRadius: '10px 10px 2px 10px', padding: '8px 12px',
              whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.7,
            }}>{m.content}</div>
          </div>
        );
      }
      const qid = lastQid;
      const showDeposit = m.id && qid && !streaming;
      return (
        <div key={i} style={{ marginBottom: 14 }}>
          {m.thinking ? (
            <details className="ai-thinking" style={{ marginBottom: 6 }}>
              <summary style={{ cursor: 'pointer', color: '#999', fontSize: 12 }}>💭 思考过程</summary>
              <div style={{ color: '#888', fontSize: 12, whiteSpace: 'pre-wrap', padding: '6px 0' }}>{m.thinking}</div>
            </details>
          ) : null}
          <div style={{
            background: '#f4f5f7', borderRadius: '2px 10px 10px 10px',
            padding: '8px 12px', fontSize: 14,
          }}>
            {m.content ? <MarkdownContent content={m.content} />
              : m.error ? <span style={{ color: '#e04040' }}>⚠ {m.error}</span>
              : <><LoadingOutlined style={{ color: '#999' }} /> AI 正在回答…</>}
          </div>
          {showDeposit && (
            <Button
              size="small" style={{ marginTop: 6 }} disabled={previewLoading}
              onClick={() => startDeposit(qid as number, m.id as number)}
            >{previewLoading ? '⏳ AI 正在提取标题…' : '✨ 沉淀为知识点'}</Button>
          )}
        </div>
      );
    });
  };

  const d = preview?.decision;

  return (
    <>
      <Drawer
        open={open} onClose={onClose} width={640}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>💬 AI 助手</span>
            <span style={{ fontSize: 12, color: '#999', fontWeight: 400 }}>我的会话 · 仅自己可见</span>
          </div>
        }
        styles={{ body: { padding: 0 } }}
      >
        <div style={{ display: 'flex', height: '100%' }}>
          {/* 左：会话列表 */}
          <div style={{
            width: 190, borderRight: '1px solid #f0f0f0', display: 'flex', flexDirection: 'column',
            background: '#fafbfc',
          }}>
            <div style={{ padding: 8, borderBottom: '1px solid #f0f0f0' }}>
              <Button size="small" block icon={<PlusOutlined />} onClick={newChat}>新会话</Button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {chats.length ? chats.map(c => (
                <div
                  key={c.id}
                  onClick={() => !streaming && selectChat(c.id)}
                  style={{
                    padding: '8px 10px', cursor: 'pointer',
                    background: c.id === currentChatId ? '#e8f1ff' : 'transparent',
                    borderBottom: '1px solid #f5f5f5',
                  }}
                  className="ai-session-item"
                >
                  <div style={{
                    fontSize: 13, fontWeight: c.id === currentChatId ? 600 : 400,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }} title={c.title}>{c.title}</div>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    fontSize: 11, color: '#999', marginTop: 2,
                  }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {String(c.updatedAt || '').slice(5, 16).replace('T', ' ')}
                    </span>
                    <span className="ai-session-ops" style={{ flexShrink: 0 }}>
                      <EditOutlined style={{ marginRight: 6 }} onClick={e => {
                        e.stopPropagation();
                        setRenaming(c); setRenameVal(c.title);
                      }} />
                      <Popconfirm title={`删除会话「${c.title}」？全部消息一并删除。`} onConfirm={() => doDelete(c)}>
                        <DeleteOutlined onClick={e => e.stopPropagation()} />
                      </Popconfirm>
                    </span>
                  </div>
                </div>
              )) : (
                <p style={{ padding: '6px 10px', fontSize: 12, color: '#999' }}>还没有会话，发首个提问或点「新会话」</p>
              )}
            </div>
          </div>

          {/* 右：聊天区 */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <div style={{
              padding: '6px 12px', borderBottom: '1px solid #f0f0f0',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{ fontSize: 12, color: '#666' }}>对话模型</span>
              <Select
                size="small" style={{ minWidth: 170 }}
                value={modelId ?? undefined}
                onChange={v => { setModelId(v); localStorage.setItem('llm_ai_model', String(v || '')); }}
                placeholder={models.length ? '选择模型' : '未配置模型'}
                disabled={!models.length}
                options={models.map((m: any) => ({
                  value: m.id, label: m.name + (m.isGlobal ? '（全局默认）' : ''),
                }))}
              />
            </div>

            <div ref={msgsRef} style={{
              flex: 1, overflowY: 'auto', padding: 14,
              display: messages.length || loadingMsgs ? 'block' : 'flex',
            }}>
              {renderMessages()}
            </div>

            <div style={{ borderTop: '1px solid #f0f0f0', padding: 10, display: 'flex', gap: 8 }}>
              <Input.TextArea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                autoSize={{ minRows: 1, maxRows: 6 }}
                placeholder={currentChatId ? '输入问题，点「发送」按钮发送（回车换行）' : '输入问题开始新对话，点「发送」按钮发送'}
                disabled={!user}
              />
              <Button type="primary" icon={<SendOutlined />} loading={streaming}
                onClick={send} style={{ alignSelf: 'flex-end' }}>发送</Button>
            </div>
          </div>
        </div>
      </Drawer>

      {/* 会话重命名 */}
      <Modal
        open={!!renaming} title="修改会话标题" onCancel={() => setRenaming(null)}
        onOk={doRename} okText="保存" cancelText="取消"
      >
        <Input value={renameVal} onChange={e => setRenameVal(e.target.value)}
          maxLength={60} onPressEnter={doRename} placeholder="会话标题" />
      </Modal>

      {/* 管理员：沉淀预览（AI 只提取标题/分类/标签，正文 = 回答原文）→ 确认写入 */}
      <Modal
        open={!!preview} title="✨ 沉淀为知识点（确认后写入图谱）"
        onCancel={() => setPreview(null)}
        width={720}
        footer={[
          <Button key="cancel" onClick={() => setPreview(null)}>取消</Button>,
          <Button key="ok" type="primary" loading={applying} onClick={applyDeposit}>
            ✅ 确认沉淀
          </Button>,
        ]}
      >
        {d && (
          <div>
            <div style={{ marginBottom: 8 }}>
              <span style={{ fontSize: 13, marginRight: 8 }}>标题（可修改）：</span>
              <Input value={previewTitle} onChange={e => setPreviewTitle(e.target.value)}
                style={{ width: 360 }} maxLength={80} />
            </div>
            <div style={{ marginBottom: 12, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {d.category && <Tag color="geekblue">{d.category}</Tag>}
              <Tag color="blue">未分层</Tag>
              {(d.tags || []).map((t: string) => <Tag key={t}>{t}</Tag>)}
            </div>
            <div style={{
              border: '1px solid #f0f0f0', borderRadius: 8,
              maxHeight: '46vh', overflowY: 'auto', padding: '8px 12px', background: '#fafbfc',
            }}>
              <MarkdownContent content={preview?.content || ''} />
            </div>
            <p style={{ color: '#999', fontSize: 12, marginTop: 8 }}>
              正文为回答原文（不改写、不总结），分类与标签由 AI 顺带给出。
            </p>
          </div>
        )}
      </Modal>

      {/* 普通用户：提交审核表单 */}
      <Modal
        open={!!subModal} title="📤 提交给管理员审核"
        onCancel={() => setSubModal(null)}
        onOk={submitDeposit}
        okText="📤 提交审核" cancelText="取消"
        confirmLoading={submitting}
      >
        <p style={{ color: '#888', fontSize: 12, marginBottom: 12 }}>
          提交后不直接进图谱；管理员审核时会用 AI 做信息抽取、判断怎么放进图谱。你填的信息能帮管理员更快判断。
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
    </>
  );
}
