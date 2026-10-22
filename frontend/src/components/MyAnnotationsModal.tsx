import { useEffect, useState } from 'react';
import { Modal, List, Tag, Tooltip, Empty } from 'antd';
import { fmtShort } from '../utils/format';

const TOKEN = () => localStorage.getItem('llm_learn_token');

const TYPE_NAMES: Record<string, string> = {
  word: '词', sentence: '句', paragraph: '段', document: '整篇', interview: '💼 面试题',
};
const STATUS_TAGS: Record<string, { color: string; text: string }> = {
  pending: { color: 'orange', text: '⏳ 待审核' },
  approved: { color: 'success', text: '✅ 已通过' },
  rejected: { color: 'error', text: '❌ 已驳回' },
};

/** 顶栏「💡 我的注解」：我沉淀过的全部划词注解（含待审核/被驳回），点击跳到对应笔记 */
export default function MyAnnotationsModal({
  open, onClose, onOpenNode, onOpenPath,
}: {
  open: boolean; onClose: () => void;
  onOpenNode: (nodeId: string) => void;
  onOpenPath: () => void;
}) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch('/api/ai/annotations/mine', { headers: { Authorization: `Bearer ${TOKEN()}` } })
      .then(r => r.json())
      .then(d => setRows(d.annotations || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [open]);

  const go = (nodeId: string) => {
    onClose();
    if (nodeId.startsWith('path-')) onOpenPath();
    else onOpenNode(nodeId);
  };

  return (
    <Modal
      open={open} onCancel={onClose} footer={null}
      title="💡 我的注解（我划词沉淀过的解答）" width={640}
    >
      <List
        size="small" loading={loading}
        dataSource={rows}
        style={{ maxHeight: '60vh', overflowY: 'auto', marginTop: 4 }}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有注解；阅读笔记时选中文字点「💡 解答」就能沉淀" /> }}
        renderItem={(a: any) => {
          const st = STATUS_TAGS[a.status] || STATUS_TAGS.pending;
          return (
            <List.Item className="row-hover" style={{ cursor: 'pointer', padding: '8px 8px' }} onClick={() => go(a.nodeId)}>
              <List.Item.Meta
                title={
                  <span style={{ fontSize: 13 }}>
                    {a.nodeTitle || a.nodeId}
                    <Tag style={{ marginLeft: 8 }}>{TYPE_NAMES[a.type] || a.type}</Tag>
                    {a.status === 'rejected' && a.rejectReason ? (
                      <Tooltip title={`驳回理由：${a.rejectReason}`}>
                        <Tag color={st.color}>{st.text}（悬停看理由）</Tag>
                      </Tooltip>
                    ) : (
                      <Tag color={st.color}>{st.text}</Tag>
                    )}
                  </span>
                }
                description={
                  <span style={{ fontSize: 12 }}>
                    「{(a.anchorText || '').slice(0, 50) || '（整篇）'}」 · {fmtShort(a.createdAt)}
                    {a.nodeId.startsWith('path-') && ' · 挂在学习路线的主题内容上'}
                  </span>
                }
              />
            </List.Item>
          );
        }}
      />
    </Modal>
  );
}
