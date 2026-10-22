import { Tag, Popover, Tooltip } from 'antd';

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
  content?: string;
  children?: Topic[];
}

interface Props {
  topic: Topic;
  level: number;
  refTitle?: string;
  /** 主题在路线树中的定位：addr[0]=阶段下标，其余为逐层下标链 */
  addr: number[];
  onLevelChange: (refId: string, level: number) => void;
  onArticleOpen?: (refId: string) => void;
  /** 点击「新主题」打开懒加载生成抽屉 */
  onOpenTopic?: (addr: number[]) => void;
  depth?: number;
}

export default function TopicRow({
  topic, level, refTitle, addr, onLevelChange, onArticleOpen, onOpenTopic, depth = 0,
}: Props) {
  const current = LEVELS[level] || LEVELS[0];

  const popoverContent = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {LEVELS.map(l => (
        <button
          key={l.v}
          onClick={() => topic.refId && onLevelChange(topic.refId, l.v)}
          className={`level-option${level === l.v ? ' active' : ''}`}
        >
          <span style={{ color: l.color, fontSize: 14, width: 16, textAlign: 'center' }}>{l.icon}</span>
          {l.name}
        </button>
      ))}
    </div>
  );

  // 已关联知识点 → 打开笔记；新主题 → 懒加载 AI 生成学习内容
  const handleTitleClick = () => {
    if (topic.refId) {
      onArticleOpen?.(topic.refId);
    } else {
      onOpenTopic?.(addr);
    }
  };

  const clickable = topic.refId ? !!onArticleOpen : !!onOpenTopic;

  return (
    <div style={{ paddingLeft: depth * 24 }}>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0',
          borderBottom: '1px solid #f5f5f5',
        }}
      >
        <Popover content={popoverContent} trigger="click" placement="left"
          title={topic.refId ? '标注学习程度' : '该主题暂未关联知识点，点击标题可让 AI 生成学习内容'}>
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

        <Tooltip title={topic.refId ? undefined : '点击让 AI 生成这篇学习内容（首次生成后缓存）'}>
          <span
            style={{
              fontSize: 13.5, fontWeight: 500, flex: 1,
              cursor: clickable ? 'pointer' : 'default',
              color: topic.refId ? '#1677ff' : '#722ed1',
            }}
            onClick={handleTitleClick}
          >
            {topic.title}
          </span>
        </Tooltip>

        {topic.refId ? (
          <Tag
            color="success"
            style={{ cursor: onArticleOpen ? 'pointer' : 'default', fontSize: 11, margin: 0 }}
            onClick={handleTitleClick}
          >
            🔗 {refTitle || topic.refId}
          </Tag>
        ) : topic.content ? (
          <Tag
            color="purple"
            style={{ cursor: clickable ? 'pointer' : 'default', fontSize: 11, margin: 0 }}
            onClick={handleTitleClick}
          >
            ✨ 已生成
          </Tag>
        ) : (
          <Tooltip title="点击让 AI 生成这篇学习内容">
            <Tag
              color="purple"
              style={{ cursor: clickable ? 'pointer' : 'default', fontSize: 11, margin: 0, background: '#f9f0ff' }}
              onClick={handleTitleClick}
            >
              ✨ AI 生成
            </Tag>
          </Tooltip>
        )}
      </div>

      {topic.why && (
        <div style={{ paddingLeft: 28, paddingRight: 12, paddingBottom: 6, fontSize: 11.5, color: '#bfbfbf' }}>
          {topic.why}
        </div>
      )}

      {topic.children?.map((child, i) => (
        <TopicRow
          key={i}
          topic={child}
          level={child.refId ? level : 0}
          refTitle={refTitle}
          addr={[...addr, i]}
          onLevelChange={onLevelChange}
          onArticleOpen={onArticleOpen}
          onOpenTopic={onOpenTopic}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}
