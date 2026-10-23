import { Grid } from 'antd';

/**
 * 响应式断点（手机 / iPad 适配）：
 * - isMobile：视口 < 768px（手机）——Drawer 全屏、双栏改单列、筛选面板纵向堆叠
 * - isPad：768px ≤ 视口 < 1024px（iPad 竖屏为主）——顶栏折叠为汉堡菜单 + 图标按钮
 * - ≥ 1024px（桌面 / iPad 横屏）两者均为 false，保持原布局
 * 基于 antd Grid.useBreakpoint（监听窗口 resize，无新增依赖）
 */
export function useResponsive() {
  const bp = Grid.useBreakpoint();
  return {
    isMobile: !bp.md,
    isPad: !!bp.md && !bp.lg,
  };
}
