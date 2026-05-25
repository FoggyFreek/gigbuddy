// Shared PropTypes for the share-card family. Centralised so the many
// Square/Story variations and the tour card declare contracts without
// duplicating large prop blocks (see issue #56).
import PropTypes from 'prop-types'
import { gigShape } from './shared.js'

export { gigShape }

export const socialsProp = PropTypes.oneOfType([PropTypes.array, PropTypes.object])
export const panProp = PropTypes.oneOfType([PropTypes.number, PropTypes.object])
export const stickerProp = PropTypes.oneOfType([PropTypes.string, PropTypes.object])

// Canonical prop set passed to every single-gig Square/Story variation layout.
export const shareLayoutPropTypes = {
  gig: gigShape,
  photoSrc: PropTypes.string,
  pan: panProp,
  zoom: PropTypes.number,
  accent: PropTypes.string,
  socials: socialsProp,
  sticker: stickerProp,
  stickerPosition: PropTypes.string,
  logoSrc: PropTypes.string,
  bannerSrc: PropTypes.string,
  bandName: PropTypes.string,
  showLogo: PropTypes.bool,
  invertLogo: PropTypes.bool,
  format: PropTypes.string,
}

// The tour card renders a list of gigs rather than a single gig.
export const tourLayoutPropTypes = {
  gigs: PropTypes.arrayOf(gigShape),
  photoSrc: PropTypes.string,
  photoOpacity: PropTypes.number,
  zoom: PropTypes.number,
  pan: panProp,
  accent: PropTypes.string,
  year: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  today: PropTypes.string,
  socials: socialsProp,
  logoSrc: PropTypes.string,
  showBanners: PropTypes.bool,
  format: PropTypes.string,
}
