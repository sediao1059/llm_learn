import { useState } from 'react';
import { Card, Progress, Collapse, Tag, Button, Space, Popconfirm, message, Modal, Input } from 'antd';
import { CheckOutlined, ClearOutlined, RobotOutlined, EditOutlined } from '@ant-design/icons';
import TopicRow from './TopicRow';

interface PathTree {
  title: string;
  summary?: string;
  stages: {
    title: string;
    goal?: string;
    items: { title: string; refId?: string; why?: string; children?: any[] }[];
  }[];
}

interface Props {
  path: { id: number; title: string; isOfficial: boolean; tree: PathTree };
  progress: Record<string, number>;
  refTitles: Record<string, string>;
  onLevelChange: (refId: string, level: number) => void;
  onBatchLevel: (refIds: string[], level: number) => void;
  onAIAdjust: () => void;
  onTitleChange: (id: number, title: string) => void;
  onArticleOpen: (refId: string) => void;
}

export default function TreeView({ path, progress, refTitles, onLevelChange, onBatchLevel, onAIAdjust, onTitleChange, onArticleOpen }: Props) {
  const tree = path.tree;
  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState('');

  if (!tree?.stages?.length) return null;

  const collectIds = (items: any[]): string[] =>
    items.flatMap(it => [it.refId, ...collectIds(it.children || [])]).filter(Boolean) as string[];
  const allRefIds = tree.stages.flatMap(st => collectIds(st.items));
  const done = allRefIds.filter(id => (progress[id] || 0) >= 1).length;
  const pct = allRefIds.length ? Math.round((done / allRefIds.length) * 100) : 0;

  const stageProgress = (items: any[]) => {
    const ids = collectIds(items);
    const d = ids.filter(id => (progress[id] || 0) >= 1).length;
    return { done: d, total: ids.length };
  };

  const saveTitle = async () => {
    const title = editTitle.trim();
    if (!title) return message.warning('标题不能为空');
    const r = await fetch(`/api/ai/paths/${path.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('llm_learn_token')}`,
      },
      body: JSON.stringify({ title }),
    });
    if (r.ok) {
      message.success('标题已更新');
      onTitleChange(path.id, title);
      setEditOpen(false);
    } else {
      const d = await r.json();
      message.error(d.message || '更新失败');
    }
  };

  return (
    <div>
      <Card size="small" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 17 }}>{tree.title}</h3>
          {path.isOfficial && <Tag color="warning">⭐ 官方</Tag>}
          <Button type="text" size="small" icon={<EditOutlined />}
            onClick={() => { setEditTitle(tree.title); setEditOpen(true); }} title="修改路线名称" />
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, color: pct === 100 ? '#52c41a' : '#8c8c8c' }}>
              {done}/{allRefIds.length} 已学
            </span>
            <Progress type="circle" percent={pct} size={44}
              strokeColor={pct === 100 ? '#52c41a' : '#1677ff'}
              format={(p) => <span style={{ fontSize: 11 }}>{p}%</span>} />
          </div>
        </div>
        {tree.summary && <p style={{ color: '#8c8c8c', fontSize: 13, margin: 0 }}>{tree.summary}</p>}
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <Button size="small" icon={<CheckOutlined />}
            onClick={() => { onBatchLevel(allRefIds, 1); message.success('已全部标记为「了解」'); }}>
            全部标记已学
          </Button>
          <Popconfirm title="确定重置这条路线的所有进度？" onConfirm={() => {
            onBatchLevel(allRefIds, 0); message.success('进度已重置');
          }}>
            <Button size="small" icon={<ClearOutlined />}>重置进度</Button>
          </Popconfirm>
          <Button size="small" icon={<RobotOutlined />} onClick={onAIAdjust}>AI 调整这条路线</Button>
        </div>
      </Card>

      <Collapse
        defaultActiveKey={[0]}
        items={tree.stages.map((st, si) => {
          const sp = stageProgress(st.items);
          return {
            key: si,
            label: (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <b>阶段 {si + 1} · {st.title}</b>
                <span style={{ color: sp.done === sp.total && sp.total > 0 ? '#52c41a' : '#8c8c8c', fontSize: 12 }}>
                  {sp.done}/{sp.total}
                </span>
                {sp.total > 0 && sp.done === sp.total && <Tag color="success" style={{ fontSize: 10 }}>✓ 完成</Tag>}
              </div>
            ),
            children: (
              <>
                {st.goal && <p style={{ color: '#8c8c8c', fontSize: 12, marginBottom: 8 }}>🎯 {st.goal}</p>}
                {st.items.map((item, ii) => (
                  <TopicRow
                    key={ii}
                    topic={item}
                    level={item.refId ? (progress[item.refId] || 0) : 0}
                    refTitle={item.refId ? refTitles[item.refId] : undefined}
                    onLevelChange={onLevelChange}
                    onArticleOpen={onArticleOpen}
                  />
                ))}
              </>
            ),
          };
        })}
      />

      <Modal open={editOpen} onCancel={() => setEditOpen(false)}
        title="修改路线名称" width={380} onOk={saveTitle}>
        <Input value={editTitle} onChange={e => setEditTitle(e.target.value)}
          maxLength={60} placeholder="路线名称" autoFocus onPressEnter={saveTitle} />
      </Modal>
    </div>
  );
}
