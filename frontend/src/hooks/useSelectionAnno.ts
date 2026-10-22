import { useState, useEffect, useCallback, RefObject } from 'react';

/**
 * 划词选区检测：在指定容器内选中正文文字（2~1000 字）后，
 * 返回选区位置供「💡 解答」浮动按钮紧贴选区上方显示。
 * 不要求登录也能选中（打开注解弹窗时由调用方校验登录）。
 */
export default function useSelectionAnno(contentRef: RefObject<HTMLElement | null>) {
  const [anchorText, setAnchorText] = useState('');
  const [selectionPos, setSelectionPos] = useState<{ x: number; y: number } | null>(null);

  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) { setSelectionPos(null); return; }
    const text = sel.toString().trim();
    if (!text || text.length < 2 || text.length > 1000) { setSelectionPos(null); return; }
    const range = sel.getRangeAt(0);
    const container = contentRef.current;
    if (!container || !container.contains(range.commonAncestorContainer)) { setSelectionPos(null); return; }
    const rect = range.getBoundingClientRect();
    setAnchorText(text);
    setSelectionPos({ x: rect.left + rect.width / 2, y: rect.top });
  }, [contentRef]);

  // 全局 mousedown 关闭浮动按钮（点按钮本身除外）
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.anno-float-btn')) setSelectionPos(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return { anchorText, selectionPos, setSelectionPos, handleMouseUp };
}
