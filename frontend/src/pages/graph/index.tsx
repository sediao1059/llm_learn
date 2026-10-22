import { useEffect, useRef, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
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
  const [searchParams] = useSearchParams();

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

  // 足迹/收藏/我的注解等入口跳转：/?node=<id> 直接打开那篇笔记
  const nodeParam = searchParams.get('node');
  useEffect(() => {
    if (nodeParam) setSelected(nodeParam);
  }, [nodeParam]);

  // AI 助手沉淀写入图谱后，动态层立即刷新（无需手动刷新页面）
  useEffect(() => {
    if (!user) return;
    const reload = () => api.get('/ai/knowledge').then(r => setAiData(r.data)).catch(() => {});
    window.addEventListener('kg:ai-knowledge-updated', reload);
    return () => window.removeEventListener('kg:ai-knowledge-updated', reload);
  }, [user]);

  // 加载注解
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

    // 空白处拖拽平移（全画布生效）：按下未命中任何元素（e.target 为空）时开始平移，
    // 逐帧把位移加到 graph series 的画布组上（与 echarts 原生 updateViewOnPan 同路径），
    // 并派发 graphRoam action 同步 center/zoom，保证后续 setOption 重渲染不丢平移量。
    // _chartsViews 是 echarts 实例上的半私有字段，取不到时退化为只派发 action。
    const zr = chart.current.getZr();
    let panning = false;
    let lastX = 0;
    let lastY = 0;
    zr.on('mousedown', (e: any) => {
      if (e.target) return; // 命中节点/图例等元素时交还给 echarts（节点拖拽/图例点击）
      panning = true;
      lastX = e.offsetX;
      lastY = e.offsetY;
    });
    zr.on('mousemove', (e: any) => {
      if (!panning || !chart.current) return;
      const dx = e.offsetX - lastX;
      const dy = e.offsetY - lastY;
      lastX = e.offsetX;
      lastY = e.offsetY;
      if (!dx && !dy) return;
      const group = (chart.current as any)._chartsViews
        ?.find((v: any) => v.type === 'graph')?.group;
      if (group) {
        group.x += dx;
        group.y += dy;
        group.dirty();
      }
      chart.current.dispatchAction({ type: 'graphRoam', seriesIndex: 0, dx, dy });
    });
    const stopPan = () => { panning = false; };
    zr.on('mouseup', stopPan);
    zr.on('globalout', stopPan);
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
        // roam 只保留滚轮缩放；拖拽平移由下方自实现（echarts 原生平移仅对节点团包围盒内生效，
        // 刚打开时节点聚在屏幕中央，画布边缘空白处按住拖不动）
        type: 'graph', layout: 'force', roam: 'scale', draggable: true,
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
        onOpenLinked={(refId) => setSelected(refId)}
        isLoggedIn={!!user}
        userRole={user?.role}
        annotations={annotations}
        onAnnotationSaved={() => setAnnKey(k => k + 1)}
      />

      {loading && <div style={{ position: 'absolute', top: '50%', left: '50%' }}><Spin size="large" /></div>}
    </div>
  );
}
