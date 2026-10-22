import { Modal, Tag, Empty, Button } from 'antd';
import { fmtShort } from '../utils/format';

const TYPE_TAG: Record<string, { label: string; color?: string }> = {
  word: { label: '词' },
  sentence: { label: '句' },
  paragraph: { label: '段' },
  document: { label: '整篇', color: 'blue' },
  interview: { label: '💼 面试题', color: 'purple' },
};

/**
 * 本篇注解列表弹窗：知识浮窗底部「全部注解」入口打开，
 * 汇总该知识点的全部注解（划词词/句/段 + 整篇追问 + 面试题），
 * 点击条目进入注解阅读弹窗——内含知乎式讨论区，可继续向 AI 追问或写评论。
 */
export default function AnnotationListModal({ open, onClose, nodeTitle, annotations, onRead }: {
  open: boolean;
  onClose: () => void;
  nodeTitle: string;
  annotations: any[];
  onRead: (anno: any) => void;
}) {
  // 新的在前（接口按 id 升序返回）
  const rows = [...annotations].sort((a, b) => b.id - a.id);

  return (
    <Modal
      open={open} onCancel={onClose}
      title={`💬 全部注解 · ${nodeTitle || ''}`}
      width={560}
      footer={
        <Button size="small" type="primary" onClick={onClose}>关闭</Button>
      }
    >
      {rows.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <span style={{ fontSize: 13, color: '#8c8c8c' }}>
              这篇还没有注解 · 选中正文文字可「💡 解答」，
              <br />或点标题栏 🤖 图标直接向 AI 追问
            </span>
          }
        />
      ) : (
        <div style={{ maxHeight: '56vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.map((a: any) => {
            const t = TYPE_TAG[a.type] || { label: a.type };
            const digest = (a.question || a.anchorText || '').slice(0, 40);
            return (
              <div
                key={a.id}
                className="anno-entry"
                style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                onClick={() => onRead(a)}
              >
                <Tag color={t.color} style={{ marginInlineEnd: 0, flexShrink: 0 }}>{t.label}</Tag>
                {a.status !== 'approved' && (
                  <Tag color={a.status === 'pending' ? 'warning' : 'error'} style={{ marginInlineEnd: 0, flexShrink: 0 }}>
                    {a.status === 'pending' ? '待审核' : '已驳回'}
                  </Tag>
                )}
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {digest || '点击阅读'}
                </span>
                <span style={{ flexShrink: 0, fontSize: 12, color: '#bfbfbf' }}>
                  {a.replyCount ? `💬 ${a.replyCount} · ` : ''}{a.displayName || a.createdBy} · {fmtShort(a.createdAt)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
