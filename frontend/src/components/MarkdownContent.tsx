import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** 通用 Markdown 渲染组件：标题/列表/代码块/表格/引用，GFM 语法支持 */
export default function MarkdownContent({ content, fontSize }: { content: string; fontSize?: number }) {
  if (!content) return null;
  return (
    <div
      className="md-content"
      style={{
        fontSize: fontSize || 14,
        lineHeight: 1.8,
        color: '#333',
        wordBreak: 'break-word',
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h2 style={{ fontSize: '1.4em', fontWeight: 700, borderBottom: '1px solid #e8e8e8', paddingBottom: 6, marginTop: 20 }}>{children}</h2>,
          h2: ({ children }) => <h3 style={{ fontSize: '1.25em', fontWeight: 700, marginTop: 18, marginBottom: 8 }}>{children}</h3>,
          h3: ({ children }) => <h4 style={{ fontSize: '1.1em', fontWeight: 600, marginTop: 14, marginBottom: 6, color: '#444' }}>{children}</h4>,
          h4: ({ children }) => <h5 style={{ fontSize: '1em', fontWeight: 600, marginTop: 12, color: '#555' }}>{children}</h5>,
          p: ({ children }) => <p style={{ margin: '8px 0' }}>{children}</p>,
          ul: ({ children }) => <ul style={{ paddingLeft: 22, margin: '6px 0' }}>{children}</ul>,
          ol: ({ children }) => <ol style={{ paddingLeft: 22, margin: '6px 0' }}>{children}</ol>,
          li: ({ children }) => <li style={{ margin: '3px 0' }}>{children}</li>,
          strong: ({ children }) => <strong style={{ fontWeight: 700, color: '#1a1a1a' }}>{children}</strong>,
          blockquote: ({ children }) => (
            <blockquote style={{
              margin: '10px 0', padding: '8px 14px',
              borderLeft: '3px solid #1677ff', background: '#f6f8fa',
              borderRadius: '0 8px 8px 0', color: '#555',
            }}>{children}</blockquote>
          ),
          code: ({ inline, className, children, ...props }: any) => {
            if (inline) {
              return (
                <code
                  style={{
                    fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
                    fontSize: '0.88em', background: '#f0f2f5',
                    padding: '2px 6px', borderRadius: 4,
                  }}
                  {...props}
                >{children}</code>
              );
            }
            return (
              <code
                className={className}
                style={{
                  fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
                  fontSize: '0.85em',
                }}
                {...props}
              >{children}</code>
            );
          },
          pre: ({ children }) => (
            <pre style={{
              background: '#f6f8fa', border: '1px solid #e8e8e8',
              borderRadius: 8, padding: '12px 14px', overflowX: 'auto',
              margin: '10px 0', lineHeight: 1.6,
            }}>{children}</pre>
          ),
          table: ({ children }) => (
            <table style={{
              borderCollapse: 'collapse', width: '100%',
              margin: '10px 0', fontSize: '0.92em',
              display: 'block', overflowX: 'auto',
            }}>{children}</table>
          ),
          th: ({ children }) => (
            <th style={{
              border: '1px solid #e8e8e8', padding: '6px 10px',
              background: '#f6f8fa', textAlign: 'left', fontWeight: 600,
            }}>{children}</th>
          ),
          td: ({ children }) => (
            <td style={{ border: '1px solid #e8e8e8', padding: '6px 10px', textAlign: 'left' }}>{children}</td>
          ),
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer"
              style={{ color: '#1677ff', textDecoration: 'none' }}>{children}</a>
          ),
          hr: () => <hr style={{ border: 'none', borderTop: '1px solid #e8e8e8', margin: '14px 0' }} />,
          img: ({ src, alt }) => (
            <img src={src} alt={alt || ''} loading="lazy"
              style={{ maxWidth: '100%', borderRadius: 8, margin: '8px 0' }} />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
