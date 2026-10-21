import { useEffect, useRef, useState, useCallback } from 'react';
import { Spin } from 'antd';
import * as echarts from 'echarts';
import { api } from '../../api/client';
import { useAuth } from '../../store/auth';
import KnowledgeDrawer from '../../components/KnowledgeDrawer';

interface KnowledgeData {
  nodes: any[]; edges: any[]; categories: string[]; layers: string[];
  allTags: { tag: string; count: number }[]; routes: any[]; generatedAt: string;
}

export default function GraphPage() {
  const chartRef = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const [data, setData] = useState<KnowledgeData | null>(null);
  const [aiData, setAiData] = useState<any>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [annotations, setAnnotations] = useState<any[]>([]);
  const [annKey, setAnnKey] = useState(0);

  useEffect(() => {
    api.get('/knowledge/bundle.json').then(r => setData(r.data)).catch(() => {});
    if (user) {
      api.get('/ai/knowledge').then(r => setAiData(r.data)).catch(() => {});
      api.get('/progress').then(r => {
        const prog: Record<string, number> = {};
        if (r.data?.progress) {
          for (const [id, v] of Object.entries(r.data.progress)) prog[id] = (v as any).level || 0;
        }
        setProgress(prog);
      }).catch(() => {});
    }
  }, [user]);

  // 加载注释
  useEffect(() => {
    if (selected && user) {
      api.get(`/ai/annotations?nodeId=${selected}`).then(r => {
        setAnnotations(r.data?.annotations || []);
      }).catch(() => setAnnotations([]));
    } else setAnnotations([]);
  }, [selected, user, annKey]);

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
        trigger: 'item',
        className: 'kg-tip',
        backgroundColor: '#fff', borderColor: '#e5e6eb', padding: [8, 12],
        textStyle: { color: '#333', fontSize: 13 },
        extraCssText: 'max-width: 45vw; white-space: normal; word-break: break-word; box-shadow: 0 4px 14px rgba(0,0,0,0.12); border-radius: 8px;',
        position: function (point: number[], _params: any, _dom: HTMLElement, _rect: any, size: any) {
          const tipW = size.contentSize[0]; const tipH = size.contentSize[1];
          const chartW = chart.current ? chart.current.getWidth() : 800;
          const chartH = chart.current ? chart.current.getHeight() : 600;
          let x = point[0] - tipW - 14; let y = point[1] - tipH - 10;
          if (x < 4) x = point[0] + 14; if (y < 4) y = point[1] + 14;
          if (x + tipW > chartW - 4) x = chartW - tipW - 4;
          if (y + tipH > chartH - 4) y = chartH - tipH - 4;
          return [Math.max(4, x), Math.max(4, y)];
        },
        formatter: (p: any) => {
          if (p.dataType !== 'node') return '';
          const n = p.data.value;
          const summary = n.summary ? String(n.summary).slice(0, 100) : '';
          return `<b>${n.title}</b><br/>` +
            `<span style="color:#8c8c8c;font-size:12px">分类：${n.category} · 层次：${n.layer || '未分层'}</span>` +
            (summary ? `<br/><span style="color:#8c8c8c;font-size:12px">${summary}</span>` : '') +
            '<br/><span style="color:#1677ff;font-size:11px">点击查看笔记</span>';
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
      if (p.dataType === 'node') setSelected(p.data.value.id);
    });
  }, [data, aiData]);

  const node = data?.nodes.find(n => n.id === selected) || aiData?.nodes?.find((n: any) => n.id === selected);

  const setLevel = async (refId: string, level: number) => {
    setProgress(prev => ({ ...prev, [refId]: level }));
    await api.put('/progress', { nodeId: refId, level });
  };

  // 关联节点
  const linkedNodes = node?.links
    ?.map((id: string) => {
      const linked = data?.nodes.find(n => n.id === id) || aiData?.nodes?.find((n: any) => n.id === id);
      return linked ? { id, title: linked.title } : null;
    })
    ?.filter(Boolean) || [];

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 56px)' }}>
      <div ref={chartRef} style={{ flex: 1, minWidth: 0, background: '#fff' }} />

      <KnowledgeDrawer
        open={!!selected}
        onClose={() => setSelected(null)}
        nodeId={selected || ''}
        nodeData={node}
        level={selected ? (progress[selected] || 0) : 0}
        onLevelChange={user ? setLevel : undefined}
        linkedNodes={linkedNodes}
        isLoggedIn={!!user}
        userRole={user?.role}
        annotations={annotations}
        onAnnotationSaved={() => setAnnKey(k => k + 1)}
      />

      {loading && <div style={{ position: 'absolute', top: '50%', left: '50%' }}><Spin size="large" /></div>}
    </div>
  );
}
