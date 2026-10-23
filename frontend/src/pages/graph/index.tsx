import { useEffect, useRef, useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Spin, Input, Select, Button, Badge, Tooltip, Popover, Segmented } from 'antd';
import { FilterOutlined, SearchOutlined } from '@ant-design/icons';
import * as echarts from 'echarts';
import { api } from '../../api/client';
import { useKnowledgeBase } from '../../hooks/useKnowledgeBase';
import { useResponsive } from '../../hooks/useResponsive';
import NodeReadDrawer from '../../components/NodeReadDrawer';

// 难度筛选项（AI 沉淀节点无难度字段，统一归「未标注」）
const DIFFICULTY_OPTIONS = [
  { value: '入门', label: '入门（新手也能懂）' },
  { value: '进阶', label: '进阶（需要一些基础）' },
  { value: '深入', label: '深入（老手进阶用）' },
  { value: '未标注', label: '未标注（含 ✨ AI 沉淀）' },
];

// 力导向基础参数 / 点选聚焦参数（SPEC §4.5）：聚焦时更短的边长把相关节点拉拢、
// 更弱的斥力给它们匀出空间，无关节点同步缩小淡化，视觉上「被排斥退让」
const BASE_FORCE = { repulsion: 480, edgeLength: 140, gravity: 0.08 };
const FOCUS_FORCE = { repulsion: 240, edgeLength: 80, gravity: 0.05 };
const baseNodeSize = (deg: number) => 30 + Math.min(deg * 7, 30);

export default function GraphPage() {
  const chartRef = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const { isMobile } = useResponsive(); // 手机端：筛选面板纵向堆叠、起点面板贴边
  const { data, aiData, user } = useKnowledgeBase();
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchParams] = useSearchParams();

  // ===== 筛选（面板默认折叠；文本搜索 × 标签多选 × 难度多选，AND 叠加，SPEC §4.5）=====
  // 三个条件全部持久化：刷新后保持，点「清空筛选」才全部重置
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchInput, setSearchInput] = useState(() => localStorage.getItem('kg.filter.search') || '');
  const [searchText, setSearchText] = useState(() => localStorage.getItem('kg.filter.search') || ''); // 防抖后再过滤，避免每敲一个字力导向重排
  const [selTags, setSelTags] = useState<string[]>(() => {
    try {
      const v = JSON.parse(localStorage.getItem('kg.filter.tags') || '[]');
      return Array.isArray(v) ? v : [];
    } catch { return []; }
  });
  const [selDiffs, setSelDiffs] = useState<string[]>(() => {
    try {
      const v = JSON.parse(localStorage.getItem('kg.filter.diffs') || '[]');
      return Array.isArray(v) ? v : [];
    } catch { return []; }
  });

  useEffect(() => {
    const t = setTimeout(() => setSearchText(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => { localStorage.setItem('kg.filter.search', searchText); }, [searchText]);
  useEffect(() => { localStorage.setItem('kg.filter.tags', JSON.stringify(selTags)); }, [selTags]);
  useEffect(() => { localStorage.setItem('kg.filter.diffs', JSON.stringify(selDiffs)); }, [selDiffs]);

  // ===== 起点聚焦（SPEC §4.5）：根节点 + 层数，默认只看「从起点出发 N 层」=====
  // 新用户/未自选 → 默认根 = 全图度数最高的枢纽节点；自选起点跟账号持久化（游客存本机）
  const [focusCfgLoaded, setFocusCfgLoaded] = useState(false);
  const [rootNodeId, setRootNodeId] = useState<string | null>(null); // null = 未自选（用默认枢纽）
  const [focusDepth, setFocusDepth] = useState(3);
  const [showAll, setShowAll] = useState(false); // 临时看全部（不持久化）

  useEffect(() => {
    if (user) {
      api.get('/graph/focus').then(r => {
        if (r.data?.focus) {
          setRootNodeId(r.data.focus.rootNodeId || null);
          setFocusDepth(r.data.focus.depth || 3);
        }
      }).catch(() => {}).finally(() => setFocusCfgLoaded(true));
    } else {
      try {
        const v = JSON.parse(localStorage.getItem('kg.focus') || 'null');
        if (v && typeof v === 'object') {
          setRootNodeId(v.rootNodeId || null);
          setFocusDepth(v.depth || 3);
        }
      } catch { /* 容错 */ }
      setFocusCfgLoaded(true);
    }
  }, [user]);

  /** 改起点/层数：本地立即生效并持久化（登录存服务端跟账号走，游客存本机） */
  const saveFocus = (root: string | null, depth: number) => {
    setRootNodeId(root);
    setFocusDepth(depth);
    if (user) api.put('/graph/focus', { rootNodeId: root, depth }).catch(() => {});
    else localStorage.setItem('kg.focus', JSON.stringify({ rootNodeId: root, depth }));
  };

  // 底部分类图例（彩色按钮）的显隐状态：点击切换时记录，刷新后保持
  const [legendSelected, setLegendSelected] = useState<Record<string, boolean>>(() => {
    try {
      const v = JSON.parse(localStorage.getItem('kg.legend.selected') || '{}');
      return v && typeof v === 'object' ? v : {};
    } catch { return {}; }
  });

  // 静态笔记 + AI 沉淀动态层合并（筛选在合并后的全集上进行，AI 节点一并参与）
  const merged = useMemo(() => {
    if (!data) return { nodes: [] as any[], edges: [] as any[], categories: [] as string[] };
    const nodes = [...data.nodes];
    const edges = [...data.edges];
    let categories = data.categories;
    if (aiData?.nodes) {
      const knownIds = new Set(data.nodes.map((n: any) => n.id));
      nodes.push(...aiData.nodes);
      edges.push(...(aiData.edges || []).filter((e: any) =>
        knownIds.has(e.source) || aiData.nodes.some((n: any) => n.id === e.source)));
      // AI 节点分类（「📚 专栏」聚合节点、「📤 上传」成员节点等）在静态基础上合并（SPEC §4.4），图例与着色统一
      categories = [...new Set([
        ...data.categories,
        ...aiData.nodes.map((n: any) => n.category).filter(Boolean),
      ])];
    }
    return { nodes, edges, categories };
  }, [data, aiData]);

  // 节点大小按全量度数算，不随筛选变化跳尺寸
  const degrees = useMemo(() => {
    const deg: Record<string, number> = {};
    for (const e of merged.edges) {
      deg[e.source] = (deg[e.source] || 0) + 1;
      deg[e.target] = (deg[e.target] || 0) + 1;
    }
    return deg;
  }, [merged]);

  // 默认起点：全图度数最高（连线最多）的枢纽节点，随知识增长自动换
  const defaultRootId = useMemo(() => {
    if (!merged.nodes.length) return null;
    const deg: Record<string, number> = {};
    for (const e of merged.edges) {
      deg[e.source] = (deg[e.source] || 0) + 1;
      deg[e.target] = (deg[e.target] || 0) + 1;
    }
    return merged.nodes.reduce((a, b) => ((deg[b.id] || 0) > (deg[a.id] || 0) ? b : a), merged.nodes[0]).id;
  }, [merged]);

  // 实际生效的起点：自选的（且仍存在）优先，否则默认枢纽
  const focusRootId = rootNodeId && merged.nodes.some((n: any) => n.id === rootNodeId)
    ? rootNodeId : defaultRootId;

  // 从起点 BFS 层数内的节点集合（null = 不过滤，显示全部）
  const focusIds = useMemo(() => {
    if (showAll || !focusCfgLoaded || !focusRootId) return null;
    const adj: Record<string, string[]> = {};
    for (const e of merged.edges) {
      (adj[e.source] = adj[e.source] || []).push(e.target);
      (adj[e.target] = adj[e.target] || []).push(e.source);
    }
    const ids = new Set<string>([focusRootId]);
    let frontier = [focusRootId];
    for (let d = 0; d < focusDepth; d++) {
      const next: string[] = [];
      for (const u of frontier) {
        for (const v of adj[u] || []) {
          if (!ids.has(v)) { ids.add(v); next.push(v); }
        }
      }
      frontier = next;
    }
    return ids;
  }, [merged, focusRootId, focusDepth, showAll, focusCfgLoaded]);

  const activeFilterCount =
    (searchText.trim() ? 1 : 0) + (selTags.length ? 1 : 0) + (selDiffs.length ? 1 : 0);

  const filtered = useMemo(() => {
    const kw = searchText.trim().toLowerCase();
    const match = (n: any) => {
      if (kw && !(
        String(n.title || '').toLowerCase().includes(kw) ||
        String(n.summary || '').toLowerCase().includes(kw) ||
        (n.tags || []).some((t: string) => t.toLowerCase().includes(kw))
      )) return false;
      if (selTags.length && !(n.tags || []).some((t: string) => selTags.includes(t))) return false;
      // AI 沉淀节点没有难度字段，统一按「未标注」参与筛选
      if (selDiffs.length && !selDiffs.includes(n.difficulty || '未标注')) return false;
      return true;
    };
    // 有筛选条件（关键词/标签/难度）时全图命中，不受起点聚焦层数截断——
    // 与已有知识点零关联的新专栏（孤岛）在聚焦视图里 BFS 走不到，截断的话永远搜不出来
    const gate = activeFilterCount > 0 ? null : focusIds;
    const nodes = merged.nodes.filter(n => (!gate || gate.has(n.id)) && match(n));
    const ids = new Set(nodes.map((n: any) => n.id));
    const edges = merged.edges.filter((e: any) => ids.has(e.source) && ids.has(e.target));
    return { nodes, edges, total: merged.nodes.length };
  }, [merged, focusIds, searchText, selTags, selDiffs, activeFilterCount]);

  const clearFilters = () => {
    setSearchInput('');
    setSearchText('');
    setSelTags([]);
    setSelDiffs([]);
  };

  // 足迹/收藏/我的注解等入口跳转：/?node=<id> 直接打开那篇笔记
  const nodeParam = searchParams.get('node');
  useEffect(() => {
    if (nodeParam) setSelected(nodeParam);
  }, [nodeParam]);

  useEffect(() => {
    if (!chartRef.current) return;
    chart.current = echarts.init(chartRef.current);
    const onResize = () => chart.current?.resize();

    // 空白处拖拽平移（全画布生效）：按下未命中任何元素（e.target 为空）时开始平移，
    // 逐帧把位移加到 graph series 的画布组上（与 echarts 原生 updateViewOnPan 同路径），
    // 并派发 graphRoam action 同步 center/zoom，保证后续 setOption 重渲染不丢平移量。
    // 触屏同样走这三个 handler：zrender 会把 touchstart/move/end 合成为 mousedown/move/up 派发，
    // 画布上的 touch-action: none 让浏览器不抢手势去滚动页面。
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
      // 双指捏合期间不平移（zrender 会把 touch 合成为 mouse 事件派发到这里），
      // 缩放交给 echarts RoamController 的原生 pinch 处理（roam: 'scale' 已启用）
      if (e.gestureEvent === 'pinch') { panning = false; return; }
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
    // 点击节点打开笔记：绑定一次即可（setOption 会随筛选频繁重跑，放那边会重复叠加 handler）
    chart.current.on('click', (p: any) => {
      if (p.dataType === 'node') setSelected(p.data.value.id);
    });
    // 底部分类图例显隐：记录用户选择并持久化（setOption 更新 selected 不会再触发本事件，无循环）
    chart.current.on('legendselectchanged', (p: any) => {
      setLegendSelected(p.selected);
      localStorage.setItem('kg.legend.selected', JSON.stringify(p.selected));
    });
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); chart.current?.dispose(); };
  }, []);

  /** 可见图谱的 series 数据（含点选聚焦样式，SPEC §4.5）：
   *  选中节点红框高亮放大；一跳邻居保持原大小清晰可见；无关节点缩小淡化让位；
   *  相关连线转红加粗、无关联线近乎隐没；聚焦时收紧 force 参数让相关节点聚拢铺开 */
  const seriesData = useMemo(() => {
    const focusId = selected && filtered.nodes.some((n: any) => n.id === selected) ? selected : null;
    const neighbors = new Set<string>();
    if (focusId) {
      for (const e of filtered.edges) {
        if (e.source === focusId) neighbors.add(e.target);
        else if (e.target === focusId) neighbors.add(e.source);
      }
    }
    // 孤岛节点（无邻居）只红框高亮自己，不全图淡化
    const focusing = !!focusId && neighbors.size > 0;
    const baseOf = (n: any) => ({
      id: n.id, name: (n.ai ? '✨ ' : '') + n.title, value: n,
      category: merged.categories.indexOf(n.category),
      symbolSize: baseNodeSize(degrees[n.id] || 0),
      itemStyle: { opacity: n.status === 'todo' ? 0.45 : 1 },
    });
    const data = filtered.nodes.map((n: any) => {
      const base = baseOf(n);
      if (!focusing) return base;
      if (n.id === focusId) {
        return { ...base, symbolSize: base.symbolSize + 6,
          itemStyle: { opacity: 1, borderColor: '#ff4d4f', borderWidth: 3 } };
      }
      if (neighbors.has(n.id)) return base;
      return {
        ...base,
        symbolSize: Math.max(10, Math.round(base.symbolSize * 0.45)),
        itemStyle: { opacity: 0.12 },
        label: { color: 'rgba(26,26,26,0.15)' },
      };
    });
    const links = filtered.edges.map((e: any) => {
      const hit = focusing && (e.source === focusId || e.target === focusId);
      return {
        source: e.source, target: e.target,
        lineStyle: hit
          ? { color: '#ff7875', width: 2.5, opacity: 0.85, curveness: 0.12 }
          : { color: '#b3bac6', width: 1.5, opacity: focusing ? 0.06 : 0.6, curveness: 0.12 },
      };
    });
    return { data, links, force: focusing ? FOCUS_FORCE : BASE_FORCE };
  }, [merged, filtered, selected, degrees]);

  // 主 setOption 重建（数据/筛选/图例变化）与点选聚焦更新共用上面这份样式：
  // 重建走 ref 取「当前最新」样式（切筛选也能保持聚焦态，且不因 selected 变化触发整图重排）
  const seriesRef = useRef(seriesData);
  seriesRef.current = seriesData;

  useEffect(() => {
    if (!data || !chart.current) return;
    setLoading(false);
    const s = seriesRef.current;
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
      legend: { data: merged.categories, bottom: 10, selected: legendSelected, type: 'scroll' },
      series: [{
        // roam 只保留滚轮缩放；拖拽平移由下方自实现（echarts 原生平移仅对节点团包围盒内生效，
        // 刚打开时节点聚在屏幕中央，画布边缘空白处按住拖不动）
        type: 'graph', layout: 'force', roam: 'scale', draggable: true,
        categories: merged.categories.map((name: string) => ({ name })),
        force: s.force,
        label: { show: true, fontSize: 12, color: '#1a1a1a' },
        emphasis: { focus: 'adjacency' },
        data: s.data,
        links: s.links,
      }],
    }, true);
  }, [data, merged, filtered, legendSelected]);

  // 点选聚焦：合并模式更新（按 id 合并、保留当前布局位置，force 模拟继续跑）——
  // 选中后无关节点缩小淡化退让、相关节点被收紧的力参数拉拢聚拢并匀出空间；
  // 关闭笔记浮窗（selected 置空）或点选其他节点时自动切换/全部还原
  useEffect(() => {
    if (!data || !chart.current) return;
    const s = seriesRef.current;
    chart.current.setOption({ series: [{ data: s.data, links: s.links, force: s.force }] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  return (
    <div className="page-fill" style={{ display: 'flex', position: 'relative' }}>
      <div id="graph-canvas" ref={chartRef}
        style={{ flex: 1, minWidth: 0, background: '#fff', touchAction: 'none' }} />

      {/* 筛选浮条：默认折叠收起，按钮上徽标显示生效的筛选条件数；容器不拦截图谱拖拽 */}
      <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 20, display: 'flex', alignItems: 'flex-start', gap: 8, maxWidth: 'calc(100% - 24px)', pointerEvents: 'none' }}>
        <Tooltip title="图谱太大看不过来？设一个起点，只看从它出发几层以内的知识">
          <Popover
            trigger="click" placement="bottomLeft"
            title="🌱 图谱起点（从哪开始看）"
            content={
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: isMobile ? 'calc(100vw - 48px)' : 320 }}>
                <div style={{ fontSize: 12, color: '#8c8c8c' }}>
                  只显示「从起点出发、指定层数以内」的知识点（顺着连线数几步）。选择会自动保存，换设备登录也在。
                </div>
                <div>
                  <div style={{ marginBottom: 4 }}>起点知识</div>
                  <Select
                    showSearch allowClear
                    placeholder="搜索并选择一篇知识作起点"
                    value={focusRootId}
                    onChange={(id) => saveFocus(id || null, focusDepth)}
                    options={merged.nodes.map((n: any) => ({ value: n.id, label: n.title }))}
                    style={{ width: '100%' }}
                  />
                  {!rootNodeId && (
                    <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 4 }}>
                      还没自选，当前默认用全图连线最多的枢纽节点当起点
                    </div>
                  )}
                </div>
                <div>
                  <div style={{ marginBottom: 4 }}>显示层数（顺着关联走几步）</div>
                  <Segmented
                    block
                    value={focusDepth}
                    options={[{ label: '2 层', value: 2 }, { label: '3 层', value: 3 }, { label: '4 层', value: 4 }]}
                    onChange={(v) => saveFocus(rootNodeId, v as number)}
                  />
                </div>
                <div style={{ fontSize: 12, color: '#8c8c8c' }}>
                  当前{showAll ? '显示全图' : '聚焦'} {showAll ? merged.nodes.length : (focusIds?.size ?? merged.nodes.length)} 篇 / 全图 {merged.nodes.length} 篇
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button size="small" onClick={() => setShowAll(v => !v)}>
                    {showAll ? '↩ 回到聚焦视图' : '👁 临时看全部'}
                  </Button>
                  <Button size="small" disabled={!rootNodeId} onClick={() => saveFocus(null, focusDepth)}>
                    恢复默认起点
                  </Button>
                </div>
              </div>
            }
          >
            <Button
              style={{ pointerEvents: 'auto', background: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.12)' }}
              type={showAll ? 'default' : 'primary'} ghost={!showAll}
            >
              🌱 {showAll ? '看全部' : `起点 · ${focusDepth} 层`}
            </Button>
          </Popover>
        </Tooltip>
        <Tooltip title="按关键词、标签、难度缩小图谱范围，只看想看的笔记；再点一次收起来">
          <Badge count={activeFilterCount} size="small" offset={[-4, 4]}>
            <Button
              id="graph-filter-btn"
              icon={<FilterOutlined />}
              onClick={() => setFilterOpen(v => !v)}
              style={{ pointerEvents: 'auto', background: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.12)' }}
            >
              筛选 {filterOpen ? '▴' : '▾'}
            </Button>
          </Badge>
        </Tooltip>
        {filterOpen && (
          <div style={{
            pointerEvents: 'auto', background: '#fff', borderRadius: 10,
            boxShadow: '0 4px 14px rgba(0,0,0,0.12)', padding: '10px 12px',
            display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', maxWidth: 820,
          }}>
            <Input
              allowClear
              prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />}
              placeholder="搜标题、摘要或标签"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              style={{ width: isMobile ? '100%' : 200 }}
            />
            <Tooltip title="可多选：笔记带其中任意一个标签就显示">
              <Select
                mode="multiple" allowClear maxTagCount="responsive"
                placeholder="按标签筛（可多选）"
                value={selTags}
                onChange={setSelTags}
                options={(data?.allTags || []).map((t: any) => ({ value: t.tag, label: `${t.tag}（${t.count}）` }))}
                style={isMobile ? { width: '100%' } : { minWidth: 220, maxWidth: 360 }}
              />
            </Tooltip>
            <Tooltip title="入门=新手也能懂；进阶=需要一些基础；深入=老手进阶用；未标注=还没标难度的笔记和 ✨ AI 沉淀">
              <Select
                mode="multiple" allowClear maxTagCount="responsive"
                placeholder="按难度筛（可多选）"
                value={selDiffs}
                onChange={setSelDiffs}
                options={DIFFICULTY_OPTIONS}
                style={isMobile ? { width: '100%' } : { minWidth: 170 }}
              />
            </Tooltip>
            <Tooltip title="去掉全部筛选条件，看回所有笔记">
              <Button onClick={clearFilters}>清空筛选</Button>
            </Tooltip>
            <span style={{ color: filtered.nodes.length ? '#8c8c8c' : '#cf1322', fontSize: 12, whiteSpace: 'nowrap' }}>
              {filtered.nodes.length
                ? `命中 ${filtered.nodes.length} / 共 ${filtered.total} 篇`
                : `没有匹配的笔记（共 ${filtered.total} 篇），换个条件或清空试试`}
            </span>
          </div>
        )}
      </div>

      {/* 筛选生效但一篇都没命中时，画布中央给个提示 */}
      {data && activeFilterCount > 0 && filtered.nodes.length === 0 && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          color: '#8c8c8c', fontSize: 14, pointerEvents: 'none',
        }}>
          没有匹配的笔记，换个关键词或「清空筛选」试试
        </div>
      )}

      {/* 笔记浮窗（数据查找/注解/学习程度封装在 NodeReadDrawer，与知识库页共用） */}
      <NodeReadDrawer open={!!selected} onClose={() => setSelected(null)} nodeId={selected} />

      {loading && <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}><Spin size="large" /></div>}
    </div>
  );
}
