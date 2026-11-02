import { Spin } from 'antd';

/** 懒加载页面切换时的占位（挂在 AppLayout 内容区，顶栏保留不闪烁） */
export default function PageLoading() {
  return (
    <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Spin size="large" />
    </div>
  );
}
