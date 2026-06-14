import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Check, Copy } from 'lucide-react'

// Optional custom style additions for markdown wrapper
import './MarkdownRenderer.css'

function CodeCopyButton({ text }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback
      const textarea = document.createElement('textarea')
      textarea.value = text
      document.body.appendChild(textarea)
      textarea.select()
      try {
        document.execCommand('copy')
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch {
        // Ignore
      }
      document.body.removeChild(textarea)
    }
  }

  return (
    <button
      onClick={handleCopy}
      title={copied ? 'Copied!' : 'Copy code'}
      className="code-copy-btn"
      style={{
        position: 'absolute',
        top: '8px',
        right: '8px',
        background: 'rgba(255, 255, 255, 0.1)',
        border: 'none',
        borderRadius: '4px',
        padding: '4px',
        color: 'var(--color-text-secondary, #ccc)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'background 0.2s',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)')}
    >
      {copied ? <Check size={14} style={{ color: 'var(--color-success, #22c55e)' }} /> : <Copy size={14} />}
    </button>
  )
}

export default function MarkdownRenderer({ content, className = '' }) {
  if (!content) return null

  return (
    <div className={`markdown-renderer ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          pre: (props) => {
            const rest = { ...props };
            delete rest.node;
            return <div className="code-block-wrapper" style={{ position: 'relative', margin: '1em 0' }}><pre style={{ margin: 0, padding: 0 }} {...rest} /></div>
          },
          code(props) {
            const { className, children, node, ...rest } = props;
            const match = /language-(\w+)/.exec(className || '')
            const codeString = String(children).replace(/\n$/, '')
            
            if (match) {
              return (
                <div style={{ position: 'relative', margin: '1em 0' }}>
                  <CodeCopyButton text={codeString} />
                  <div data-testid="markdown-code">
                    <SyntaxHighlighter
                      {...rest}
                      style={vscDarkPlus}
                      language={match[1]}
                      PreTag="div"
                      customStyle={{
                        margin: 0,
                        borderRadius: 'var(--radius-md, 8px)',
                        padding: '1em',
                        fontSize: '0.9em',
                      }}
                    >
                      {codeString}
                    </SyntaxHighlighter>
                  </div>
                </div>
              )
            }
            
            return (
              <code data-testid="markdown-code" className={className} {...rest} style={{ 
                background: 'var(--color-bg-tertiary, rgba(0,0,0,0.05))',
                padding: '0.2em 0.4em',
                borderRadius: '3px',
                fontSize: '0.85em',
                fontFamily: 'monospace'
              }}>
                {children}
              </code>
            )
          },
          strong: (props) => { const rest = { ...props }; delete rest.node; return <strong data-testid="markdown-bold" style={{ fontWeight: 600 }} {...rest} /> },
          h3: (props) => { const rest = { ...props }; delete rest.node; return <h3 data-testid="markdown-h3" style={{ marginTop: '1.5em', marginBottom: '0.5em', fontSize: '1.2em' }} {...rest} /> },
          table: (props) => {
            const rest = { ...props };
            delete rest.node;
            return (
              <div style={{ overflowX: 'auto', margin: '1em 0' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }} {...rest} />
              </div>
            )
          },
          th: (props) => { const rest = { ...props }; delete rest.node; return <th style={{ borderBottom: '2px solid var(--color-border)', padding: '8px', textAlign: 'left' }} {...rest} /> },
          td: (props) => { const rest = { ...props }; delete rest.node; return <td style={{ borderBottom: '1px solid var(--color-border)', padding: '8px' }} {...rest} /> },
          // Use <div> instead of <p> to prevent invalid nesting when code blocks appear inside paragraphs
          p: (props) => { const rest = { ...props }; delete rest.node; return <div style={{ marginBottom: '0.75em', lineHeight: '1.7' }} {...rest} /> },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
