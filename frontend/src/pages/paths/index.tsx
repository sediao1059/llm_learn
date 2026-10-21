import { useEffect, useState, useRef } from 'react';
import { Card, Button, Input, Tag, Collapse, Empty, Spin, List, Modal, message } from 'antd';
import { SendOutlined, SaveOutlined } from '@ant-design/icons';
import { api } from '../../api/client';
import { useAuth } from '../../store/auth';

interface ChatMsg { role: 'user' | 'assistant'; content?: string; tree?: any; error?: string; loading?: boolean; }
interface PathItem { id: number; title: string; isOfficial: boolean; createdBy: string; tree: any; goal: string; }

export default function PathsPage() {
  const { user } = useAuth();
  const [paths, setPaths] = useState<PathItem[]>([]);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [generating, setGenerating] = useState(false);
  const [currentPathId, setCurrentPathId] = useState<number | null>(null);
  const [currentTree, setCurrentTree] = useState<any>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveTitle, setSaveTitle] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get('/ai/paths').then(r => setPaths(r.data.paths || [])).catch(() => {});
  }, []);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const send = async () => {
    if (!input.trim() || generating) return;
    const text = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: text }, { role: 'assistant', loading: true }]);
    setGenerating(true);
    try {
      const payload = currentPathId && currentTree
        ? { pathId: currentPathId, feedback: text }
        : { goal: text };
      const { data } = await api.post('/ai/paths/generate', payload);
      setCurrentTree(data.tree);
      setMessages(prev => [...prev.slice(0, -1), { role: 'assistant', tree: data.tree }]);
    } catch (e: any) {
      setMessages(prev => [...prev.slice(0, -1), { role: 'assistant', error: e?.response?.data?.message || '生成失败' }]);
    } finally { setGenerating(false); }
  };

  const savePath = async () => {
    if (!currentTree) return;
    try {
      const { data } = await api.post('/ai/paths', { title: saveTitle || currentTree.title, goal: '', tree: currentTree });
      setCurrentPathId(data.path.id);
      message.success('已保存');
      setSaveOpen(false);
      api.get('/ai/paths').then(r => setPaths(r.data.paths || []));
    } catch (e: any) { message.error(e?.response?.data?.message || '保存失败'); }
  };

  const openPath = (p: PathItem) => {
    setCurrentPathId(p.id);
    setCurrentTree(p.tree);
    setMessages(prev => [
      ...prev,
      { role: 'user', content: `打开路线「${p.title}」` },
      { role: 'assistant', tree: p.tree },
    ]);
  };

  const renderTree = (tree: any) => (
    <Card size="small" title={tree.title} extra={
      <Button size="small" type="primary" icon={<SaveOutlined />} onClick={() => { setSaveTitle(tree.title); setSaveOpen(true); }}>
        保存
      </Button>
    }>
      {tree.summary && <p style={{ color: '#909399', fontSize: 13 }}>{tree.summary}</p>}
      <Collapse>
        {(tree.stages || []).map((st: any, i: number) => (
          <Collapse.Panel key={i} header={`阶段 ${i + 1} · ${st.title}`}>
            <div style={{ color: '#909399', fontSize: 12, marginBottom: 8 }}>{st.goal}</div>
            {(st.items || []).map((it: any, j: number) => (
              <div key={j} style={{ padding: '4px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                <b>{it.title}</b>
                {it.refId ? (
                  <Tag color="success" style={{ cursor: 'pointer' }} onClick={() => window.open(`/?node=${it.refId}`, '_blank')}>
                    🔗 关联 ↗
                  </Tag>
                ) : <Tag>新主题</Tag>}
                {it.why && <span style={{ color: '#c0c4cc', fontSize: 12 }}>{it.why}</span>}
              </div>
            ))}
          </Collapse.Panel>
        ))}
      </Collapse>
    </Card>
  );

  return (
    <div style={{ display: 'flex', gap: 16, padding: 16, height: 'calc(100vh - 56px)' }}>
      <div style={{ width: 280, flexShrink: 0 }}>
        <Card title="已保存的路线" size="small">
          <List
            dataSource={paths}
            renderItem={(p) => (
              <List.Item style={{ cursor: 'pointer', padding: '8px 4px' }} onClick={() => openPath(p)}>
                <List.Item.Meta
                  title={<span>{p.isOfficial && <Tag color="warning" style={{ marginRight: 4 }}>⭐</Tag>}{p.title}</span>}
                  description={`${p.createdBy} · ${p.tree?.stages?.length || 0} 个阶段`}
                />
              </List.Item>
            )}
            locale={{ emptyText: <Empty description="还没有路线" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
          />
        </Card>
      </div>

      <Card style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }} styles={{ body: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 0 } }}>
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {messages.length === 0 && (
            <Empty description={
              <div>
                <p>和 AI 聊出你的学习路线</p>
                <p style={{ fontSize: 12, color: '#c0c4cc' }}>告诉它你想学什么，它按图谱知识排一条「先学什么、后学什么」的路线</p>
              </div>
            } />
          )}
          {messages.map((m, i) => (
            <div key={i} style={{
              display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 12,
            }}>
              {m.role === 'user' ? (
                <div style={{ background: '#1677ff', color: '#fff', padding: '8px 14px', borderRadius: '12px 12px 2px 12px', maxWidth: '70%' }}>
                  {m.content}
                </div>
              ) : m.loading ? (
                <Spin />
              ) : m.error ? (
                <Card size="small" style={{ borderColor: '#ff4d4f' }}><span style={{ color: '#ff4d4f' }}>⚠ {m.error}</span></Card>
              ) : m.tree ? (
                <div style={{ width: '90%' }}>{renderTree(m.tree)}</div>
              ) : null}
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>
        <div style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid #f0f0f0' }}>
          <Input.TextArea
            value={input}
            onChange={e => setInput(e.target.value)}
            onPressEnter={e => { if (!e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="输入学习目标…（Enter 发送，Shift+Enter 换行）"
            autoSize={{ minRows: 1, maxRows: 4 }}
            disabled={generating}
          />
          <Button type="primary" icon={<SendOutlined />} loading={generating} onClick={send}>发送</Button>
        </div>
      </Card>

      <Modal open={saveOpen} onCancel={() => setSaveOpen(false)} onOk={savePath} title="保存这条路线">
        <Input value={saveTitle} onChange={e => setSaveTitle(e.target.value)} placeholder="路线名称" maxLength={60} />
      </Modal>
    </div>
  );
}
