import { Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './components/AppLayout';
import GraphPage from './pages/graph';
import PathsPage from './pages/paths';
import UploadPage from './pages/upload';
import MyUploadsPage from './pages/my-uploads';
import LibraryPage from './pages/library';
import RecentPage from './pages/recent';
import AdminPage from './pages/admin';

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
