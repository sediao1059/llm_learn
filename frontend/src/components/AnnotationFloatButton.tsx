/** 划词后紧贴选区上方 4px 的「💡 解答」浮动按钮 */
export default function AnnotationFloatButton({ pos, onClick }: {
  pos: { x: number; y: number } | null;
  onClick: () => void;
}) {
  if (!pos) return null;
  return (
    <button
      className="anno-float-btn"
      onClick={onClick}
      style={{
        position: 'fixed',
        left: Math.max(8, Math.min(pos.x - 34, window.innerWidth - 90)),
        top: pos.y - 32,
        zIndex: 1100,
        padding: '3px 10px', borderRadius: 6,
        background: '#1677ff', color: '#fff', border: 'none',
        cursor: 'pointer', fontSize: 12, fontWeight: 500,
        boxShadow: '0 2px 6px rgba(22,119,255,0.4)',
        transition: 'opacity 0.15s',
      }}
    >
      💡 解答
    </button>
  );
}
