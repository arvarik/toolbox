import { useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Check, Copy } from 'lucide-react'
import MermaidRenderer from './MermaidRenderer'
import SvgFigureRenderer from './SvgFigureRenderer'
import { preprocessMarkdown } from '../../utils/markdownPreprocess'

// Optional custom style additions for markdown wrapper
import './MarkdownRenderer.css'

function CodeCopyButton({ text }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async (e) => {
    e.stopPropagation()
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
      type="button"
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

export default function MarkdownRenderer({ content, className = '', paragraphClassName = '' }) {
  const processedContent = useMemo(
    () => (content ? preprocessMarkdown(String(content)) : ''),
    [content]
  )

  if (!content) return null

  return (
    <div className={`markdown-renderer ${className}`.trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          pre: (props) => {
            const { node, children, ...rest } = props
            const firstChild = node?.children?.[0]
            const childClassList = firstChild?.properties?.className
            const hasLanguageClass = Array.isArray(childClassList)
              ? childClassList.some((c) => typeof c === 'string' && c.startsWith('language-'))
              : typeof childClassList === 'string' && childClassList.includes('language-')

            if (hasLanguageClass) {
              return <>{children}</>
            }

            return (
              <div className="code-block-wrapper" style={{ position: 'relative', margin: '1em 0' }}>
                <pre style={{ margin: 0, padding: 0 }} {...rest}>
                  {children}
                </pre>
              </div>
            )
          },
          code(props) {
            const { className: codeClassName, children, node: _node, ...rest } = props
            const match = /language-([\w-]+)/.exec(codeClassName || '')
            const codeString = String(children).replace(/\n$/, '')
            const lang = match ? match[1].toLowerCase() : ''

            if (lang === 'mermaid') {
              return <MermaidRenderer chart={codeString} />
            }

            if (lang === 'svg') {
              return <SvgFigureRenderer code={codeString} />
            }

            if (match) {
              return (
                <div style={{ position: 'relative', margin: '1em 0' }}>
                  <CodeCopyButton text={codeString} />
                  <div data-testid="markdown-code">
                    <SyntaxHighlighter
                      {...rest}
                      style={vscDarkPlus}
                      language={lang}
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
              <code
                data-testid="markdown-code"
                className={codeClassName}
                {...rest}
                style={{
                  background: 'var(--color-bg-tertiary, rgba(0,0,0,0.05))',
                  padding: '0.2em 0.4em',
                  borderRadius: '3px',
                  fontSize: '0.85em',
                  fontFamily: 'monospace',
                }}
              >
                {children}
              </code>
            )
          },
          strong: (props) => {
            const rest = { ...props }
            delete rest.node
            return <strong data-testid="markdown-bold" style={{ fontWeight: 600 }} {...rest} />
          },
          h1: (props) => {
            const rest = { ...props }
            delete rest.node
            return (
              <h1
                data-testid="markdown-h1"
                style={{
                  marginTop: '1.5em',
                  marginBottom: '0.75em',
                  fontSize: '1.5em',
                  fontWeight: 700,
                  borderBottom: '1px solid var(--color-border, #333)',
                  paddingBottom: '0.3em',
                }}
                {...rest}
              />
            )
          },
          h2: (props) => {
            const rest = { ...props }
            delete rest.node
            return (
              <h2
                data-testid="markdown-h2"
                style={{ marginTop: '1.5em', marginBottom: '0.5em', fontSize: '1.3em', fontWeight: 600 }}
                {...rest}
              />
            )
          },
          h3: (props) => {
            const rest = { ...props }
            delete rest.node
            return (
              <h3
                data-testid="markdown-h3"
                style={{ marginTop: '1.5em', marginBottom: '0.5em', fontSize: '1.2em' }}
                {...rest}
              />
            )
          },
          h4: (props) => {
            const rest = { ...props }
            delete rest.node
            return (
              <h4
                data-testid="markdown-h4"
                style={{ marginTop: '1.2em', marginBottom: '0.4em', fontSize: '1.05em', fontWeight: 600 }}
                {...rest}
              />
            )
          },
          table: (props) => {
            const rest = { ...props }
            delete rest.node
            return (
              <div style={{ overflowX: 'auto', margin: '1em 0' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }} {...rest} />
              </div>
            )
          },
          th: (props) => {
            const rest = { ...props }
            delete rest.node
            return <th style={{ borderBottom: '2px solid var(--color-border)', padding: '8px', textAlign: 'left' }} {...rest} />
          },
          td: (props) => {
            const rest = { ...props }
            delete rest.node
            return <td style={{ borderBottom: '1px solid var(--color-border)', padding: '8px' }} {...rest} />
          },
          p: (props) => {
            const rest = { ...props }
            delete rest.node
            const mergedClass = [paragraphClassName, rest.className].filter(Boolean).join(' ') || undefined
            return (
              <p
                {...rest}
                className={mergedClass}
                style={paragraphClassName ? undefined : { marginBottom: '0.75em', lineHeight: '1.7' }}
              />
            )
          },
          blockquote: (props) => {
            const rest = { ...props }
            delete rest.node
            return (
              <blockquote
                style={{
                  borderLeft: '3px solid var(--color-accent, #6366f1)',
                  paddingLeft: '1em',
                  margin: '1em 0',
                  color: 'var(--color-text-secondary)',
                  fontStyle: 'italic',
                }}
                {...rest}
              />
            )
          },
          hr: (props) => {
            const rest = { ...props }
            delete rest.node
            return <hr style={{ border: 'none', borderTop: '1px solid var(--color-border, #333)', margin: '1.5em 0' }} {...rest} />
          },
          li: (props) => {
            const rest = { ...props }
            delete rest.node
            return <li style={{ marginBottom: '0.3em', lineHeight: '1.7' }} {...rest} />
          },
        }}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  )
}
