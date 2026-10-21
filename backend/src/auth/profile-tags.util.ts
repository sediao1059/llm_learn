/** 画像校验与归一化（后端统一工具，与前端保持一致） */
export function normalizeProfileTags(raw: any): { level: string; focus: string[] } {
  const o = raw && typeof raw === 'object' ? raw : {};
  const level = o.level === 'expert' ? 'expert' : 'novice';
  const focus = Array.isArray(o.focus)
    ? [...new Set(o.focus.map((x: any) => String(x).trim().toLowerCase())
        .filter((x: string) => /^[a-z][a-z0-9_-]{0,20}$/.test(x)))].slice(0, 6) as string[]
    : [];
  return { level, focus };
}
