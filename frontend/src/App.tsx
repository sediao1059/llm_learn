import { Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './components/AppLayout';
import GraphPage from './pages/graph';
import PathsPage from './pages/paths';
import UploadPage from './pages/upload';
import AdminPage from './pages/admin';

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<GraphPage />} />
        <Route path="/paths" element={<PathsPage />} />
        <Route path="/upload" element={<UploadPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
