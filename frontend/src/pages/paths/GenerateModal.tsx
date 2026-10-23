import { useState, useRef, useEffect } from 'react';
import { Modal, Input, Button, Tag, Collapse, message, Progress } from 'antd';
import { SendOutlined } from '@ant-design/icons';
import { trackLlmCall } from '../../utils/llmQueueNotice';

interface ChatMsg {
  role: 'user' | 'assistant';
  content?: string;
  tree?: any;
  error?: string;
  loading?: boolean;
}

const STEPS = [
  { icon: '📋', text: '检索相关知识', ms: 5000 },
  { icon: '🧠', text: '理解学习目标', ms: 6000 },
  { icon: '🗺', text: '规划学习阶段', ms: 8000 },
  { icon: '📚', text: '权衡知识点取舍', ms: 8000 },
  { icon: '⚡', text: '优化路线结构', ms: 8000 },
];

function StepProgress({ startTime, done }: { startTime: number; done: boolean }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (done) return;
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [startTime, done]);

  // 根据已用时间确定当前步骤
  let acc = 0;
  let currentStep = 0;
  for (let i = 0; i < STEPS.length; i++) {
    acc += STEPS[i].ms;
    if (elapsed * 1000 < acc) { currentStep = i; break; }
    currentStep = i + 1;
  }

  const pct = done ? 100 : Math.min(Math.floor((elapsed / 60) * 80), 80);
  const activeStep = Math.min(currentStep, STEPS.length - 1);

  return (
    <div style={{ padding: '20px 16px' }}>
      <div style={{ fontSize: 14, marginBottom: 12, color: done ? '#52c41a' : '#1677ff' }}>
        {done ? '✅ 生成完成' : `${STEPS[activeStep].icon} AI 正在${STEPS[activeStep].text}...`}
      </div>
      <div style={{ color: '#8c8c8c', fontSize: 12, marginBottom: 16 }}>
        ⏱ 已用时 {elapsed} 秒 · 预计 30-60 秒
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
        {STEPS.map((step, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 13, color: done || i < currentStep ? '#52c41a' : i === currentStep ? '#1677ff' : '#bfbfbf',
          }}>
            <span style={{ width: 18, textAlign: 'center', fontSize: 12 }}>
              {done || i < currentStep ? '✅' : i === currentStep ? '🔄' : '⏳'}
            </span>
            {step.text}
          </div>
        ))}
      </div>
      <Progress percent={pct} size="small" strokeColor={done ? '#52c41a' : '#1677ff'} />
    </div>
  );
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
  const [genStartTime, setGenStartTime] = useState(0);
  const [genDone, setGenDone] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, generating]);

  const send = async () => {
    if (!input.trim() || generating) return;
    const text = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: text }, { role: 'assistant', loading: true }]);
    setGenerating(true);
    setGenStartTime(Date.now());
    setGenDone(false);

    try {
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('llm_learn_token')}`,
      };
      const payload = pathId ? { pathId, feedback: text } : { goal: text };
      const r = await trackLlmCall(fetch('/api/ai/paths/generate', {
        method: 'POST', headers, body: JSON.stringify(payload),
      }));
      const d = await r.json();
      setGenDone(true);
      setTimeout(() => setGenerating(false), 600);
      if (!r.ok) throw new Error(d.message || '生成失败');
      setMessages(prev => [...prev.slice(0, -1), { role: 'assistant', tree: d.tree }]);
    } catch (e: any) {
      setGenDone(true);
      setTimeout(() => setGenerating(false), 400);
      setMessages(prev => [...prev.slice(0, -1), { role: 'assistant', error: e.message }]);
    }
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
      maskClosable={!generating} keyboard={!generating}
    >
      <div style={{ height: 'min(420px, 52vh)', overflowY: 'auto', marginBottom: 12, padding: '0 4px' }}>
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
              <div style={{ width: '100%', background: '#fafafa', borderRadius: 12, border: '1px solid #e8e8e8' }}>
                <StepProgress startTime={genStartTime} done={genDone} />
              </div>
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
                  <Collapse>
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
          placeholder={generating ? 'AI 正在生成中…' : '输入学习目标…（Enter 发送，Shift+Enter 换行）'}
          autoSize={{ minRows: 1, maxRows: 3 }} disabled={generating}
        />
        <Button type="primary" icon={<SendOutlined />} loading={generating} onClick={send}
          disabled={!input.trim()}>
          发送
        </Button>
      </div>
    </Modal>
  );
}
