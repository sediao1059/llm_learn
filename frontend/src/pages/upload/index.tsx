import { useEffect, useState, useCallback } from 'react';
import { Card, Tabs, Form, Input, Button, Tag, Statistic, message, Alert, Tooltip, Upload } from 'antd';
import { api } from '../../api/client';
import UploadItemReadDrawer from '../../components/UploadItemReadDrawer';
import { useResponsive } from '../../hooks/useResponsive';

const { Dragger } = Upload;

interface Upload {
  id: number; kind: string; url: string; title: string; note: string; fileName?: string;
  status: string; errorMsg: string | null; rejectReason: string | null;
  submittedBy: string; createdAt: string; items: any[];
}

/** 列表里展示上传来源：链接 / 文本 / 图片 / Word */
export function uploadSourceLabel(u: { kind: string; url?: string; title?: string; fileName?: string }) {
  if (u.kind === 'url') return u.url || '';
  if (u.kind === 'image') return `🖼 ${u.fileName || '图片'}`;
  if (u.kind === 'docx') return `📄 ${u.fileName || 'Word 文档'}`;
  return `📝《${u.title || '文本'}》`;
}

export default function UploadPage() {
  // 手机端改单列：「我的贡献」卡片折到表单下方通栏（桌面右栏 280px 不变）
  const { isMobile } = useResponsive();
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [contrib, setContrib] = useState({ total: 0, days: [] as any[] });
  const [submitting, setSubmitting] = useState(false);
  const [reading, setReading] = useState<any>(null);
  const [fileList, setFileList] = useState<any[]>([]);
  const [fileForm] = Form.useForm();

  const load = useCallback(() => {
    api.get('/ai/uploads/mine').then(r => setUploads(r.data.uploads || [])).catch(() => {});
    api.get('/contributions/me').then(r => setContrib(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const timer = uploads.some(u => u.status === 'extracting') ? setInterval(load, 3000) : null;
    return () => { if (timer) clearInterval(timer); };
  }, [uploads.some(u => u.status === 'extracting')]);

  const submitUrl = async (values: any) => {
    setSubmitting(true);
    try {
      await api.post('/ai/uploads', { kind: 'url', ...values });
      message.success('已提交，AI 正在拆解');
      load();
    } catch (e: any) { message.error(e?.response?.data?.message || '提交失败'); }
    finally { setSubmitting(false); }
  };

  const submitText = async (values: any) => {
    setSubmitting(true);
    try {
      await api.post('/ai/uploads', { kind: 'text', ...values });
      message.success('已提交，AI 正在整理');
      load();
    } catch (e: any) { message.error(e?.response?.data?.message || '提交失败'); }
    finally { setSubmitting(false); }
  };

  // 文件上传：入列表前先挡掉类型/超限的（与服务端同一套规则）
  const beforeUpload = (file: File) => {
    const isDocx = file.name.toLowerCase().endsWith('.docx');
    const isImage = /^image\/(png|jpe?g|webp)$/.test(file.type);
    if (!isDocx && !isImage) {
      message.error('仅支持图片（png / jpg / webp）与 Word（.docx）文件；.doc 老格式请先另存为 .docx');
      return Upload.LIST_IGNORE;
    }
    if (isImage && file.size >= 5 * 1024 * 1024) {
      message.error(`「${file.name}」超过 5M，请压缩后再上传`);
      return Upload.LIST_IGNORE;
    }
    if (isDocx && file.size >= 20 * 1024 * 1024) {
      message.error(`「${file.name}」超过 20M`);
      return Upload.LIST_IGNORE;
    }
    return false; // 阻止自动上传，只进待提交列表
  };

  const submitFile = async (values: any) => {
    if (!fileList.length) { message.warning('请先选择要上传的文件'); return; }
    const docxCount = fileList.filter(f => String(f.name || '').toLowerCase().endsWith('.docx')).length;
    const imageCount = fileList.length - docxCount;
    if (docxCount > 1) { message.error('一次只能上传 1 个 Word 文档'); return; }
    if (docxCount && imageCount) { message.error('图片与 Word 文档请分开提交'); return; }
    if (imageCount > 9) { message.error('一次最多上传 9 张图片'); return; }
    const fd = new FormData();
    fileList.forEach(f => fd.append('files', f.originFileObj || f));
    fd.append('note', values?.note || '');
    setSubmitting(true);
    try {
      await api.post('/ai/uploads/file', fd);
      message.success('已提交，AI 正在解析');
      setFileList([]);
      fileForm.resetFields();
      load();
    } catch (e: any) { message.error(e?.response?.data?.message || '提交失败'); }
    finally { setSubmitting(false); }
  };

  const statusTag = (s: string) => {
    const map: Record<string, [string, string]> = {
      extracting: ['processing', '⏳ AI 拆解中'], extracted: ['warning', '📦 待审核'],
      approved: ['success', '✅ 已入库'], rejected: ['error', '❌ 已驳回'],
      extract_failed: ['error', '⚠️ 拆解失败'],
    };
    const [color, text] = map[s] || ['default', s];
    return <Tag color={color}>{text}</Tag>;
  };

  const activeDays = contrib.days.filter((d: any) => d.count > 0).length;

  return (
    <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 16, padding: 16, maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ flex: 1 }}>
        <Card>
          <Tabs items={[
            { key: 'url', label: '🔗 发链接', children: (
              <Form onFinish={submitUrl} labelCol={{ span: 24 }}>
                <Form.Item name="url" label="文章链接" rules={[{ required: true, type: 'url' }]}>
                  <Input placeholder="https://zhuanlan.zhihu.com/p/xxxxx" />
                </Form.Item>
                <Form.Item name="note" label="备注（可选）"><Input maxLength={200} /></Form.Item>
                <Button type="primary" htmlType="submit" loading={submitting}>🚀 提交并让 AI 拆解</Button>
              </Form>
            )},
            { key: 'text', label: '📝 贴文本', children: (
              <Form onFinish={submitText} labelCol={{ span: 24 }}>
                <Form.Item name="title" label="标题" rules={[{ required: true }]}><Input maxLength={100} /></Form.Item>
                <Form.Item name="text" label="正文（至少 200 字）" rules={[{ required: true, min: 200 }]}>
                  <Input.TextArea rows={10} />
                </Form.Item>
                <Form.Item name="note" label="备注（可选）"><Input maxLength={200} /></Form.Item>
                <Button type="primary" htmlType="submit" loading={submitting}>🚀 提交并让 AI 整理</Button>
              </Form>
            )},
            { key: 'file', label: '📎 传文件', children: (
              <Form form={fileForm} onFinish={submitFile} labelCol={{ span: 24 }}>
                <Form.Item label="图片（png / jpg / webp）或 Word 文档（.docx）">
                  <Dragger
                    fileList={fileList}
                    beforeUpload={beforeUpload}
                    onChange={({ fileList: fl }) => setFileList(fl)}
                    accept=".docx,image/png,image/jpeg,image/webp"
                    multiple
                  >
                    <p className="ant-upload-drag-icon">📎</p>
                    <p className="ant-upload-text">点击或拖拽文件到这里</p>
                    <p className="ant-upload-hint">
                      图片：单张需小于 5M（上传后自动压缩），一次最多 9 张<br />
                      Word：仅 .docx（.doc 请先另存为 .docx），一次 1 个，文中插图一并解析<br />
                      图片与 Word 文档请分开提交
                    </p>
                  </Dragger>
                </Form.Item>
                <Form.Item name="note" label="备注（可选，会一并交给 AI 参考）"><Input maxLength={200} /></Form.Item>
                <Button type="primary" htmlType="submit" loading={submitting}>🚀 提交并让 AI 解析</Button>
              </Form>
            )},
          ]} />
        </Card>

        <Card title="我的上传" style={{ marginTop: 16 }}>
          {uploads.length === 0 ? (
            <p style={{ color: '#c0c4cc', textAlign: 'center' }}>还没有上传过</p>
          ) : (
            uploads.map(u => (
              <Card key={u.id} size="small" style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, wordBreak: 'break-all', flex: 1 }}>
                    {uploadSourceLabel(u)}
                  </span>
                  {statusTag(u.status)}
                </div>
                {u.errorMsg && <Alert type="error" message={u.errorMsg} style={{ marginTop: 8 }} closable />}
                {u.rejectReason && <Alert type="error" message={`驳回理由：${u.rejectReason}`} style={{ marginTop: 8 }} closable />}
                {u.items?.length > 0 && (
                  <div style={{ marginTop: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {u.items.map((it: any) => (
                      <Tooltip key={it.id} title="点开阅读 AI 拆解出的这篇内容（审核通过前也只有你能看到）">
                        <Tag style={{ cursor: 'pointer' }} onClick={() => setReading(it)}>{it.title}</Tag>
                      </Tooltip>
                    ))}
                  </div>
                )}
              </Card>
            ))
          )}
        </Card>
      </div>

      <Card title="我的贡献" style={isMobile ? { width: '100%' } : { width: 280, flexShrink: 0 }}>
        <Statistic title="累计贡献分" value={contrib.total} />
        <p style={{ color: '#909399', fontSize: 12, marginTop: 8 }}>
          近 90 天活跃 {activeDays} 天<br />
          上传入库 +8/篇 · 沉淀通过 +5 · 注解通过 +2
        </p>
      </Card>

      {/* 拆解条目阅读浮窗：AI 拆解保存后立即可读（审核通过前仅自己可见），全部历史见「📋 我的提交」页 */}
      <UploadItemReadDrawer item={reading} onClose={() => setReading(null)} />
    </div>
  );
}
