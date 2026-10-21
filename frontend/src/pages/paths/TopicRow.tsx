import { Tag, Popover } from 'antd';

const LEVELS = [
  { v: 0, name: '未学习', icon: '○', color: '#d9d9d9' },
  { v: 1, name: '了解',   icon: '●', color: '#1677ff' },
  { v: 2, name: '熟悉',   icon: '●', color: '#52c41a' },
  { v: 3, name: '掌握',   icon: '★', color: '#faad14' },
];

interface Topic {
  title: string;
  refId?: string;
  why?: string;
  children?: Topic[];
}

interface Props {
  topic: Topic;
  level: number;
  refTitle?: string;
  onLevelChange: (refId: string, level: number) => void;
  depth?: number;
}

export default function TopicRow({ topic, level, refTitle, onLevelChange, depth = 0 }: Props) {
  const current = LEVELS[level] || LEVELS[0];

  const popoverContent = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {LEVELS.map(l => (
        <button
          key={l.v}
          onClick={() => topic.refId && onLevelChange(topic.refId, l.v)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px',
            border: 'none', background: level === l.v ? '#f0f5ff' : 'transparent',
            borderRadius: 4, cursor: 'pointer', fontSize: 13,
            color: level === l.v ? '#1677ff' : '#333',
            fontWeight: level === l.v ? 600 : 400,
          }}
        >
          <span style={{ color: l.color, fontSize: 14, width: 16, textAlign: 'center' }}>{l.icon}</span>
          {l.name}
        </button>
      ))}
    </div>
  );

  return (
    <div style={{ paddingLeft: depth * 24 }}>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0',
          borderBottom: '1px solid #f5f5f5',
        }}
      >
        {/* 状态图标 + Popover */}
        <Popover content={popoverContent} trigger="click" placement="left"
          title={topic.refId ? '标注学习程度' : '该主题暂未关联知识点'}>
          <span
            style={{
              cursor: topic.refId ? 'pointer' : 'default',
              color: current.color, fontSize: 16, width: 20, textAlign: 'center',
              userSelect: 'none', transition: 'transform 0.15s',
            }}
            onMouseEnter={e => { if (topic.refId) e.currentTarget.style.transform = 'scale(1.3)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
          >
            {current.icon}
          </span>
        </Popover>

        {/* 主题名 */}
        <span
          style={{
            fontSize: 13.5, fontWeight: 500, flex: 1,
            cursor: topic.refId ? 'pointer' : 'default',
            color: topic.refId ? '#1677ff' : '#333',
          }}
          onClick={() => topic.refId && window.open(`/?node=${topic.refId}`, '_blank')}
        >
          {topic.title}
        </span>

        {/* 关联标签 */}
        {topic.refId ? (
          <Tag
            color="success"
            style={{ cursor: 'pointer', fontSize: 11, margin: 0 }}
            onClick={() => window.open(`/?node=${topic.refId}`, '_blank')}
          >
            🔗 {refTitle || topic.refId} ↗
          </Tag>
        ) : (
          <Tag style={{ fontSize: 11, margin: 0, color: '#8c8c8c' }}>新主题</Tag>
        )}
      </div>

      {/* 为什么学 */}
      {topic.why && (
        <div style={{ paddingLeft: 28, paddingRight: 12, paddingBottom: 6, fontSize: 11.5, color: '#bfbfbf' }}>
          {topic.why}
        </div>
      )}

      {/* 子主题 */}
      {topic.children?.map((child, i) => (
        <TopicRow
          key={i}
          topic={child}
          level={child.refId ? level : 0}
          refTitle={refTitle}
          onLevelChange={onLevelChange}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}
