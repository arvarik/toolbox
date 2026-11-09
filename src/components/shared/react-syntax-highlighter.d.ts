declare module 'react-syntax-highlighter/dist/esm/prism-light' {
  import type { CSSProperties, ComponentType, JSX, ReactNode } from 'react'

  export interface SyntaxHighlighterProps {
    language?: string
    style?: Record<string, CSSProperties>
    customStyle?: CSSProperties
    PreTag?: keyof JSX.IntrinsicElements | ComponentType<Record<string, unknown>>
    CodeTag?: keyof JSX.IntrinsicElements | ComponentType<Record<string, unknown>>
    useInlineStyles?: boolean
    showLineNumbers?: boolean
    wrapLines?: boolean
    wrapLongLines?: boolean
    children?: ReactNode
    [key: string]: unknown
  }

  export type PrismLightComponent = ((props: SyntaxHighlighterProps) => JSX.Element | null) & {
    registerLanguage: (name: string, grammar: unknown) => void
    alias: (name: string, aliases: string | string[]) => void
  }

  const SyntaxHighlighter: PrismLightComponent
  export default SyntaxHighlighter
}

declare module 'react-syntax-highlighter/dist/esm/styles/prism/vsc-dark-plus' {
  import type { CSSProperties } from 'react'
  const vscDarkPlus: Record<string, CSSProperties>
  export default vscDarkPlus
}

declare module 'react-syntax-highlighter/dist/esm/languages/prism/*' {
  const grammar: unknown
  export default grammar
}
