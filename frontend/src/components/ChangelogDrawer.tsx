import { useEffect, useState } from 'react';
import { Drawer, Timeline, Tag, Empty, Spin } from 'antd';

interface VersionItem {
  id: number;
  version: string;
  date: string;
  changes: string[];
}

export default function ChangelogDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [versions, setVersions] = useState<VersionItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setLoading(true);
      fetch('/api/versions')
        .then(r => r.json())
        .then(d => setVersions(d.versions || []))
        .finally(() => setLoading(false));
    }
  }, [open]);

  const getChangeColor = (text: string): string => {
    if (text.startsWith('✨') || text.startsWith('🎉')) return 'success';
    if (text.startsWith('🐛')) return 'error';
    if (text.startsWith('🎨') || text.startsWith('♻')) return 'processing';
    return 'default';
  };

  return (
    <Drawer
      open={open} onClose={onClose}
      title="📋 更新日志" width={480}
    >
      {loading ? (
        <div style={{ textAlign: 'center', paddingTop: 80 }}><Spin /></div>
      ) : versions.length === 0 ? (
        <Empty description="暂无版本记录" />
      ) : (
        <>
          <Timeline
            items={versions.map((v, i) => ({
              color: i === 0 ? 'blue' : 'gray',
              dot: i === 0 ? <span style={{ fontSize: 14 }}>🚀</span> : undefined,
              children: (
                <div style={{ paddingBottom: i === versions.length - 1 ? 0 : 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <b style={{ fontSize: 15 }}>v{v.version}</b>
                    {i === 0 && <Tag color="blue">最新</Tag>}
                    <span style={{ color: '#8c8c8c', fontSize: 12, marginLeft: 'auto' }}>{v.date}</span>
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 20, listStyle: 'none' }}>
                    {v.changes.map((c, j) => (
                      <li key={j} style={{
                        fontSize: 13, color: '#333', lineHeight: '1.8',
                        display: 'flex', alignItems: 'flex-start', gap: 6,
                      }}>
                        <Tag
                          color={getChangeColor(c)}
                          style={{ fontSize: 10, lineHeight: '18px', padding: '0 4px', flexShrink: 0, marginTop: 2 }}
                        >
                          {c.slice(0, 2)}
                        </Tag>
                        <span>{c.replace(/^[^\u4e00-\u9fa5\w]+/, '').trim()}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ),
            }))}
          />
          <p style={{ color: '#bfbfbf', fontSize: 12, textAlign: 'center', marginTop: 16 }}>
            共 {versions.length} 个版本
          </p>
        </>
      )}
    </Drawer>
  );
}
