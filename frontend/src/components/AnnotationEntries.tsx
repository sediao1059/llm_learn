/**
 * 正文里锚不上的注解兜底条目：整篇注解（无锚文本）、定位失败（正文已改/内容重新生成过）。
 * 以正文末尾合成条目呈现（点开即读），不罗列注解答案。
 * 面试题类型不在其列（由各抽屉自行处理懒加载入口）。
 */
export default function AnnotationEntries({ annotations, content, onRead }: {
  annotations: any[];
  content: string;
  onRead: (anno: any) => void;
}) {
  const unanchored = annotations.filter((a: any) =>
    a.type !== 'interview' && (a.type === 'document' || !a.anchorText || !content.includes(a.anchorText)));
  if (!unanchored.length) return null;
  return (
    <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {unanchored.map((a: any) => (
        <div key={a.id} className="anno-entry" onClick={() => onRead(a)}>
          {a.type === 'document'
            ? `💬 整篇注解 · ${(a.question || '').slice(0, 24) || '点击阅读'}`
            : `💬 「${(a.anchorText || '').slice(0, 24)}」· 正文未定位，点击阅读`}
        </div>
      ))}
    </div>
  );
}
