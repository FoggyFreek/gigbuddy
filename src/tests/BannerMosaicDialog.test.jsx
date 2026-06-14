import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it, vi } from 'vitest'
import theme from '../theme.ts'

vi.mock('../utils/shareCard.ts', async (importOriginal) => ({
  ...(await importOriginal()),
  renderNodeToBlob: vi.fn().mockResolvedValue(new Blob(['img'], { type: 'image/png' })),
  downloadBlob: vi.fn(),
  copyBlobToClipboard: vi.fn().mockResolvedValue(undefined),
}))

import BannerMosaicDialog from '../components/BannerMosaicDialog.tsx'

function wrap(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

const GIGS_WITH_BANNERS = [
  { id: 1, event_date: '2024-03-10', banner_path: 'tenants/1/gig-banners/a.jpg', status: 'confirmed' },
  { id: 2, event_date: '2024-07-22', banner_path: 'tenants/1/gig-banners/b.jpg', status: 'announced' },
  { id: 3, event_date: '2025-01-15', banner_path: 'tenants/1/gig-banners/c.jpg', status: 'confirmed' },
]

const GIGS_NO_BANNERS = [
  { id: 4, event_date: '2025-05-01', banner_path: null, status: 'confirmed' },
  { id: 5, event_date: '2025-08-20', banner_path: null, status: 'announced' },
]

describe('BannerMosaicDialog', () => {
  it('renders year toggles only for years that have banners', () => {
    wrap(<BannerMosaicDialog open gigs={GIGS_WITH_BANNERS} onClose={() => {}} />)

    expect(screen.getByRole('button', { name: '2024' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '2025' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /all time/i })).toBeInTheDocument()
  })

  it('does not show year toggles for years without banners', () => {
    const gigs = [
      ...GIGS_WITH_BANNERS,
      { id: 10, event_date: '2023-06-01', banner_path: null, status: 'confirmed' },
    ]
    wrap(<BannerMosaicDialog open gigs={gigs} onClose={() => {}} />)

    expect(screen.queryByRole('button', { name: '2023' })).not.toBeInTheDocument()
  })

  it('always shows All time toggle', () => {
    wrap(<BannerMosaicDialog open gigs={[]} onClose={() => {}} />)
    expect(screen.getByRole('button', { name: /all time/i })).toBeInTheDocument()
  })

  it('shows empty state and disables download when no gigs have banners', () => {
    wrap(<BannerMosaicDialog open gigs={GIGS_NO_BANNERS} onClose={() => {}} />)

    expect(screen.getByText(/no gig banners/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /download png/i })).toBeDisabled()
  })

  it('filters to selected year and shows empty state when none match', async () => {
    const user = userEvent.setup()
    wrap(<BannerMosaicDialog open gigs={GIGS_WITH_BANNERS} onClose={() => {}} />)

    await user.click(screen.getByRole('button', { name: '2024' }))

    expect(screen.getByText(/2 banners/i)).toBeInTheDocument()
  })

  it('shows correct count for all time', () => {
    wrap(<BannerMosaicDialog open gigs={GIGS_WITH_BANNERS} onClose={() => {}} />)

    expect(screen.getByText(/3 banners/i)).toBeInTheDocument()
  })

  it('download button is enabled when banners are present', () => {
    wrap(<BannerMosaicDialog open gigs={GIGS_WITH_BANNERS} onClose={() => {}} />)
    expect(screen.getByRole('button', { name: /download png/i })).toBeEnabled()
  })

  it('lets users choose the mosaic background color', async () => {
    const user = userEvent.setup()
    wrap(<BannerMosaicDialog open gigs={GIGS_WITH_BANNERS} onClose={() => {}} />)

    expect(screen.getByRole('button', { name: /background color black/i })).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('button', { name: /background color rust/i }))

    expect(screen.getByRole('button', { name: /background color rust/i })).toHaveAttribute('aria-pressed', 'true')
  })

  it('calls onClose when Close is clicked', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    wrap(<BannerMosaicDialog open gigs={GIGS_WITH_BANNERS} onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: /^close$/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
