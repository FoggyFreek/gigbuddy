import type { CSSProperties, ReactNode } from 'react'
import type { ShareFormat } from '../../../utils/shareCard.ts'

interface CardFrameProps {
  format: ShareFormat
  background?: string
  color?: string
  children?: ReactNode
  style?: CSSProperties
}

export default function CardFrame({ format, background, color, children, style }: CardFrameProps) {
  return (
    <div
      data-share-frame
      style={{
        position: 'relative',
        width: format.width,
        height: format.height,
        background,
        overflow: 'hidden',
        color,
        ...style,
      }}
    >
      {children}
    </div>
  )
}
