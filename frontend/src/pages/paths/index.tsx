import { useEffect, useState, useCallback } from 'react';
import { Card, Progress, Tag, Button, Empty, Spin, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import TreeView from './TreeView';
import GenerateModal from './GenerateModal';
import ArticleDrawer from './ArticleDrawer';
import { useAuth } from '../../store/auth';

const headers = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${localStorage.getItem('llm_learn_token')}`,
});

/** 从路线树中按顺序收集所有 refId */
function collectRouteRefIds(tree: any): string[] {
  if (!tree?.stages) return [];
  const collect = (items: any[]): string[] =>
    items.flatMap(it => [it.refId, ...collect(it.children || [])]).filter(Boolean) as string[];
  return tree.stages.flatMap((st: any) => collect(st.items));
}

export default function PathsPage() {
  const { user } = useAuth();
  const [paths, setPaths] = useState<any[]>([]);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [refTitles, setRefTitles] = useState<Record<string, string>>({});
  const [nodeDataMap, setNodeDataMap] = useState<Record<string, any>>({});
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [genOpen, setGenOpen] = useState(false);
  const [genPathId, setGenPathId] = useState<number | undefined>();

  // ArticleDrawer 状态
  const [articleOpen, setArticleOpen] = useState(false);
  const [articleNodeId, setArticleNodeId] = useState<string | null>(null);
  const [extending, setExtending] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch('/api/ai/paths', { headers: headers() }).then(r => r.json()),
      fetch('/api/progress', { headers: headers() }).then(r => r.json()),
      fetch('/api/knowledge/bundle.json').then(r => r.json()),
    ]).then(([p, pr, kb]) => {
      const list = p.paths || [];
      setPaths(list);
      const prog: Record<string, number> = {};
      if (pr.progress) {
        for (const [id, v] of Object.entries(pr.progress)) prog[id] = (v as any).level || 0;
      }
      setProgress(prog);
      // refId → title + node data
      const titles: Record<string, string> = {};
      const dataMap: Record<string, any> = {};
      for (const n of kb.nodes || []) {
        titles[n.id] = n.title;
        dataMap[n.id] = n;
      }
      setRefTitles(titles);
      setNodeDataMap(dataMap);
      if (list.length && !selectedId) setSelectedId(list[0].id);
    }).finally(() => setLoading(false));
  }, [selectedId]);
  useEffect(() => { load(); }, []);

  const setLevel = async (refId: string, level: number) => {
    setProgress(prev => ({ ...prev, [refId]: level }));
    await fetch('/api/progress', {
      method: 'PUT', headers: headers(),
      body: JSON.stringify({ nodeId: refId, level }),
    });
  };

  const batchSetLevel = async (refIds: string[], level: number) => {
    setProgress(prev => {
      const next = { ...prev };
      refIds.forEach(id => { next[id] = level; });
      return next;
    });
    for (const id of refIds) {
      await fetch('/api/progress', {
        method: 'PUT', headers: headers(),
        body: JSON.stringify({ nodeId: id, level }),
      });
    }
  };

  const routePct = (path: any): number => {
    const ids = collectRouteRefIds(path.tree);
    if (!ids.length) return 0;
    const done = ids.filter(id => (progress[id] || 0) >= 1).length;
    return Math.round((done / ids.length) * 100);
  };

  const selected = paths.find(p => p.id === selectedId);
  const routeRefIds = selected ? collectRouteRefIds(selected.tree) : [];

  // ArticleDrawer 相关
  const openArticle = useCallback((refId: string) => {
    setArticleNodeId(refId);
    setArticleOpen(true);
  }, []);

  const closeArticle = () => {
    setArticleOpen(false);
    setArticleNodeId(null);
  };

  // 计算上/下一个
  const currentNodeIdx = articleNodeId ? routeRefIds.indexOf(articleNodeId) : -1;
  const prevId = currentNodeIdx > 0 ? routeRefIds[currentNodeIdx - 1] : undefined;
  const nextId = currentNodeIdx >= 0 && currentNodeIdx < routeRefIds.length - 1 ? routeRefIds[currentNodeIdx + 1] : undefined;

  // 当前文章数据
  const articleNode = articleNodeId ? nodeDataMap[articleNodeId] : null;
  const articleInRoute = articleNodeId ? routeRefIds.includes(articleNodeId) : false;

  // 关联节点
  const linkedNodes = articleNode?.links
    ?.filter((id: string) => nodeDataMap[id])
    ?.map((id: string) => ({ id, title: nodeDataMap[id].title })) || [];

  // 扩展路线
  const extendRoute = async (nodeId: string) => {
    if (!selectedId) return;
    setExtending(true);
    try {
      const r = await fetch(`/api/ai/paths/${selectedId}/extend`, {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ nodeId }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message || '整合失败');
      message.success('✅ 已加入路线');
      // 更新路线树
      setPaths(prev => prev.map(p => p.id === selectedId ? { ...p, tree: d.tree } : p));
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setExtending(false);
    }
  };

  return (
    <div style={{ display: 'flex', gap: 16, padding: 16, height: 'calc(100vh - 56px)', maxWidth: 1280, margin: '0 auto' }}>
      {/* 左侧 */}
      <div style={{ width: 280, flexShrink: 0, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ textAlign: 'center', paddingTop: 60 }}><Spin /></div>
        ) : paths.length === 0 ? (
          <Empty description="还没有路线" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          paths.map(p => {
            const pct = routePct(p);
            const isSelected = p.id === selectedId;
            return (
              <Card key={p.id} size="small" hoverable onClick={() => setSelectedId(p.id)}
                style={{
                  marginBottom: 10, cursor: 'pointer',
                  border: isSelected ? '2px solid #1677ff' : '1px solid #e8e8e8',
                  background: isSelected ? '#f0f5ff' : '#fff', borderRadius: 10,
                }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, flex: 1, lineHeight: 1.3 }}>{p.title}</span>
                  <Progress type="circle" percent={pct} size={42}
                    strokeColor={pct === 100 ? '#52c41a' : '#1677ff'}
                    format={(v) => <span style={{ fontSize: 10 }}>{v}%</span>} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#8c8c8c' }}>
                  {p.isOfficial && <Tag color="warning" style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>⭐ 官方</Tag>}
                  <span>{p.stageCount || (p.tree?.stages?.length) || 0} 个阶段</span>
                </div>
                {p.summary && (
                  <div style={{ fontSize: 11, color: '#bfbfbf', marginTop: 4, overflow: 'hidden',
                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                    {p.summary}
                  </div>
                )}
              </Card>
            );
          })
        )}
        <Button type="dashed" block icon={<PlusOutlined />}
          onClick={() => { setGenPathId(undefined); setGenOpen(true); }}
          style={{ marginTop: 4, borderRadius: 8 }}>
          AI 定制路线
        </Button>
      </div>

      {/* 右侧树形 */}
      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', paddingRight: 4 }}>
        {selected ? (
          <TreeView
            path={selected}
            progress={progress}
            refTitles={refTitles}
            onLevelChange={setLevel}
            onBatchLevel={batchSetLevel}
            onAIAdjust={() => { setGenPathId(selected.id); setGenOpen(true); }}
            onTitleChange={(id, title) => setPaths(prev => prev.map(p => p.id === id ? { ...p, title } : p))}
            onArticleOpen={openArticle}
          />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <Empty description="从左侧选择一条路线开始学习" />
          </div>
        )}
      </div>

      {/* 文章阅读 Drawer */}
      {articleNodeId && (
        <ArticleDrawer
          open={articleOpen}
          onClose={closeArticle}
          nodeId={articleNodeId}
          nodeData={articleNode}
          nodeTitle={articleNode?.title || refTitles[articleNodeId] || articleNodeId}
          level={progress[articleNodeId] || 0}
          onLevelChange={setLevel}
          prevId={prevId}
          nextId={nextId}
          onNavigate={(refId) => setArticleNodeId(refId)}
          routeId={selectedId || undefined}
          routeTitle={selected?.title}
          routeSummary={selected?.tree?.summary}
          inRoute={articleInRoute}
          onExtendRoute={extendRoute}
          extending={extending}
          linkedNodes={linkedNodes}
          onOpenLinked={(refId) => setArticleNodeId(refId)}
          userRole={user?.role || 'user'}
          onAnnotationSaved={() => message.success('注释已保存')}
        />
      )}

      {/* AI 生成弹窗 */}
      <GenerateModal
        open={genOpen}
        onClose={() => setGenOpen(false)}
        pathId={genPathId}
        onSaved={() => load()}
      />
    </div>
  );
}
