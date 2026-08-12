import { forwardRef } from 'react'
import { SHARE_VARIATION_MAP } from './variations/index.ts'

interface GigShareCardProps {
  variation?: string
  format?: string
  [key: string]: unknown
}

const GigShareCard = forwardRef<HTMLDivElement, GigShareCardProps>(function GigShareCard(
  { variation = 'vintage', format = 'square', ...rest },
  ref,
) {
  const v = SHARE_VARIATION_MAP[String(variation)] ?? SHARE_VARIATION_MAP.vintage
  const Layout = format === 'story' ? v.Story : v.Square
  return (
    <div ref={ref}>
      <Layout format={format} {...rest} />
    </div>
  )
})

export default GigShareCard
