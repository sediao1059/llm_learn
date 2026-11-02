// ECharts 按需引入（全量 import 'echarts' 约 1MB，只用力导向图 / 折线 / 饼图可省一大半）。
// 全站统一从这里引 echarts，图表与组件在这里集中注册。
import * as echarts from 'echarts/core';
import { GraphChart, LineChart, PieChart } from 'echarts/charts';
import { TooltipComponent, LegendComponent, GridComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  GraphChart, LineChart, PieChart,
  TooltipComponent, LegendComponent, GridComponent,
  CanvasRenderer,
]);

export default echarts;
export type { EChartsType } from 'echarts/core';
