import { Component, type ReactNode } from "react"
import remarkBreaks from "remark-breaks"
import remarkGfm from "remark-gfm"
import { Streamdown, type StreamdownProps } from "streamdown"
import { REVIEWED_MARKDOWN_REHYPE_PLUGINS } from "../lib/security/renderer-html-policy"

/**
 * The single app-owned Streamdown wrapper (design D2). Both the static and the
 * streaming chat markdown mounts render through it so their remark/rehype
 * configuration cannot drift:
 *
 * - remark: GFM + breaks (parity with the pre-hardening app chain);
 * - rehype: the explicit reviewed chain owned by `renderer-html-policy.ts`
 *   (replaces Streamdown's default chain at pinned 2.1.0);
 * - components: callers must supply `code` and `pre` overrides, which keep
 *   Streamdown's built-in Mermaid renderer dormant;
 * - an app-owned error boundary renders the source as escaped text when a
 *   parser or plugin throws, without unmounting the surrounding chat view.
 */

const REVIEWED_MARKDOWN_REMARK_PLUGINS: NonNullable<
  StreamdownProps["remarkPlugins"]
> = [remarkGfm, remarkBreaks]

type StreamdownComponents = NonNullable<StreamdownProps["components"]>

export type ReviewedMarkdownComponents = StreamdownComponents & {
  code: NonNullable<StreamdownComponents["code"]>
  pre: NonNullable<StreamdownComponents["pre"]>
}

interface MarkdownRenderBoundaryProps {
  source: string
  children: ReactNode
}

interface MarkdownRenderBoundaryState {
  failed: boolean
  source: string
}

/**
 * Contains a markdown pipeline failure. The fallback is React text, so the
 * untrusted source can never be interpreted as markup.
 */
export class MarkdownRenderBoundary extends Component<
  MarkdownRenderBoundaryProps,
  MarkdownRenderBoundaryState
> {
  state: MarkdownRenderBoundaryState = {
    failed: false,
    source: this.props.source,
  }

  static getDerivedStateFromError(): Partial<MarkdownRenderBoundaryState> {
    return { failed: true }
  }

  static getDerivedStateFromProps(
    props: MarkdownRenderBoundaryProps,
    state: MarkdownRenderBoundaryState,
  ): Partial<MarkdownRenderBoundaryState> | null {
    // New content (for example the next streamed chunk) gets a fresh attempt.
    return props.source === state.source
      ? null
      : { failed: false, source: props.source }
  }

  render() {
    if (this.state.failed) {
      return (
        <p
          className="whitespace-pre-wrap break-words"
          data-markdown-render-fallback=""
        >
          {this.props.source}
        </p>
      )
    }
    return this.props.children
  }
}

interface ReviewedStreamdownProps {
  source: string
  mode: "static" | "streaming"
  components: ReviewedMarkdownComponents
  isAnimating?: boolean
  parseIncompleteMarkdown?: boolean
}

export function ReviewedStreamdown({
  source,
  mode,
  components,
  isAnimating,
  parseIncompleteMarkdown,
}: ReviewedStreamdownProps) {
  return (
    <MarkdownRenderBoundary source={source}>
      <Streamdown
        mode={mode}
        components={components}
        remarkPlugins={REVIEWED_MARKDOWN_REMARK_PLUGINS}
        rehypePlugins={REVIEWED_MARKDOWN_REHYPE_PLUGINS}
        isAnimating={isAnimating}
        parseIncompleteMarkdown={parseIncompleteMarkdown}
        controls={false}
      >
        {source}
      </Streamdown>
    </MarkdownRenderBoundary>
  )
}
