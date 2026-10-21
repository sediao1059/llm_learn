import { useState, useEffect } from 'react';
import { Drawer, Tag, Button, Space, Popover, Tooltip, Spin, message, Divider } from 'antd';
import { LeftOutlined, RightOutlined, PlusOutlined, LoadingOutlined } from '@ant-design/icons';
import MarkdownContent from '../../components/MarkdownContent';

const LEVELS = [
  { v: 0, name: '未学习', icon: '○', color: '#d9d9d9' },
  { v: 1, name: '了解',   icon: '●', color: '#1677ff' },
  { v: 2, name: '熟悉',   icon: '●', color: '#52c41a' },
  { v: 3, name: '掌握',   icon: '★', color: '#faad14' },
];

interface Props {
  open: boolean;
  onClose: () => void;
  nodeId: string;
  nodeData: any;               // 笔记或 AI 节点数据
  nodeTitle: string;
  level: number;
  onLevelChange: (refId: string, level: number) => void;
  prevId?: string;
  nextId?: string;
  onNavigate: (refId: string) => void;
  // 加入路线
  routeId?: number;
  routeTitle?: string;
  routeSummary?: string;
  inRoute: boolean;
  onExtendRoute: (nodeId: string) => Promise<void>;
  extending: boolean;
  linkedNodes?: { id: string; title: string }[];
  onOpenLinked: (refId: string) => void;
}

export default function ArticleDrawer({
  open, onClose, nodeId, nodeData, nodeTitle, level,
  onLevelChange, prevId, nextId, onNavigate,
  routeId, routeTitle, routeSummary, inRoute, onExtendRoute, extending,
  linkedNodes, onOpenLinked,
}: Props) {
  const current = LEVELS[level] || LEVELS[0];

  const levelPopover = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {LEVELS.map(l => (
        <button key={l.v} onClick={() => onLevelChange(nodeId, l.v)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px',
            border: 'none', background: level === l.v ? '#f0f5ff' : 'transparent',
            borderRadius: 4, cursor: 'pointer', fontSize: 13,
            color: level === l.v ? '#1677ff' : '#333',
            fontWeight: level === l.v ? 600 : 400,
          }}>
          <span style={{ color: l.color, fontSize: 14, width: 16, textAlign: 'center' }}>{l.icon}</span>
          {l.name}
        </button>
      ))}
    </div>
  );

  return (
    <Drawer
      open={open} onClose={onClose}
      width={520} title={nodeTitle}
      destroyOnClose
    >
      {!nodeData ? (
        <div style={{ textAlign: 'center', paddingTop: 80 }}><Spin /></div>
      ) : (
        <>
          {/* 标签区 */}
          <div style={{ marginBottom: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {nodeData.layer && <Tag color="blue">{nodeData.layer}</Tag>}
            {nodeData.category && <Tag color="geekblue">{nodeData.category}</Tag>}
            {nodeData.difficulty && <Tag color="orange">{nodeData.difficulty}</Tag>}
            {nodeData.ai && <Tag color="purple">✨ AI 沉淀</Tag>}
          </div>

          {/* 摘要 */}
          {nodeData.summary && (
            <div style={{
              borderLeft: '3px solid #1677ff', background: '#f6f8fa',
              borderRadius: '0 8px 8px 0', padding: '8px 12px',
              fontSize: 13, color: '#555', marginBottom: 12,
            }}>{nodeData.summary}</div>
          )}

          {/* Markdown 正文 */}
          <div style={{ userSelect: 'text' }}>
            <MarkdownContent content={nodeData.content || ''} />
          </div>

          {/* 关联知识点 */}
          {linkedNodes && linkedNodes.length > 0 && (
            <>
              <Divider>🔗 关联知识点</Divider>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {linkedNodes.map(l => (
                  <Tag
                    key={l.id} color="success" style={{ cursor: 'pointer' }}
                    onClick={() => onOpenLinked(l.id)}
                  >{l.title} ↗</Tag>
                ))}
              </div>
            </>
          )}

          {/* 底部操作栏 */}
          <div style={{
            position: 'sticky', bottom: 0, background: '#fff',
            borderTop: '1px solid #f0f0f0', paddingTop: 12, marginTop: 16,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            {/* 上一个 */}
            <Button size="small" icon={<LeftOutlined />} disabled={!prevId}
              onClick={() => prevId && onNavigate(prevId)}>
              上一个
            </Button>

            {/* 标记程度 */}
            <Popover content={levelPopover} trigger="click" title="标注学习程度">
              <Tooltip title={`当前：${current.name}（点击修改）`}>
                <span style={{
                  cursor: 'pointer', fontSize: 18, color: current.color,
                  width: 24, textAlign: 'center', userSelect: 'none',
                }}>{current.icon}</span>
              </Tooltip>
            </Popover>

            {/* 下一个 */}
            <Button size="small" disabled={!nextId}
              onClick={() => nextId && onNavigate(nextId)}>
              下一个 <RightOutlined />
            </Button>

            {/* 加入本路线（仅当不在路线中且有路线上下文时显示） */}
            {routeId && !inRoute && (
              <Tooltip title={`加入「${routeTitle || ''}」— ${routeSummary || ''}`}>
                <Button
                  size="small" type="primary"
                  icon={extending ? <LoadingOutlined /> : <PlusOutlined />}
                  loading={extending}
                  onClick={() => onExtendRoute(nodeId)}
                  style={{ marginLeft: 'auto' }}
                >
                  {extending ? 'AI 整合中…' : '加入本路线'}
                </Button>
              </Tooltip>
            )}
          </div>
        </>
      )}
    </Drawer>
  );
}
