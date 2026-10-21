import { useEffect, useRef, useState, useCallback } from 'react';
import { Card, Tabs, Tag, Button, Drawer, Empty, Spin, Tooltip, FloatButton, Modal, Radio, Input, message } from 'antd';
import * as echarts from 'echarts';
import { api } from '../../api/client';
import { useAuth } from '../../store/auth';

interface KnowledgeData {
  nodes: any[]; edges: any[]; categories: string[]; layers: string[];
  allTags: { tag: string; count: number }[]; routes: any[]; generatedAt: string;
}

export default function GraphPage() {
  const chartRef = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const [data, setData] = useState<KnowledgeData | null>(null);
  const [aiData, setAiData] = useState<any>(null);
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('view_mode') || 'force');
  const [selected, setSelected] = useState<string | null>(null);
  const [tierData, setTierData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState('');

  useEffect(() => {
    api.get('/knowledge/bundle.json').then(r => setData(r.data)).catch(() => {});
    api.get('/graph/tiers').then(r => setTierData(r.data)).catch(() => {});
    if (user) {
      api.get('/ai/knowledge').then(r => setAiData(r.data)).catch(() => {});
    }
  }, [user]);

  useEffect(() => {
    if (!chartRef.current) return;
    chart.current = echarts.init(chartRef.current);
    const onResize = () => chart.current?.resize();
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); chart.current?.dispose(); };
  }, []);

  useEffect(() => {
    if (!data || !chart.current) return;
    setLoading(false);
    const allNodes = [...data.nodes];
    const allEdges = [...data.edges];
    // merge AI nodes
    if (aiData?.nodes) {
      const knownIds = new Set(data.nodes.map(n => n.id));
      const aiEdges = aiData.edges.filter((e: any) =>
        (knownIds.has(e.source) || aiData.nodes.some((n: any) => n.id === e.source)) &&
        (knownIds.has(e.target) || aiData.nodes.some((n: any) => n.id === e.target))
      );
      allNodes.push(...aiData.nodes);
      allEdges.push(...aiEdges);
    }

    const degrees: Record<string, number> = {};
    for (const e of allEdges) {
      degrees[e.source] = (degrees[e.source] || 0) + 1;
      degrees[e.target] = (degrees[e.target] || 0) + 1;
    }

    const chartNodes = allNodes.map(n => ({
      id: n.id,
      name: (n.ai ? '✨ ' : '') + n.title,
      symbolSize: 30 + Math.min((degrees[n.id] || 0) * 7, 30),
      value: n,
      category: data.categories.indexOf(n.category),
      itemStyle: { opacity: n.status === 'todo' ? 0.45 : 1 },
    }));

    const chartEdges = allEdges.map(e => ({
      source: e.source, target: e.target,
      lineStyle: { color: '#b3bac6', width: 1.5, opacity: 0.6, curveness: 0.12 },
    }));

    chart.current.setOption({
      tooltip: {
        formatter: (p: any) => {
          if (p.dataType !== 'node') return '';
          const n = p.data.value;
          return `<b>${n.title}</b><br/>分类：${n.category}<br/>层次：${n.layer || '未分层'}<br/>难度：${n.difficulty || '未标注'}<br/>${n.summary || ''}`;
        },
      },
      legend: { data: data.categories, bottom: 10 },
      series: [{
        type: 'graph',
        layout: 'force',
        roam: true,
        draggable: true,
        categories: data.categories.map(name => ({ name })),
        force: { repulsion: 480, edgeLength: 140, gravity: 0.08 },
        label: { show: true, fontSize: 12, color: '#1a1a1a' },
        emphasis: { focus: 'adjacency' },
        data: chartNodes,
        links: chartEdges,
      }],
    }, true);

    chart.current.on('click', (p: any) => {
      if (p.dataType === 'node') setSelected(p.data.value.id);
    });
  }, [data, aiData]);

  const node = data?.nodes.find(n => n.id === selected) || aiData?.nodes?.find((n: any) => n.id === selected);

  const renderTags = (tags: string[]) => tags.map(t => <Tag key={t}>#{t}</Tag>);

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 56px)' }}>
      <div ref={chartRef} style={{ flex: 1, minWidth: 0, background: '#fff' }} />
      <Drawer
        open={!!selected}
        onClose={() => setSelected(null)}
        width={480}
        title={node?.title || ''}
        destroyOnClose
      >
        {node ? (
          <div>
            <div style={{ marginBottom: 8 }}>
              <Tag color="blue">{node.layer || '未分层'}</Tag>
              <Tag color="geekblue">{node.category}</Tag>
              {node.difficulty && <Tag color="orange">{node.difficulty}</Tag>}
              {node.status === 'todo' && <Tag color="default">待学习</Tag>}
              {node.ai && <Tag color="purple">✨ AI 沉淀</Tag>}
            </div>
            {node.summary && (
              <Card size="small" style={{ marginBottom: 12, background: '#f6f6f6' }}>
                {node.summary}
              </Card>
            )}
            {node.tags && <div style={{ marginBottom: 12 }}>{renderTags(node.tags)}</div>}
            <div
              className="markdown-body"
              dangerouslySetInnerHTML={{ __html: node.content || '（暂无内容）' }}
              style={{ lineHeight: 1.8, fontSize: 14 }}
            />
          </div>
        ) : <Empty description="点击左侧节点查看笔记" />}
      </Drawer>

      {user && selected && (
        <FloatButton.Group shape="circle" style={{ right: 24, bottom: 24 }}>
          <FloatButton
            icon={<span>📊</span>}
            tooltip="标注学习程度"
            onClick={() => {/* TODO: level modal */}}
          />
          <FloatButton
            icon={<span>📝</span>}
            tooltip="写个人笔记"
            onClick={() => {
              api.get(`/notes?nodeId=${selected}`).then(r => setNoteText(r.data.note || ''));
              setNoteOpen(true);
            }}
          />
        </FloatButton.Group>
      )}

      <Modal
        open={noteOpen}
        onCancel={() => setNoteOpen(false)}
        title={`📝 我的笔记 · ${node?.title || ''}`}
        onOk={async () => {
          await api.put('/notes', { nodeId: selected, content: noteText });
          message.success('笔记已保存');
          setNoteOpen(false);
        }}
      >
        <Input.TextArea rows={8} value={noteText} onChange={e => setNoteText(e.target.value)}
          placeholder="写点只有自己看的理解/待办/联想…" />
      </Modal>

      {loading && <div style={{ position: 'absolute', top: '50%', left: '50%' }}><Spin size="large" /></div>}
    </div>
  );
}
