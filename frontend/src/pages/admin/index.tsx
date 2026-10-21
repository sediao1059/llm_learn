import { Card, Tabs, Badge } from 'antd';
import UsersTab from './UsersTab';
import InvitesTab from './InvitesTab';
import ReviewsTab from './ReviewsTab';
import UploadsTab from './UploadsTab';
import InterviewTab from './InterviewTab';
import PathsTab from './PathsTab';
import JobsTab from './JobsTab';
import VersionsTab from './VersionsTab';
import AnalyticsTab from './AnalyticsTab';

export default function AdminPage() {
  return (
    <div style={{ padding: '12px 16px', maxWidth: 1280, margin: '0 auto' }}>
      <Card styles={{ body: { padding: '0 4px 8px' } }}>
        <Tabs
          defaultActiveKey="users"
          items={[
            { key: 'users', label: '用户管理', children: <UsersTab /> },
            { key: 'invites', label: '邀请码', children: <InvitesTab /> },
            { key: 'reviews', label: <span>沉淀审核</span>, children: <ReviewsTab /> },
            { key: 'uploads', label: '上传审核', children: <UploadsTab /> },
            { key: 'interview', label: '面试题', children: <InterviewTab /> },
            { key: 'paths', label: '学习路线', children: <PathsTab /> },
            { key: 'jobs', label: '定时任务', children: <JobsTab /> },
            { key: 'versions', label: '版本管理', children: <VersionsTab /> },
            { key: 'analytics', label: '📊 报表统计', children: <AnalyticsTab /> },
          ]}
        />
      </Card>
    </div>
  );
}
