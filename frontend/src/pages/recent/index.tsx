import { useEffect, useMemo, useState } from 'react';
import { Table, Tag, Spin, Segmented } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { api } from '../../api/client';
import { useAuth } from '../../store/auth';
import NodeReadDrawer from '../../components/NodeReadDrawer';

/** 来源徽标文案（后端按知识 id 前缀判定：ai- / up- / col- / 其余为手工笔记） */
const SOURCE_LABEL: Record<string, string> = {
  note: '📝 手工笔记', ai: '✨ AI 沉淀', upload: '📤 上传知识', collection: '📚 专栏',
};
/** 动态类型徽标：新增 / 更新 / 收到 AI 补充 */
const KIND_META: Record<string, { text: string; color: string }> = {
  added: { text: '新增', color: 'green' },
  updated: { text: '更新', color: 'blue' },
  supplemented: { text: '补充', color: 'purple' },
};

/** 最近更新：全站知识按更新/添加时间从新到旧排列（接口实时查数据库；游客只见手工笔记部分，登录后合并 AI 沉淀） */
export default function RecentPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<any[] | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [selected, setSelected] = useState<string | null>(null);

  // 登录态变化时重拉（游客 → 登录后补上 AI 沉淀层）
  useEffect(() => {
    api.get('/knowledge/recent')
      .then(r => setItems(r.data?.items || []))
      .catch(() => setItems([]));
  }, [user]);

  const rows = useMemo(() => {
    if (!items) return [];
    if (filter === 'note') return items.filter(i => i.source === 'note');
    if (filter === 'ai') return items.filter(i => i.source !== 'note');
    return items;
  }, [items, filter]);

  const columns: ColumnsType<any> = [
    {
      title: '标题', dataIndex: 'title', key: 'title',
      render: (_, n) => (
        <a onClick={() => setSelected(n.id)}>
          {n.source !== 'note' ? '✨ ' : ''}{n.title}
        </a>
      ),
    },
    { title: '来源', dataIndex: 'source', key: 'source', width: 120,
      render: (v: string) => <Tag>{SOURCE_LABEL[v] || v}</Tag> },
    { title: '分类', dataIndex: 'category', key: 'category', width: 130,
      render: (v: string) => v ? <Tag color="geekblue">{v}</Tag> : '-' },
    { title: '最近动态', key: 'activity', width: 180,
      render: (_, n) => {
        const k = KIND_META[n.kind] || { text: n.kind, color: 'default' };
        return (
          <span>
            <Tag color={k.color}>{k.text}</Tag>
            <span style={{ color: '#8c8c8c' }}>{n.timeText}</span>
          </span>
        );
      },
    },
  ];

  return (
    <div style={{ padding: 16, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ marginBottom: 12 }}>
        <span style={{ fontSize: 18, fontWeight: 600 }}>🆕 最近更新</span>
        <span style={{ marginLeft: 10, color: '#8c8c8c', fontSize: 13 }}>
          全站知识按更新 / 新增时间从新到旧排列，点标题即可阅读
        </span>
      </div>
      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Segmented
          value={filter}
          onChange={v => setFilter(v as string)}
          options={[
            { label: '全部', value: 'all' },
            { label: '📝 手工笔记', value: 'note' },
            // AI 沉淀层登录后才有数据，游客不显示该档
            ...(user ? [{ label: '✨ AI 沉淀', value: 'ai' }] : []),
          ]}
        />
        {!user && items && (
          <span style={{ color: '#8c8c8c', fontSize: 13 }}>
            登录后还能看到 ✨ AI 沉淀与 📤 上传知识的新动态
          </span>
        )}
      </div>
      {!items ? (
        <div style={{ textAlign: 'center', padding: 80, color: '#8c8c8c' }}>
          <Spin /> 正在加载最近更新…
        </div>
      ) : (
        <Table
          rowKey="id"
          size="middle"
          columns={columns}
          dataSource={rows}
          scroll={{ x: 620 }}
          onRow={n => ({ onClick: () => setSelected(n.id), style: { cursor: 'pointer' } })}
          pagination={{ pageSize: 20, showSizeChanger: false, showTotal: t => `共 ${t} 条动态` }}
          locale={{ emptyText: filter === 'ai' ? '暂无 AI 沉淀知识' : '暂无更新记录' }}
        />
      )}

      {/* 点击行打开的笔记浮窗（与图谱页同一个，支持划词注解/收藏/学习程度） */}
      <NodeReadDrawer open={!!selected} onClose={() => setSelected(null)} nodeId={selected} />
    </div>
  );
}
