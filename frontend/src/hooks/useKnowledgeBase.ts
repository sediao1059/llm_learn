import { useEffect, useState, useCallback } from 'react';
import { api } from '../api/client';
import { useAuth } from '../store/auth';

// bundle 全量数据在会话内只拉一次（模块级缓存，多页面/浮窗共享同一份请求）
let bundleCache: any = null;
let bundlePromise: Promise<any> | null = null;

/** 管理端改笔记后清掉会话级 bundle 缓存并通知所有已挂载的 hook 立即重拉 */
export function invalidateKnowledgeBundle() {
  bundleCache = null;
  bundlePromise = null;
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

  /** 节点的关联知识点（存在的才返回） */
  const linkedNodesOf = useCallback((node: any) =>
    node?.links?.map((id: string) => {
      const linked = findNode(id);
      return linked ? { id, title: linked.title } : null;
    })?.filter(Boolean) || [],
    [findNode]);

  /** 标注学习程度（乐观更新本地状态） */
  const setLevel = useCallback(async (refId: string, level: number) => {
    setProgress(prev => ({ ...prev, [refId]: level }));
    await api.put('/progress', { nodeId: refId, level });
  }, []);

  return { data, aiData, progress, findNode, linkedNodesOf, setLevel, user };
}
