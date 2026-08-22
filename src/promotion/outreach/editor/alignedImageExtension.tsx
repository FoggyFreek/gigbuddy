import type { EmailNode } from '@react-email/editor/core'
import { Column, Img, Link, Row } from 'react-email'

/**
 * The library's own image renderer ignores the node's `alignment` attribute
 * entirely, so the exported HTML never reflects it. Mirror how the Button
 * node aligns itself (wrap in Row/Column and use the `align` HTML attribute)
 * so alignment survives even in email clients that strip CSS.
 */
export function withImageAlignment(imageExtension: EmailNode<Record<string, never>, Record<string, never>>) {
  return imageExtension.extend<Record<string, never>, Record<string, never>>({
    renderToReactEmail: ({ node, style }) => {
      const image = (
        <Img
          alt={node.attrs?.alt ?? ''}
          height={node.attrs?.height === 'auto' ? undefined : node.attrs?.height}
          src={node.attrs?.src ?? ''}
          style={style}
          width={node.attrs?.width === 'auto' ? undefined : node.attrs?.width}
        />
      )
      const content = node.attrs?.href ? <Link href={node.attrs.href}>{image}</Link> : image
      return (
        <Row>
          <Column align={node.attrs?.alignment ?? 'center'}>{content}</Column>
        </Row>
      )
    },
  })
}
