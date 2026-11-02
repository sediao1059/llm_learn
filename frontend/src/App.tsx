import { lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './components/AppLayout';
import PageLoading from './components/PageLoading';

// 路由级懒加载：首屏只加载当前页代码（管理页 13 个页签、学习路线、上传页等不再打进首包）
const GraphPage = lazy(() => import('./pages/graph'));
const LibraryPage = lazy(() => import('./pages/library'));
const RecentPage = lazy(() => import('./pages/recent'));
const PathsPage = lazy(() => import('./pages/paths'));
const UploadPage = lazy(() => import('./pages/upload'));
const MyUploadsPage = lazy(() => import('./pages/my-uploads'));
const AdminPage = lazy(() => import('./pages/admin'));

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<GraphPage />} />
        <Route path="/library" element={<LibraryPage />} />
        <Route path="/recent" element={<RecentPage />} />
        <Route path="/paths" element={<PathsPage />} />
        <Route path="/upload" element={<UploadPage />} />
        <Route path="/mine" element={<MyUploadsPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
