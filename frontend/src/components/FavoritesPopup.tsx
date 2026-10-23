import { useCallback, useEffect, useState } from 'react';
import { Popover, Button, List, Tag, Empty, Tooltip, message } from 'antd';
import { StarOutlined, StarFilled } from '@ant-design/icons';
import { fmtShort } from '../utils/format';

const TOKEN = () => localStorage.getItem('llm_learn_token');

/** 顶栏「⭐ 收藏」：我的收藏弹窗（点击整行原地打开笔记浮窗、不跳转图谱页；行尾 ⭐ 取消收藏） */
export default function FavoritesPopup({ onOpenNode, compact }: { onOpenNode: (nodeId: string) => void; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/favorites', { headers: { Authorization: `Bearer ${TOKEN()}` } })
      .then(r => r.json())
      .then(d => setRows(d.favorites || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { if (open) load(); }, [open, load]);

  const unfavorite = async (nodeId: string) => {
    // 乐观更新：先从列表移除，失败再刷新恢复
    setRows(prev => prev.filter(r => r.nodeId !== nodeId));
    try {
      await fetch('/api/favorites', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN()}` },
        body: JSON.stringify({ nodeId, on: false }),
      });
      message.success('已取消收藏');
    } catch { load(); }
  };

  return (
    <Popover
      trigger="click" placement="bottomRight" open={open}
      onOpenChange={setOpen}
      title="⭐ 我的收藏（仅自己可见）"
      content={
        <div style={{ width: 'min(380px, calc(100vw - 48px))', maxHeight: 440, overflowY: 'auto' }}>
          <List
            size="small" loading={loading}
            dataSource={rows}
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有收藏，在笔记面板标题旁点 ☆ 收藏" /> }}
            renderItem={(r: any) => (
              <List.Item
                className="row-hover"
                style={{ cursor: 'pointer', padding: '7px 8px' }}
                onClick={() => { setOpen(false); onOpenNode(r.nodeId); }}
                actions={[
                  <Tooltip key="del" title="取消收藏">
                    <Button type="text" size="small" danger icon={<StarFilled />}
                      onClick={(e) => { e.stopPropagation(); unfavorite(r.nodeId); }} />
                  </Tooltip>,
                ]}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.title}
                  </div>
                  <span style={{ fontSize: 12, color: '#999' }}>
                    {r.category && <Tag style={{ marginRight: 6 }}>{r.category}</Tag>}
                    收藏于 {fmtShort(r.createdAt)}
                  </span>
                </div>
              </List.Item>
            )}
          />
        </div>
      }
    >
      <Tooltip title="我收藏的笔记，点击直接打开">
        <Button size="small" icon={<StarOutlined />}>{compact ? null : '收藏'}</Button>
      </Tooltip>
    </Popover>
  );
}
