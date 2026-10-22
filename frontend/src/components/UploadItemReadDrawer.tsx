import KnowledgeDrawer from './KnowledgeDrawer';

interface UploadItemReadDrawerProps {
  /** upload_items 条目（{ id, title, content, tags }），传 null 关闭 */
  item: any;
  onClose: () => void;
}

/**
 * 上传拆解条目阅读浮窗：审核通过前后，上传者本人都可随时点开阅读自己提交的内容。
 * 待入库内容不是图谱节点：以纯阅读模式打开（isLoggedIn=false），
 * 不启用收藏/足迹/划词注解/面试题等依赖真实节点 id 的功能，避免脏数据。
 */
export default function UploadItemReadDrawer({ item, onClose }: UploadItemReadDrawerProps) {
  return (
    <KnowledgeDrawer
      open={!!item}
      onClose={onClose}
      nodeId={`upload-item-${item?.id ?? ''}`}
      nodeData={item ? { title: item.title, content: item.content, tags: item.tags } : null}
      isLoggedIn={false}
      annotations={[]}
    />
  );
}
