import { useEffect, useState, useCallback } from 'react';
import { Card, Progress, Tag, Button, Empty, Spin, message, Popconfirm } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import TreeView from './TreeView';
import GenerateModal from './GenerateModal';
import TopicContentDrawer from './TopicContentDrawer';
import KnowledgeDrawer from '../../components/KnowledgeDrawer';
import { useAuth } from '../../store/auth';
import { trackLlmCall } from '../../utils/llmQueueNotice';

const headers = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${localStorage.getItem('llm_learn_token')}`,
});

function collectRouteRefIds(tree: any): string[] {
  if (!tree?.stages) return [];
  const collect = (items: any[]): string[] =>
    items.flatMap(it => [it.refId, ...collect(it.children || [])]).filter(Boolean) as string[];
  return tree.stages.flatMap((st: any) => collect(st.items));
}

/** 按定位链在路线树里找主题条目：addr[0]=阶段下标，addr[1]=主题下标，之后为子主题下标链 */
function findTopic(tree: any, addr: number[]): any | null {
  let item = tree?.stages?.[addr[0]]?.items?.[addr[1]];
  for (let i = 2; i < addr.length && item; i++) item = item.children?.[addr[i]];
  return item || null;
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

  const [articleNodeId, setArticleNodeId] = useState<string | null>(null);
  const [extending, setExtending] = useState(false);
  const [annotations, setAnnotations] = useState<any[]>([]);
  const [annKey, setAnnKey] = useState(0);

  // 加载当前打开文章的注解（划词注解下划线渲染用）
  useEffect(() => {
    if (articleNodeId && user) {
      fetch(`/api/ai/annotations?nodeId=${articleNodeId}`, { headers: headers() })
        .then(r => r.json())
        .then(d => setAnnotations(d.annotations || []))
        .catch(() => setAnnotations([]));
    } else setAnnotations([]);
  }, [articleNodeId, user, annKey]);

  /** 新主题懒加载抽屉：当前打开的主题定位（阶段下标 + 主题下标链） */
  const [topicAddr, setTopicAddr] = useState<number[] | null>(null);

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
      const titles: Record<string, string> = {};
      const dataMap: Record<string, any> = {};
      for (const n of kb.nodes || []) { titles[n.id] = n.title; dataMap[n.id] = n; }
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
  const currentNodeIdx = articleNodeId ? routeRefIds.indexOf(articleNodeId) : -1;
  const prevId = currentNodeIdx > 0 ? routeRefIds[currentNodeIdx - 1] : undefined;
  const nextId = currentNodeIdx >= 0 && currentNodeIdx < routeRefIds.length - 1 ? routeRefIds[currentNodeIdx + 1] : undefined;
  const articleNode = articleNodeId ? nodeDataMap[articleNodeId] : null;
  const articleInRoute = articleNodeId ? routeRefIds.includes(articleNodeId) : false;
  const linkedNodes = articleNode?.links
    ?.filter((id: string) => nodeDataMap[id])
    ?.map((id: string) => ({ id, title: nodeDataMap[id].title })) || [];

  const extendRoute = async (nodeId: string) => {
    if (!selectedId) return;
    setExtending(true);
    try {
      const r = await trackLlmCall(fetch(`/api/ai/paths/${selectedId}/extend`, {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ nodeId }),
      }));
      const d = await r.json();
      if (!r.ok) throw new Error(d.message || '整合失败');
      message.success('✅ 已加入路线');
      setPaths(prev => prev.map(p => p.id === selectedId ? { ...p, tree: d.tree } : p));
    } catch (e: any) { message.error(e.message); }
    finally { setExtending(false); }
  };

  /** 是否可删除：与后端一致——普通路线限创建者或管理员，官方路线仅管理员 */
  const canDelete = (p: any) =>
    !!user && (user.role === 'admin' || (!p.isOfficial && p.createdBy === user.username));

  const doDelete = async (p: any) => {
    try {
      const r = await fetch(`/api/ai/paths/${p.id}`, { method: 'DELETE', headers: headers() });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message || '删除失败');
      message.success('已删除');
      const rest = paths.filter(x => x.id !== p.id);
      setPaths(rest);
      if (selectedId === p.id) {
        setSelectedId(rest[0]?.id ?? null);
        setTopicAddr(null);
      }
    } catch (e: any) { message.error(e.message); }
  };

  /** 新主题内容生成完成：回写本地路线树（Tag 变「已生成」，下次点开直接读缓存） */
  const writeTopicContent = (addr: number[], content: string) => {
    if (!selectedId) return;
    setPaths(prev => prev.map(p => {
      if (p.id !== selectedId || !p.tree) return p;
      const t = JSON.parse(JSON.stringify(p.tree));
      const item = findTopic(t, addr);
      if (item && !item.refId) item.content = content;
      return { ...p, tree: t };
    }));
  };

  const topicItem = topicAddr && selected ? findTopic(selected.tree, topicAddr) : null;
  const topicStageTitle = topicAddr && selected ? selected.tree?.stages?.[topicAddr[0]]?.title : undefined;

  return (
    <div style={{ display: 'flex', gap: 16, padding: 16, height: 'calc(100vh - 56px)', maxWidth: 1280, margin: '0 auto' }}>
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
              <Card key={p.id} size="small" hoverable onClick={() => { setSelectedId(p.id); setTopicAddr(null); }}
                style={{
                  marginBottom: 10, cursor: 'pointer',
                  border: isSelected ? '2px solid #1677ff' : '1px solid #e8e8e8',
                  background: isSelected ? '#f0f5ff' : '#fff', borderRadius: 10,
                }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, flex: 1, lineHeight: 1.3 }}>{p.title}</span>
                  {canDelete(p) && (
                    <Popconfirm
                      title={`删除路线「${p.title}」？`}
                      description="路线与已生成内容将一并删除，不可恢复"
                      okText="删除" cancelText="取消" okButtonProps={{ danger: true }}
                      onConfirm={() => doDelete(p)}>
                      <DeleteOutlined onClick={e => e.stopPropagation()} style={{ color: '#ff4d4f', fontSize: 13 }} />
                    </Popconfirm>
                  )}
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
            onArticleOpen={(refId) => setArticleNodeId(refId)}
            onOpenTopic={(addr) => setTopicAddr(addr)}
          />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <Empty description="从左侧选择一条路线开始学习" />
          </div>
        )}
      </div>

      {articleNodeId && (
        <KnowledgeDrawer
          open={!!articleNodeId}
          onClose={() => setArticleNodeId(null)}
          nodeId={articleNodeId}
          nodeData={articleNode}
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
          isLoggedIn={!!user}
          userRole={user?.role}
          annotations={annotations}
          onAnnotationSaved={() => { message.success('注解已保存'); setAnnKey(k => k + 1); }}
        />
      )}

      {topicAddr && selected && (
        <TopicContentDrawer
          open={!!topicAddr}
          onClose={() => setTopicAddr(null)}
          pathId={selected.id}
          addr={topicAddr}
          topic={topicItem}
          stageTitle={topicStageTitle}
          onGenerated={(content) => writeTopicContent(topicAddr, content)}
        />
      )}

      <GenerateModal
        open={genOpen}
        onClose={() => setGenOpen(false)}
        pathId={genPathId}
        onSaved={() => load()}
      />
    </div>
  );
}
