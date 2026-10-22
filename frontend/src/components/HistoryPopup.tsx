import { useEffect, useState } from 'react';
import { Popover, Button, List, Tag, Empty, Tooltip } from 'antd';
import { HistoryOutlined } from '@ant-design/icons';
import { fmtShort } from '../utils/format';

const TOKEN = () => localStorage.getItem('llm_learn_token');

/** 顶栏「🕘 足迹」：浏览记录弹窗（仅自己可见；点击行原地打开笔记浮窗，不跳转图谱页） */
export default function HistoryPopup({ onOpenNode }: { onOpenNode: (nodeId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch('/api/history', { headers: { Authorization: `Bearer ${TOKEN()}` } })
      .then(r => r.json())
      .then(d => setRows(d.history || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [open]);

  const go = (nodeId: string) => {
    setOpen(false);
    onOpenNode(nodeId);
  };

  return (
    <Popover
      trigger="click" placement="bottomRight" open={open}
      onOpenChange={setOpen}
      title="🕘 我的足迹（最近 200 条，仅自己可见）"
      content={
        <div style={{ width: 380, maxHeight: 440, overflowY: 'auto' }}>
          <List
            size="small" loading={loading}
            dataSource={rows}
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有浏览记录，去图谱里点开笔记吧" /> }}
            renderItem={(r: any) => (
              <List.Item
                style={{ cursor: 'pointer', padding: '7px 4px' }}
                onClick={() => go(r.nodeId)}
              >
                <List.Item.Meta
                  title={<span style={{ fontSize: 13 }}>{r.title}</span>}
                  description={
                    <span style={{ fontSize: 12 }}>
                      {r.category && <Tag style={{ marginRight: 6 }}>{r.category}</Tag>}
                      看过 {r.count} 次 · {fmtShort(r.lastViewedAt)}
                    </span>
                  }
                />
              </List.Item>
            )}
          />
        </div>
      }
    >
      <Tooltip title="我看过的笔记，点击回到那篇">
        <Button size="small" icon={<HistoryOutlined />}>足迹</Button>
      </Tooltip>
    </Popover>
  );
}
