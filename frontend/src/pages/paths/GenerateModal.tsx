import { useState, useRef, useEffect } from 'react';
import { Modal, Input, Button, Spin, Tag, Collapse, message } from 'antd';
import { SendOutlined } from '@ant-design/icons';

interface ChatMsg {
  role: 'user' | 'assistant';
  content?: string;
  tree?: any;
  error?: string;
  loading?: boolean;
}

export default function GenerateModal({
  open, onClose, pathId, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  pathId?: number;
  onSaved: () => void;
}) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [generating, setGenerating] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const send = async () => {
    if (!input.trim() || generating) return;
    const text = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: text }, { role: 'assistant', loading: true }]);
    setGenerating(true);
    try {
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('llm_learn_token')}`,
      };
      const payload = pathId ? { pathId, feedback: text } : { goal: text };
      const r = await fetch('/api/ai/paths/generate', {
        method: 'POST', headers, body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message || '生成失败');
      setMessages(prev => [...prev.slice(0, -1), { role: 'assistant', tree: d.tree }]);
    } catch (e: any) {
      setMessages(prev => [...prev.slice(0, -1), { role: 'assistant', error: e.message }]);
    } finally { setGenerating(false); }
  };

  const save = async (tree: any) => {
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${localStorage.getItem('llm_learn_token')}`,
    };
    const r = await fetch('/api/ai/paths', {
      method: 'POST', headers,
      body: JSON.stringify({ title: tree.title, goal: '', tree }),
    });
    if (r.ok) {
      message.success('路线已保存');
      onSaved();
      onClose();
      setMessages([]);
    } else message.error('保存失败');
  };

  return (
    <Modal
      open={open} onCancel={() => { onClose(); setMessages([]); }}
      title="🤖 AI 定制学习路线" width={680} footer={null}
    >
      <div style={{ height: 400, overflowY: 'auto', marginBottom: 12, padding: '0 4px' }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', paddingTop: 100, color: '#8c8c8c' }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🗺</div>
            <p>告诉 AI 你想学什么，它按图谱知识给你排一条路线</p>
            <p style={{ fontSize: 12 }}>例如：我想学 RAG 应用开发，有 Java 后端基础</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{
            display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 12,
          }}>
            {m.role === 'user' ? (
              <div style={{
                background: '#1677ff', color: '#fff', padding: '8px 14px',
                borderRadius: '12px 12px 2px 12px', maxWidth: '70%', fontSize: 13,
              }}>{m.content}</div>
            ) : m.loading ? (
              <Spin />
            ) : m.error ? (
              <div style={{ color: '#ff4d4f', fontSize: 13 }}>⚠ {m.error}</div>
            ) : m.tree ? (
              <div style={{ width: '88%' }}>
                <div style={{
                  border: '1px solid #e8e8e8', borderRadius: 8, padding: 12, background: '#fafafa',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <b>{m.tree.title}</b>
                    <Button size="small" type="primary" onClick={() => save(m.tree)}>💾 保存</Button>
                  </div>
                  {m.tree.summary && <p style={{ color: '#8c8c8c', fontSize: 12 }}>{m.tree.summary}</p>}
                  <Collapse size="small">
                    {(m.tree.stages || []).map((st: any, si: number) => (
                      <Collapse.Panel key={si} header={`阶段 ${si + 1} · ${st.title}`}>
                        {(st.items || []).map((it: any, ii: number) => (
                          <div key={ii} style={{ fontSize: 12, padding: '2px 0', display: 'flex', gap: 6, alignItems: 'center' }}>
                            <span>{it.title}</span>
                            {it.refId ? <Tag color="success" style={{ fontSize: 10 }}>已关联</Tag> : <Tag style={{ fontSize: 10 }}>新主题</Tag>}
                          </div>
                        ))}
                      </Collapse.Panel>
                    ))}
                  </Collapse>
                </div>
              </div>
            ) : null}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Input.TextArea
          value={input} onChange={e => setInput(e.target.value)}
          onPressEnter={e => { if (!e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="输入学习目标…（Enter 发送）"
          autoSize={{ minRows: 1, maxRows: 3 }} disabled={generating}
        />
        <Button type="primary" icon={<SendOutlined />} loading={generating} onClick={send}>发送</Button>
      </div>
    </Modal>
  );
}
