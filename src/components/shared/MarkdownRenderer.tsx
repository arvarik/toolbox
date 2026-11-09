import { useMemo, useState } from 'react'
import type { MouseEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import SyntaxHighlighter from 'react-syntax-highlighter/dist/esm/prism-light'
import vscDarkPlus from 'react-syntax-highlighter/dist/esm/styles/prism/vsc-dark-plus'
import langTypescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript'
import langTsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx'
import langJavascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript'
import langJsx from 'react-syntax-highlighter/dist/esm/languages/prism/jsx'
import langPython from 'react-syntax-highlighter/dist/esm/languages/prism/python'
import langSql from 'react-syntax-highlighter/dist/esm/languages/prism/sql'
import langBash from 'react-syntax-highlighter/dist/esm/languages/prism/bash'
import langJson from 'react-syntax-highlighter/dist/esm/languages/prism/json'
import langYaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml'
import langGo from 'react-syntax-highlighter/dist/esm/languages/prism/go'
import langRust from 'react-syntax-highlighter/dist/esm/languages/prism/rust'
import langJava from 'react-syntax-highlighter/dist/esm/languages/prism/java'
import langCpp from 'react-syntax-highlighter/dist/esm/languages/prism/cpp'
import langCss from 'react-syntax-highlighter/dist/esm/languages/prism/css'
import langMarkdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown'
import { Check, Copy } from 'lucide-react'
import MermaidRenderer from './MermaidRenderer'
import SvgFigureRenderer from './SvgFigureRenderer'
import { preprocessMarkdown } from '../../utils/markdownPreprocess'

import './MarkdownRenderer.css'

// Register 15 high-utility PrismLight languages instead of bundling all 300+ refractor grammars.
SyntaxHighlighter.registerLanguage('typescript', langTypescript)
SyntaxHighlighter.registerLanguage('tsx', langTsx)
SyntaxHighlighter.registerLanguage('javascript', langJavascript)
SyntaxHighlighter.registerLanguage('jsx', langJsx)
SyntaxHighlighter.registerLanguage('python', langPython)
SyntaxHighlighter.registerLanguage('sql', langSql)
SyntaxHighlighter.registerLanguage('bash', langBash)
SyntaxHighlighter.registerLanguage('json', langJson)
SyntaxHighlighter.registerLanguage('yaml', langYaml)
SyntaxHighlighter.registerLanguage('go', langGo)
SyntaxHighlighter.registerLanguage('rust', langRust)
SyntaxHighlighter.registerLanguage('java', langJava)
SyntaxHighlighter.registerLanguage('cpp', langCpp)
SyntaxHighlighter.registerLanguage('css', langCss)
SyntaxHighlighter.registerLanguage('markdown', langMarkdown)
SyntaxHighlighter.alias('bash', ['zsh'])
SyntaxHighlighter.alias('cpp', ['c++'])
SyntaxHighlighter.alias('rust', ['rs'])
SyntaxHighlighter.alias('go', ['golang'])

function CodeCopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
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
      onClick={(e) => void handleCopy(e)}
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
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'
      }}
    >
      {copied ? (
        <Check size={14} style={{ color: 'var(--color-success, #22c55e)' }} />
      ) : (
        <Copy size={14} />
      )}
    </button>
  )
}

export interface MarkdownRendererProps {
  content?: string | null
  className?: string
  paragraphClassName?: string
}

export default function MarkdownRenderer({
  content,
  className = '',
  paragraphClassName = '',
}: MarkdownRendererProps) {
  const processedContent = useMemo(
    () => (content ? preprocessMarkdown(String(content)) : ''),
    [content],
  )

  const components = useMemo<Components>(
    () => ({
      pre: ({ node, children, ...rest }) => {
        const firstChild = node?.children?.[0]
        const childClassList: unknown =
          firstChild && 'properties' in firstChild ? firstChild.properties?.className : undefined
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
      code: ({ className: codeClassName, children, node: _node, ref: _ref, ...rest }) => {
        const match = /language-([\w+-]+)/.exec(codeClassName || '')
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
      strong: ({ node: _node, ...rest }) => (
        <strong data-testid="markdown-bold" style={{ fontWeight: 600 }} {...rest} />
      ),
      h1: ({ node: _node, ...rest }) => (
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
      ),
      h2: ({ node: _node, ...rest }) => (
        <h2
          data-testid="markdown-h2"
          style={{ marginTop: '1.5em', marginBottom: '0.5em', fontSize: '1.3em', fontWeight: 600 }}
          {...rest}
        />
      ),
      h3: ({ node: _node, ...rest }) => (
        <h3
          data-testid="markdown-h3"
          style={{ marginTop: '1.5em', marginBottom: '0.5em', fontSize: '1.2em' }}
          {...rest}
        />
      ),
      h4: ({ node: _node, ...rest }) => (
        <h4
          data-testid="markdown-h4"
          style={{
            marginTop: '1.2em',
            marginBottom: '0.4em',
            fontSize: '1.05em',
            fontWeight: 600,
          }}
          {...rest}
        />
      ),
      table: ({ node: _node, ...rest }) => (
        <div style={{ overflowX: 'auto', margin: '1em 0' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }} {...rest} />
        </div>
      ),
      th: ({ node: _node, ...rest }) => (
        <th
          style={{
            borderBottom: '2px solid var(--color-border)',
            padding: '8px',
            textAlign: 'left',
          }}
          {...rest}
        />
      ),
      td: ({ node: _node, ...rest }) => (
        <td style={{ borderBottom: '1px solid var(--color-border)', padding: '8px' }} {...rest} />
      ),
      p: ({ node: _node, ...rest }) => {
        const mergedClass =
          [paragraphClassName, rest.className].filter(Boolean).join(' ') || undefined
        return (
          <p
            {...rest}
            className={mergedClass}
            style={paragraphClassName ? undefined : { marginBottom: '0.75em', lineHeight: '1.7' }}
          />
        )
      },
      blockquote: ({ node: _node, ...rest }) => (
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
      ),
      hr: ({ node: _node, ...rest }) => (
        <hr
          style={{
            border: 'none',
            borderTop: '1px solid var(--color-border, #333)',
            margin: '1.5em 0',
          }}
          {...rest}
        />
      ),
      li: ({ node: _node, ...rest }) => (
        <li style={{ marginBottom: '0.3em', lineHeight: '1.7' }} {...rest} />
      ),
    }),
    [paragraphClassName],
  )

  if (!content) return null

  return (
    <div className={`markdown-renderer ${className}`.trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={components}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  )
}
