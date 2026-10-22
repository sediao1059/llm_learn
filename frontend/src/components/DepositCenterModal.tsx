import { useEffect, useState } from 'react';
import { Modal, List, Tag, Tooltip, Empty, Button } from 'antd';
import { fmtShort } from '../utils/format';

const TOKEN = () => localStorage.getItem('llm_learn_token');

/** 顶栏「📥 沉淀」：我提交的知识点沉淀进度（待审核 / 已进图谱可跳转 / 已驳回含理由） */
export default function DepositCenterModal({
  open, onClose, onOpenNode,
}: {
  open: boolean; onClose: () => void;
  onOpenNode: (nodeId: string) => void;
}) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch('/api/ai/submissions/mine', { headers: { Authorization: `Bearer ${TOKEN()}` } })
      .then(r => r.json())
      .then(d => setRows(d.submissions || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [open]);

  return (
    <Modal
      open={open} onCancel={onClose} footer={null}
      title="📥 沉淀中心（我提交的知识点进度）" width={640}
    >
      <List
        size="small" loading={loading}
        dataSource={rows}
        style={{ maxHeight: '60vh', overflowY: 'auto', marginTop: 4 }}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有提交；在 AI 助手里点「✨ 沉淀为知识点」即可提交" /> }}
        renderItem={(s: any) => {
          const st = s.status === 'approved' ? { color: 'success', text: '✅ 已进图谱' }
            : s.status === 'rejected' ? { color: 'error', text: '❌ 已驳回' }
            : { color: 'orange', text: '⏳ 待审核' };
          return (
            <List.Item
              style={{ padding: '8px 4px' }}
              actions={s.resultNodeId ? [
                <Button key="go" size="small" type="link"
                  onClick={() => { onClose(); onOpenNode(s.resultNodeId); }}>
                  查看知识点 ↗
                </Button>,
              ] : undefined}
            >
              <List.Item.Meta
                title={
                  <span style={{ fontSize: 13 }}>
                    <Tag color="gold">{'★'.repeat(s.importance || 0)}</Tag>
                    {s.status === 'rejected' && s.rejectReason ? (
                      <Tooltip title={`驳回理由：${s.rejectReason}`}><Tag color={st.color}>{st.text}（悬停看理由）</Tag></Tooltip>
                    ) : <Tag color={st.color}>{st.text}</Tag>}
                  </span>
                }
                description={<span style={{ fontSize: 12 }}>{s.questionExcerpt} · {fmtShort(s.createdAt)}</span>}
              />
            </List.Item>
          );
        }}
      />
    </Modal>
  );
}
