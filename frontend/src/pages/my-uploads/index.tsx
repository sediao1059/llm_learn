import { useEffect, useState, useCallback } from 'react';
import { Card, Tag, Alert, Tooltip, Empty } from 'antd';
import dayjs from 'dayjs';
import { api } from '../../api/client';
import UploadItemReadDrawer from '../../components/UploadItemReadDrawer';
import { uploadSourceLabel } from '../upload';

interface Upload {
  id: number; kind: string; url: string; title: string; note: string; fileName?: string;
  status: string; errorMsg: string | null; rejectReason: string | null;
  submittedBy: string; createdAt: string; items: any[];
}

const STATUS_MAP: Record<string, [string, string]> = {
  extracting: ['processing', '⏳ AI 拆解中'],
  extracted: ['warning', '📦 待审核'],
  approved: ['success', '✅ 已入库（进图谱专栏，全员可见）'],
  rejected: ['error', '❌ 已驳回'],
  extract_failed: ['error', '⚠️ 拆解失败'],
};

/** 我的提交：上传过的知识全记录，审核通过前就能点开阅读 AI 拆解出的内容 */
export default function MyUploadsPage() {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [reading, setReading] = useState<any>(null);

  const load = useCallback(() => {
    api.get('/ai/uploads/mine').then(r => setUploads(r.data.uploads || [])).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const timer = uploads.some(u => u.status === 'extracting') ? setInterval(load, 3000) : null;
    return () => { if (timer) clearInterval(timer); };
  }, [load, uploads.some(u => u.status === 'extracting')]);

  const statusTag = (s: string) => {
    const [color, text] = STATUS_MAP[s] || ['default', s];
    return <Tag color={color}>{text}</Tag>;
  };

  return (
    <div style={{ padding: 16, maxWidth: 900, margin: '0 auto' }}>
      <Alert
        type="info" showIcon style={{ marginBottom: 16 }}
        message="这里是你上传过的全部知识"
        description="AI 拆解保存后，审核通过之前你就能点开阅读拆解出的每篇内容；审核通过后每篇作为「📤 上传」节点进图谱、挂在所属「📚 专栏」聚合节点下对全员可见，被驳回会给出理由。"
      />

      {uploads.length === 0 ? (
        <Empty description="还没有上传过知识，去「📤 上传知识」提交第一篇吧" style={{ marginTop: 80 }} />
      ) : (
        uploads.map(u => (
          <Card key={u.id} size="small" style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, wordBreak: 'break-all', flex: 1 }}>
                {u.kind === 'url'
                  ? <a href={u.url} target="_blank" rel="noreferrer">{u.url}</a>
                  : uploadSourceLabel(u)}
              </span>
              {statusTag(u.status)}
              <span style={{ color: '#909399', fontSize: 12 }}>
                {dayjs(u.createdAt).format('YYYY-MM-DD HH:mm')}
              </span>
            </div>
            {u.note && <div style={{ color: '#909399', fontSize: 12, marginTop: 4 }}>备注：{u.note}</div>}
            {u.errorMsg && <Alert type="error" message={u.errorMsg} style={{ marginTop: 8 }} />}
            {u.rejectReason && <Alert type="error" message={`驳回理由：${u.rejectReason}`} style={{ marginTop: 8 }} />}
            {u.items?.length > 0 && (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {u.items.map((it: any) => (
                  <Tooltip key={it.id} title="点开阅读这篇内容（审核通过前也只有你能看到）">
                    <div
                      className="anno-entry"
                      onClick={() => setReading(it)}
                    >
                      <span style={{ fontWeight: 500 }}>{it.title}</span>
                      <span style={{ marginLeft: 8 }}>
                        {it.tags?.map((t: string) => <Tag key={t} style={{ marginRight: 4 }}>{t}</Tag>)}
                      </span>
                    </div>
                  </Tooltip>
                ))}
              </div>
            )}
          </Card>
        ))
      )}

      {/* 拆解条目阅读浮窗（复用知识点击展开的抽屉，纯阅读模式） */}
      <UploadItemReadDrawer item={reading} onClose={() => setReading(null)} />
    </div>
  );
}
