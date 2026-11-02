import { useEffect, useState } from 'react';
import KnowledgeDrawer from './KnowledgeDrawer';
import { useKnowledgeBase } from '../hooks/useKnowledgeBase';
import { api } from '../api/client';

interface NodeReadDrawerProps {
  open: boolean;
  onClose: () => void;
  /** 要打开的图谱节点 id（静态笔记或 AI 沉淀节点） */
  nodeId: string | null;
}

/**
 * 图谱节点阅读浮窗：封装「按 id 找节点 + 按需拉正文 + 关联节点 + 注解加载 + 学习程度」，
 * 图谱页 / 知识库页等复用，点关联标签可在浮窗内直接跳转下一篇。
 */
export default function NodeReadDrawer({ open, onClose, nodeId }: NodeReadDrawerProps) {
  const { findNode, loadContent, linkedNodesOf, columnArticlesOf, collectionOf, progress, setLevel, user } = useKnowledgeBase();
  const [annotations, setAnnotations] = useState<any[]>([]);
  const [annKey, setAnnKey] = useState(0);
  // 浮窗内点关联节点可连续跳转：currentId 跟随外部传入，也允许内部切换
  const [currentId, setCurrentId] = useState<string | null>(nodeId);
  useEffect(() => { setCurrentId(nodeId); }, [nodeId]);

  // 按需正文：bundle 只带元数据，AI 动态层节点自带 content；静态笔记打开浮窗时按篇拉取
  const [content, setContent] = useState<string | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  useEffect(() => {
    setContent(null);
    setContentLoading(false);
    if (!currentId) return;
    const node = findNode(currentId);
    if (!node) return;
    if (typeof node.content === 'string' && node.content) { setContent(node.content); return; }
    setContentLoading(true);
    loadContent(currentId)
      .then(setContent)
      .catch(() => setContent(''))
      .finally(() => setContentLoading(false));
  }, [currentId, findNode, loadContent]);

  useEffect(() => {
    if (open && currentId && user) {
      api.get(`/ai/annotations?nodeId=${currentId}`).then(r => {
        setAnnotations(r.data?.annotations || []);
      }).catch(() => setAnnotations([]));
    } else setAnnotations([]);
  }, [open, currentId, user, annKey]);

  const node = currentId ? findNode(currentId) : null;
  const nodeData = node && content !== null ? { ...node, content } : node;

  // 专栏文章单列（专栏节点）/ 所属专栏置顶（成员文章），两者不再混入「关联知识点」
  const columnArticles = columnArticlesOf(node);
  const belongsToCollection = collectionOf(node);
  const excludedIds = new Set<string>([
    ...columnArticles.map((a) => a.id),
    ...(belongsToCollection ? [belongsToCollection.id] : []),
  ]);
  const linkedNodes = linkedNodesOf(node).filter((l: { id: string }) => !excludedIds.has(l.id));

  return (
    <KnowledgeDrawer
      open={open && !!node}
      onClose={onClose}
      nodeId={currentId || ''}
      nodeData={nodeData}
      contentLoading={contentLoading}
      level={currentId ? (progress[currentId] || 0) : 0}
      onLevelChange={user ? setLevel : undefined}
      linkedNodes={linkedNodes}
      columnArticles={columnArticles}
      belongsToCollection={belongsToCollection}
      onOpenLinked={(refId) => setCurrentId(refId)}
      isLoggedIn={!!user}
      userRole={user?.role}
      annotations={annotations}
      onAnnotationSaved={() => setAnnKey(k => k + 1)}
    />
  );
}
