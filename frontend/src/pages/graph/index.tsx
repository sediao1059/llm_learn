import { useEffect, useRef, useState, useCallback } from 'react';
import { Card, Tag, Button, Drawer, Empty, Spin, FloatButton, Modal, Input, message } from 'antd';
import * as echarts from 'echarts';
import { api } from '../../api/client';
import { useAuth } from '../../store/auth';
import AnnotationModal from './AnnotationModal';
import MarkdownContent from '../../components/MarkdownContent';

interface KnowledgeData {
  nodes: any[]; edges: any[]; categories: string[]; layers: string[];
  allTags: { tag: string; count: number }[]; routes: any[]; generatedAt: string;
}

export default function GraphPage() {
  const chartRef = useRef<HTMLDivElement>(null);
  const drawerBodyRef = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const [data, setData] = useState<KnowledgeData | null>(null);
  const [aiData, setAiData] = useState<any>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [noteModalOpen, setNoteModalOpen] = useState(false);

  // 划词注释
  const [annoOpen, setAnnoOpen] = useState(false);
  const [anchorText, setAnchorText] = useState('');
  const [selectionPos, setSelectionPos] = useState<{x: number; y: number} | null>(null);
  const [annotations, setAnnotations] = useState<any[]>([]);
  const [annotationsKey, setAnnotationsKey] = useState(0);

  useEffect(() => {
    api.get('/knowledge/bundle.json').then(r => setData(r.data)).catch(() => {});
    if (user) api.get('/ai/knowledge').then(r => setAiData(r.data)).catch(() => {});
  }, [user]);

  useEffect(() => {
    if (selected && user) {
      api.get(`/ai/annotations?nodeId=${selected}`).then(r => {
        setAnnotations(r.data?.annotations || []);
      }).catch(() => {});
    } else setAnnotations([]);
  }, [selected, user, annotationsKey]);

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
    if (aiData?.nodes) {
      const knownIds = new Set(data.nodes.map(n => n.id));
      allNodes.push(...aiData.nodes);
      allEdges.push(...(aiData.edges || []).filter((e: any) =>
        knownIds.has(e.source) || aiData.nodes.some((n: any) => n.id === e.source)));
    }
    const degrees: Record<string, number> = {};
    for (const e of allEdges) {
      degrees[e.source] = (degrees[e.source] || 0) + 1;
      degrees[e.target] = (degrees[e.target] || 0) + 1;
    }
    chart.current.setOption({
      tooltip: {
        formatter: (p: any) => {
          if (p.dataType !== 'node') return '';
          const n = p.data.value;
          return `<b>${n.title}</b><br/>分类：${n.category}<br/>层次：${n.layer || '未分层'}<br/>${n.summary || ''}`;
        },
      },
      legend: { data: data.categories, bottom: 10 },
      series: [{
        type: 'graph', layout: 'force', roam: true, draggable: true,
        categories: data.categories.map(name => ({ name })),
        force: { repulsion: 480, edgeLength: 140, gravity: 0.08 },
        label: { show: true, fontSize: 12, color: '#1a1a1a' },
        emphasis: { focus: 'adjacency' },
        data: allNodes.map(n => ({
          id: n.id, name: (n.ai ? '✨ ' : '') + n.title,
          symbolSize: 30 + Math.min((degrees[n.id] || 0) * 7, 30),
          value: n, category: data.categories.indexOf(n.category),
          itemStyle: { opacity: n.status === 'todo' ? 0.45 : 1 },
        })),
        links: allEdges.map(e => ({
          source: e.source, target: e.target,
          lineStyle: { color: '#b3bac6', width: 1.5, opacity: 0.6, curveness: 0.12 },
        })),
      }],
    }, true);
    chart.current.on('click', (p: any) => {
      if (p.dataType === 'node') {
        setSelected(p.data.value.id);
        setNoteOpen(true);
      }
    });
  }, [data, aiData]);

  const node = data?.nodes.find(n => n.id === selected) || aiData?.nodes?.find((n: any) => n.id === selected);

  // 划词检测
  const handleMouseUp = useCallback(() => {
    if (!user || !noteOpen) { setSelectionPos(null); return; }
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) { setSelectionPos(null); return; }
    const text = sel.toString().trim();
    if (!text || text.length < 2 || text.length > 1000) { setSelectionPos(null); return; }
    const range = sel.getRangeAt(0);
    const container = drawerBodyRef.current;
    if (!container || !container.contains(range.commonAncestorContainer)) { setSelectionPos(null); return; }
    const rect = range.getBoundingClientRect();
    setAnchorText(text);
    setSelectionPos({ x: rect.left + rect.width / 2, y: rect.top - 8 });
  }, [user, noteOpen]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.anno-float-btn')) setSelectionPos(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const openAnnotation = () => {
    setAnnoOpen(true);
    setSelectionPos(null);
    window.getSelection()?.removeAllRanges();
  };

  const refreshAnnotations = () => setAnnotationsKey(k => k + 1);

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 56px)' }}>
      <div ref={chartRef} style={{ flex: 1, minWidth: 0, background: '#fff' }} />

      <Drawer
        open={noteOpen && !!selected}
        onClose={() => { setNoteOpen(false); setSelected(null); }}
        width={500} title={node?.title || ''}
        destroyOnClose
      >
        {node ? (
          <div ref={drawerBodyRef} onMouseUp={handleMouseUp} style={{ userSelect: 'text' }}>
            <div style={{ marginBottom: 8 }}>
              <Tag color="blue">{node.layer || '未分层'}</Tag>
              <Tag color="geekblue">{node.category}</Tag>
              {node.difficulty && <Tag color="orange">{node.difficulty}</Tag>}
              {node.status === 'todo' && <Tag>待学习</Tag>}
              {node.ai && <Tag color="purple">✨ AI 沉淀</Tag>}
            </div>
            {node.summary && (
              <Card size="small" style={{ marginBottom: 12, background: '#f6f6f6' }}>{node.summary}</Card>
            )}
            {node.tags?.length > 0 && (
              <div style={{ marginBottom: 12 }}>{node.tags.map((t: string) => <Tag key={t}>#{t}</Tag>)}</div>
            )}
            <MarkdownContent content={node.content || ''} />

            {annotations.length > 0 && (
              <Card title={`💬 本篇注释（${annotations.length}）`} size="small" style={{ marginTop: 16 }}>
                {annotations.map((a: any) => (
                  <div key={a.id} style={{ marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid #f0f0f0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <Tag style={{ fontSize: 10 }}>{a.type === 'word' ? '词' : a.type === 'sentence' ? '句' : a.type === 'document' ? '整篇' : a.type}</Tag>
                      <Tag color={a.status === 'approved' ? 'success' : a.status === 'pending' ? 'warning' : 'error'} style={{ fontSize: 10 }}>
                        {a.status === 'approved' ? '已审核' : a.status === 'pending' ? '待审核' : '驳回'}
                      </Tag>
                      <span style={{ fontSize: 11, color: '#bfbfbf', marginLeft: 'auto' }}>{a.createdBy}</span>
                    </div>
                    {a.anchorText && <div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 4 }}>「{a.anchorText.slice(0, 50)}…」</div>}
                    <MarkdownContent content={a.answer || ''} fontSize={12.5} />
                  </div>
                ))}
              </Card>
            )}
          </div>
        ) : <Empty description="点击左侧节点查看笔记" />}
      </Drawer>

      {selectionPos && (
        <button
          className="anno-float-btn"
          onClick={openAnnotation}
          style={{
            position: 'fixed', left: selectionPos.x - 30, top: selectionPos.y - 36,
            zIndex: 1000, padding: '4px 12px', borderRadius: 6,
            background: '#1677ff', color: '#fff', border: 'none',
            cursor: 'pointer', fontSize: 12, fontWeight: 500,
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          }}
        >
          💡 解答
        </button>
      )}

      {user && selected && (
        <AnnotationModal
          open={annoOpen}
          onClose={() => setAnnoOpen(false)}
          nodeId={selected}
          nodeTitle={node?.title || ''}
          anchorText={anchorText}
          onSaved={refreshAnnotations}
          userRole={user.role}
        />
      )}

      {user && selected && noteOpen && (
        <FloatButton.Group shape="circle" style={{ right: 24, bottom: 24 }}>
          <FloatButton icon={<span>📝</span>} tooltip="写个人笔记" onClick={() => {
            api.get(`/notes?nodeId=${selected}`).then(r => setNoteText(r.data.note || ''));
            setNoteModalOpen(true);
          }} />
        </FloatButton.Group>
      )}

      <Modal
        open={noteModalOpen} onCancel={() => setNoteModalOpen(false)}
        title={`📝 我的笔记 · ${node?.title || ''}`}
        onOk={async () => {
          await api.put('/notes', { nodeId: selected, content: noteText });
          message.success('笔记已保存');
          setNoteModalOpen(false);
        }}
      >
        <Input.TextArea rows={8} value={noteText} onChange={e => setNoteText(e.target.value)} />
      </Modal>

      {loading && <div style={{ position: 'absolute', top: '50%', left: '50%' }}><Spin size="large" /></div>}
    </div>
  );
}
