import { useEffect, useState, useCallback } from 'react';
import { api } from '../api/client';
import { useAuth } from '../store/auth';

// bundle 全量元数据在会话内只拉一次（模块级缓存，多页面/浮窗共享同一份请求）
let bundleCache: any = null;
let bundlePromise: Promise<any> | null = null;

// 正文按需缓存：nodeId → content（bundle 只含元数据，打开笔记浮窗时按篇拉取）
const contentCache = new Map<string, string>();

/** 管理端改笔记后清掉会话级 bundle/正文缓存并通知所有已挂载的 hook 立即重拉 */
export function invalidateKnowledgeBundle() {
  bundleCache = null;
  bundlePromise = null;
  contentCache.clear();
  window.dispatchEvent(new Event('kg:knowledge-bundle-updated'));
}

/**
 * 知识数据基座：静态笔记 bundle + 登录后的 AI 沉淀动态层 + 学习程度。
 * 图谱页 / 知识库页 / 笔记浮窗共用，避免各页面重复请求。
 */
export function useKnowledgeBase() {
  const { user } = useAuth();
  const [data, setData] = useState<any>(bundleCache);
  const [aiData, setAiData] = useState<any>(null);
  const [progress, setProgress] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!bundlePromise) {
      bundlePromise = api.get('/knowledge/bundle.json').then(r => {
        bundleCache = r.data;
        return r.data;
      });
    }
    bundlePromise.then(setData).catch(() => {});
    // 管理端保存/删除笔记后清缓存，图谱/知识库页立即生效（无需刷新页面）
    const reload = () => {
      bundlePromise = api.get('/knowledge/bundle.json').then(r => {
        bundleCache = r.data;
        return r.data;
      });
      bundlePromise.then(setData).catch(() => {});
    };
    window.addEventListener('kg:knowledge-bundle-updated', reload);
    return () => window.removeEventListener('kg:knowledge-bundle-updated', reload);
  }, []);

  useEffect(() => {
    if (!user) { setAiData(null); setProgress({}); return; }
    api.get('/ai/knowledge').then(r => setAiData(r.data)).catch(() => {});
    api.get('/progress').then(r => {
      const prog: Record<string, number> = {};
      if (r.data?.progress) {
        for (const [id, v] of Object.entries(r.data.progress)) prog[id] = (v as any).level || 0;
      }
      setProgress(prog);
    }).catch(() => {});
    // AI 沉淀写入图谱后，动态层立即刷新（无需手动刷新页面）
    const reload = () => api.get('/ai/knowledge').then(r => setAiData(r.data)).catch(() => {});
    window.addEventListener('kg:ai-knowledge-updated', reload);
    return () => window.removeEventListener('kg:ai-knowledge-updated', reload);
  }, [user]);

  /** 在静态 + AI 动态层里按 id 找节点 */
  const findNode = useCallback((id: string) =>
    data?.nodes.find((n: any) => n.id === id) || aiData?.nodes?.find((n: any) => n.id === id) || null,
    [data, aiData]);

  /** 按需拉单篇正文：AI 动态层节点自带 content 直接用；静态笔记走 note-content 接口（会话级缓存） */
  const loadContent = useCallback(async (nodeId: string): Promise<string> => {
    const cached = contentCache.get(nodeId);
    if (cached !== undefined) return cached;
    const r = await api.get(`/knowledge/note-content/${encodeURIComponent(nodeId)}`);
    const content = String(r.data?.content || '');
    contentCache.set(nodeId, content);
    return content;
  }, []);

  /** 节点的关联知识点（存在的才返回） */
  const linkedNodesOf = useCallback((node: any) =>
    node?.links?.map((id: string) => {
      const linked = findNode(id);
      return linked ? { id, title: linked.title } : null;
    })?.filter(Boolean) || [],
    [findNode]);

  /** 专栏文章：本节点是专栏聚合节点（col-）时，links 中的 up- 成员即专栏文章（挂载按入库顺序追加，序号即文章顺序） */
  const columnArticlesOf = useCallback((node: any): { id: string; title: string }[] => {
    if (!node || !String(node.id).startsWith('col-')) return [];
    return (node.links || [])
      .filter((id: string) => String(id).startsWith('up-'))
      .map((id: string) => {
        const n = findNode(id);
        return n ? { id, title: n.title } : null;
      })
      .filter(Boolean) as { id: string; title: string }[];
  }, [findNode]);

  /** 所属专栏：本节点是专栏成员文章（up-）时，links 中的 col- 节点即其所属专栏 */
  const collectionOf = useCallback((node: any): { id: string; title: string } | null => {
    if (!node || !String(node.id).startsWith('up-')) return null;
    const colId = (node.links || []).find((id: string) => String(id).startsWith('col-'));
    if (!colId) return null;
    const col = findNode(colId);
    return col ? { id: colId, title: col.title } : null;
  }, [findNode]);

  /** 标注学习程度（乐观更新本地状态） */
  const setLevel = useCallback(async (refId: string, level: number) => {
    setProgress(prev => ({ ...prev, [refId]: level }));
    await api.put('/progress', { nodeId: refId, level });
  }, []);

  return { data, aiData, progress, findNode, loadContent, linkedNodesOf, columnArticlesOf, collectionOf, setLevel, user };
}
