import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import BannerMosaicCard from '../components/share/BannerMosaicCard.jsx'

const makeGigs = (count) => Array.from({ length: count }, (_, i) => ({
  id: i + 1,
  banner_path: `tenants/1/gig-banners/${i + 1}.jpg`,
}))

describe('BannerMosaicCard', () => {
  it('renders each banner once', () => {
    const { container } = render(<BannerMosaicCard gigs={makeGigs(9)} format="square" />)
    const imageSrcs = Array.from(container.querySelectorAll('img'), (img) => img.getAttribute('src'))

    expect(imageSrcs).toHaveLength(9)
    expect(new Set(imageSrcs)).toHaveProperty('size', 9)
  })

  it('does not duplicate banners when the layout leaves background space', () => {
    const gigs = makeGigs(3)
    const { container } = render(<BannerMosaicCard gigs={gigs} format="square" backgroundColor="#123456" />)
    const imageSrcs = Array.from(container.querySelectorAll('img'), (img) => img.getAttribute('src'))

    expect(imageSrcs).toHaveLength(gigs.length)
    expect(new Set(imageSrcs)).toHaveProperty('size', gigs.length)
    expect(container.firstChild).toHaveStyle({ background: '#123456' })
  })

  it('keeps a loaded banner at its natural aspect ratio', () => {
    const { container } = render(<BannerMosaicCard gigs={makeGigs(1)} format="square" />)
    const img = container.querySelector('img')

    Object.defineProperty(img, 'naturalWidth', { value: 1600, configurable: true })
    Object.defineProperty(img, 'naturalHeight', { value: 800, configurable: true })
    fireEvent.load(img)

    expect(img).toHaveStyle({ width: '1080px', height: '540px' })
  })
})
