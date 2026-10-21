import { useEffect, useState, useRef } from 'react';
import { Card, Row, Col, Statistic, Table, Spin } from 'antd';
import * as echarts from 'echarts';

const headers = () => ({
  Authorization: `Bearer ${localStorage.getItem('llm_learn_token')}`,
});

export default function AnalyticsTab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const chartRef = useRef<HTMLDivElement>(null);
  const pieRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    fetch('/api/admin/analytics', { headers: headers() })
      .then(r => r.json()).then(d => setData(d))
      .finally(() => setLoading(false));
  }, []);

  // 折线图：每日活跃度
  useEffect(() => {
    if (!data?.dailyActivity?.length || !chartRef.current) return;
    const chart = echarts.init(chartRef.current);
    const days = data.dailyActivity;
    chart.setOption({
      tooltip: { trigger: 'axis' },
      legend: { data: ['对话次数', 'Token 消耗', '注释数'], bottom: 0 },
      grid: { top: 20, left: 50, right: 50, bottom: 40 },
      xAxis: { type: 'category', data: days.map((d: any) => d.date.slice(5)) },
      yAxis: [
        { type: 'value', name: '次数' },
        { type: 'value', name: 'Token', position: 'right' },
      ],
      series: [
        { name: '对话次数', type: 'line', smooth: true, data: days.map((d: any) => d.messages),
          itemStyle: { color: '#1677ff' } },
        { name: 'Token 消耗', type: 'line', smooth: true, yAxisIndex: 1,
          data: days.map((d: any) => d.tokens), itemStyle: { color: '#faad14' } },
        { name: '注释数', type: 'line', smooth: true, data: days.map((d: any) => d.annotations || 0),
          itemStyle: { color: '#52c41a' } },
      ],
    });
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); chart.dispose(); };
  }, [data]);

  // 饼图：知识分类分布
  useEffect(() => {
    if (!data?.categoryDistribution?.length || !pieRef.current) return;
    const chart = echarts.init(pieRef.current);
    chart.setOption({
      tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
      series: [{
        type: 'pie', radius: ['40%', '70%'],
        label: { show: true, formatter: '{b}\n{c} 个' },
        data: data.categoryDistribution.map((c: any) => ({ name: c.name, value: c.count })),
      }],
    });
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); chart.dispose(); };
  }, [data]);

  if (loading) return <div style={{ textAlign: 'center', paddingTop: 100 }}><Spin size="large" /></div>;
  if (!data) return null;

  const ov = data.overview || {};

  return (
    <div style={{ padding: '0 4px' }}>
      {/* 概览卡片 */}
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col span={4}><Card size="small"><Statistic title="总用户" value={ov.totalUsers || 0} /></Card></Col>
        <Col span={4}><Card size="small"><Statistic title="活跃用户(7天)" value={ov.activeUsers7d || 0} valueStyle={{ color: '#52c41a' }} /></Card></Col>
        <Col span={4}><Card size="small"><Statistic title="知识点" value={(ov.totalNotes || 0) + (ov.totalAiNodes || 0)} suffix={` (${ov.totalAiNodes || 0} AI)`} /></Card></Col>
        <Col span={4}><Card size="small"><Statistic title="对话总数" value={ov.totalMessages || 0} /></Card></Col>
        <Col span={4}><Card size="small"><Statistic title="注释" value={ov.totalAnnotations || 0} /></Card></Col>
        <Col span={4}><Card size="small"><Statistic title="Token 总量" value={ov.totalTokens || 0} valueStyle={{ color: '#faad14' }} /></Card></Col>
      </Row>

      {/* 每日活跃度折线图 */}
      <Card title="📈 每日活跃度（近 30 天）" size="small" style={{ marginBottom: 16 }}>
        <div ref={chartRef} style={{ height: 280 }} />
      </Card>

      <Row gutter={16}>
        {/* Top 活跃用户 */}
        <Col span={12}>
          <Card title="🏆 Top 活跃用户" size="small">
            <Table
              dataSource={data.topUsers || []} rowKey="username" size="small"
              pagination={false}
              columns={[
                { title: '#', width: 40, render: (_: any, __: any, i: number) => i + 1 },
                { title: '用户', dataIndex: 'username' },
                { title: '对话', dataIndex: 'chats', width: 70 },
                { title: 'Token', dataIndex: 'tokens', width: 90, render: (v: number) => v?.toLocaleString() },
                { title: '最后活跃', dataIndex: 'lastActive', width: 140,
                  render: (v: string) => v ? new Date(v).toLocaleString('zh-CN', { hour12: false }).slice(5, 16) : '—' },
              ]}
            />
          </Card>
        </Col>

        {/* 知识分类分布 */}
        <Col span={12}>
          <Card title="📊 知识分类分布" size="small">
            <div ref={pieRef} style={{ height: 280 }} />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
