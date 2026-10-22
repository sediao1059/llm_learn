import { useEffect, useRef, useState } from 'react';
import { Modal, Button, Tag, Input, Divider, Popconfirm, Segmented, Spin, message } from 'antd';
import MarkdownContent from './MarkdownContent';
import { fmtShort } from '../utils/format';
import { useAuth } from '../store/auth';

const TOKEN = () => localStorage.getItem('llm_learn_token');

/**
 * 注解阅读弹窗（点正文荧光高亮 / 兜底条目打开）：引用原文 + 问题 + markdown 答案，
 * 下方是知乎式讨论区——针对整条注解向 AI 提问（SSE 流式，问答对沉淀共享）或发表评论。
 */
export default function AnnotationReadModal({ anno, onClose }: {
  anno: any;
  onClose: () => void;
}) {
  const user = useAuth(s => s.user);
  const [replies, setReplies] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'comment' | 'qa'>('qa');
  const [comment, setComment] = useState('');
  const [question, setQuestion] = useState('');
  const [posting, setPosting] = useState(false);
  const [asking, setAsking] = useState(false);
  const [askAnswer, setAskAnswer] = useState('');
  const [askError, setAskError] = useState('');
  const askAbort = useRef<AbortController | null>(null);

  const annoId = anno?.id;

  useEffect(() => {
    setReplies([]);
    setComment('');
    setQuestion('');
    setAskAnswer('');
    setAskError('');
    if (!annoId) return;
    setLoading(true);
    fetch(`/api/ai/annotations/${annoId}/replies`, { headers: { Authorization: `Bearer ${TOKEN()}` } })
      .then(r => r.json())
      .then(d => setReplies(d.replies || []))
      .catch(() => setReplies([]))
      .finally(() => setLoading(false));
  }, [annoId]);

  // 关闭/切换时中断进行中的流式提问
  useEffect(() => () => askAbort.current?.abort(), []);

  /** 发表评论：即时全员可见 */
  const submitComment = async () => {
    const c = comment.trim();
    if (!c || posting) return;
    setPosting(true);
    try {
      const resp = await fetch(`/api/ai/annotations/${annoId}/replies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN()}` },
        body: JSON.stringify({ content: c }),
      });
      const d = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(d.message || '发表失败');
      setReplies(prev => [...prev, d.reply]);
      setComment('');
      message.success('评论已发表');
    } catch (e: any) {
      message.error(e.message || '发表失败');
    } finally {
      setPosting(false);
    }
  };

  /** 针对整条注解向 AI 提问：SSE 流式解答，完成后问答对沉淀进讨论区 */
  const askAI = async () => {
    const q = question.trim();
    if (!q || asking) return;
    setAsking(true);
    setAskAnswer('');
    setAskError('');
    const ac = new AbortController();
    askAbort.current = ac;
    try {
      const resp = await fetch(`/api/ai/annotations/${annoId}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN()}` },
        signal: ac.signal,
        body: JSON.stringify({ question: q }),
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
              setAskAnswer(full);
            } else if (ev === 'result' && payload.reply) {
              setReplies(prev => [...prev, payload.reply]);
              setQuestion('');
              setAskAnswer('');
              message.success('问答已沉淀到讨论区');
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
      if (e?.name !== 'AbortError') setAskError(e.message || '生成失败');
    } finally {
      setAsking(false);
    }
  };

  const delReply = async (r: any) => {
    const resp = await fetch(`/api/ai/annotations/${annoId}/replies/${r.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${TOKEN()}` },
    });
    if (resp.ok) setReplies(prev => prev.filter(x => x.id !== r.id));
    else message.error('删除失败');
  };

  const canDelete = (r: any) => user && (user.username === r.createdBy || user.role === 'admin');

  const close = () => {
    askAbort.current?.abort();
    onClose();
  };

  return (
    <Modal
      open={!!anno}
      onCancel={close}
      title="💬 注解阅读"
      width={640}
      footer={<Button onClick={close}>关闭</Button>}
      maskClosable={!asking}
      keyboard={!asking}
    >
      {anno && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <Tag>
              {anno.type === 'word' ? '词' : anno.type === 'sentence' ? '句'
                : anno.type === 'paragraph' ? '段' : anno.type === 'document' ? '整篇'
                : anno.type === 'interview' ? '💼 高频面试题' : anno.type}
            </Tag>
            {anno.status !== 'approved' && (
              <Tag color={anno.status === 'pending' ? 'warning' : 'error'}>
                {anno.status === 'pending' ? '待审核（仅自己可见）' : '已驳回'}
              </Tag>
            )}
            <span style={{ fontSize: 12, color: '#bfbfbf', marginLeft: 'auto' }}>{anno.createdBy}</span>
          </div>
          {anno.anchorText && (
            <div style={{
              borderLeft: '3px solid #f5222d', background: '#fff1f0',
              borderRadius: '0 8px 8px 0', padding: '6px 12px',
              fontSize: 13, color: '#8c8c8c', marginBottom: 10,
            }}>「{anno.anchorText}」</div>
          )}
          {anno.question && (
            <div style={{ fontSize: 13, color: '#333', marginBottom: 10 }}>
              <b>问：</b>{anno.question}
            </div>
          )}
          <MarkdownContent content={anno.answer || '（暂无内容）'} fontSize={14} />

          <Divider style={{ margin: '16px 0 8px', fontSize: 13, color: '#8c8c8c' }}>
            讨论{replies.length ? ` · ${replies.length}` : ''}
          </Divider>

          <div style={{ maxHeight: '40vh', overflowY: 'auto' }}>
            {loading ? (
              <div style={{ textAlign: 'center', padding: '12px 0' }}><Spin size="small" /></div>
            ) : replies.length === 0 && !asking ? (
              <div style={{ fontSize: 12, color: '#bfbfbf', padding: '4px 0 8px' }}>
                还没有讨论 · 可以向 AI 提问，或写下你的看法
              </div>
            ) : replies.map((r: any) => (
              <div key={r.id} style={{ padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#8c8c8c' }}>
                  <b style={{ color: '#595959' }}>{r.createdBy}</b>
                  {r.kind === 'qa' ? '向 AI 提问' : '评论'} · {fmtShort(r.createdAt)}
                  {canDelete(r) && (
                    <Popconfirm title="删除这条讨论内容？" onConfirm={() => delReply(r)}>
                      <a style={{ marginLeft: 'auto', fontSize: 12 }}>删除</a>
                    </Popconfirm>
                  )}
                </div>
                {r.kind === 'qa' ? (
                  <>
                    <div style={{ fontSize: 13, color: '#333', marginTop: 4 }}><b>问：</b>{r.question}</div>
                    <div style={{ marginTop: 4 }}>
                      <MarkdownContent content={r.content} fontSize={13} />
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 13, color: '#333', marginTop: 4, whiteSpace: 'pre-wrap' }}>{r.content}</div>
                )}
              </div>
            ))}

            {/* 流式解答实时预览（完成后落入上方列表） */}
            {asking && (
              <div style={{ padding: '8px 0' }}>
                <div style={{ fontSize: 13, color: '#333' }}><b>问：</b>{question}</div>
                <div style={{ marginTop: 4 }}>
                  {askAnswer ? (
                    <>
                      <MarkdownContent content={askAnswer} fontSize={13} />
                      <span style={{ display: 'inline-block', color: '#1677ff', fontSize: 20, lineHeight: 1, animation: 'blink 1s infinite' }}>▍</span>
                    </>
                  ) : (
                    <span style={{ fontSize: 12, color: '#8c8c8c' }}>AI 正在结合这条注解解答…</span>
                  )}
                </div>
              </div>
            )}
            {askError && <div style={{ fontSize: 12, color: '#ff4d4f', padding: '4px 0' }}>⚠ {askError}</div>}
          </div>

          <div style={{ marginTop: 10 }}>
            <Segmented
              size="small"
              value={mode}
              onChange={v => setMode(v as 'comment' | 'qa')}
              options={[
                { label: '💡 向 AI 提问', value: 'qa' },
                { label: '💬 写评论', value: 'comment' },
              ]}
              disabled={asking}
              style={{ marginBottom: 8 }}
            />
            {mode === 'qa' ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <Input
                  placeholder="针对这条注解提问，如「能不能举个具体例子」"
                  value={question}
                  onChange={e => setQuestion(e.target.value)}
                  onPressEnter={askAI}
                  maxLength={500}
                  disabled={asking}
                />
                <Button type="primary" loading={asking} onClick={askAI} disabled={!question.trim()}>提问</Button>
              </div>
            ) : (
              <div>
                <Input.TextArea
                  rows={2}
                  placeholder="写下你对这条注解的看法或补充（全员可见）"
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  maxLength={2000}
                  disabled={posting}
                />
                <div style={{ textAlign: 'right', marginTop: 6 }}>
                  <Button type="primary" size="small" loading={posting} onClick={submitComment} disabled={!comment.trim()}>
                    发表评论
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
