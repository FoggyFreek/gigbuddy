import { forwardRef } from 'react'
import PropTypes from 'prop-types'
import { SHARE_VARIATION_MAP } from './variations/index.js'

const GigShareCard = forwardRef(function GigShareCard(
  { variation = 'vintage', format = 'square', ...rest },
  ref,
) {
  const v = SHARE_VARIATION_MAP[variation] ?? SHARE_VARIATION_MAP.vintage
  const Layout = format === 'story' ? v.Story : v.Square
  return (
    <div ref={ref}>
      <Layout format={format} {...rest} />
    </div>
  )
})

GigShareCard.propTypes = {
  variation: PropTypes.string,
  format: PropTypes.string,
}

export default GigShareCard
