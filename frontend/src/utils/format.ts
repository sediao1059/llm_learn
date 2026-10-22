/** 通用时间格式化：'2026-10-22T10:30:00' → '10-22 10:30'（省年份，紧凑展示） */
export function fmtShort(v?: string | Date | null): string {
  if (!v) return '—';
  const s = new Date(v).toLocaleString('zh-CN', { hour12: false });
  return s.slice(5, 16);
}
