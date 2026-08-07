import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthContext } from '../contexts/authContext.ts'
import { ProfileContext } from '../contexts/profileContext.ts'
import ProfilePage from '../pages/ProfilePage.tsx'
import theme from '../theme.ts'

vi.mock('../api/bandMembers.ts', () => ({
  listMembers: vi.fn().mockResolvedValue([]),
  createMember: vi.fn(),
  updateMember: vi.fn(),
  deleteMember: vi.fn(),
}))

vi.mock('../api/availability.ts', () => ({
  listAvailability: vi.fn().mockResolvedValue([]),
  createSlot: vi.fn(),
  updateSlot: vi.fn(),
  deleteSlot: vi.fn(),
  getAvailabilityOn: vi.fn(),
}))

vi.mock('../api/profile.ts', () => ({
  getProfile: vi.fn().mockResolvedValue({
    id: 1,
    band_name: 'The Testers',
    bio: 'We test things.',
    short_bio: 'We test things, briefly.',
    instagram_handle: 'thetesters',
    facebook_handle: '',
    tiktok_handle: '',
    youtube_handle: '',
    spotify_handle: '',
    bandsintown_artist_name: 'The Testers',
    bandsintown_artist_id: '12345',
    formal_name: '',
    address_street: '',
    address_postal_code: '',
    address_city: '',
    address_country: 'Netherlands',
    kvk_number: '',
    email: 'bookings@testers.example',
    phone: '+31 6 1234 5678',
    iban: '',
    tax_id: '',
    tax_percentage: 9,
    applies_kor: false,
    links: [
      { id: 10, label: 'EPK', url: 'https://drive.google.com/xyz', sort_order: 0 },
    ],
  }),
  updateProfile: vi.fn().mockResolvedValue({}),
  uploadLogo: vi.fn().mockResolvedValue({ logo_path: 'logo/test.jpg' }),
  uploadBanner: vi.fn().mockResolvedValue({ banner_path: 'profile-banner/test.jpg' }),
  uploadAvatar: vi.fn().mockResolvedValue({ avatar_path: 'avatar/test.jpg' }),
  uploadLogoDark: vi.fn().mockResolvedValue({ logo_dark_path: 'logo-dark/test.jpg' }),
  createLink: vi.fn().mockResolvedValue({ id: 11, label: 'Website', url: 'https://example.com', sort_order: 1 }),
  updateLink: vi.fn().mockResolvedValue({}),
  deleteLink: vi.fn().mockResolvedValue(null),
}))

vi.mock('../api/linkpage.ts', () => ({
  getLinkpageStatus: vi.fn().mockResolvedValue({ configured: true, publicUrl: 'https://link.test/alpha' }),
  createLinkpageHandoff: vi.fn(),
}))

vi.mock('../utils/compressImage.ts', () => ({
  compressLogo: vi.fn().mockImplementation((file) => {
    if (file.type === 'image/gif') throw new Error('File type not allowed')
    return Promise.resolve(file)
  }),
  compressBanner: vi.fn().mockImplementation((file) => Promise.resolve(file)),
  compressAvatar: vi.fn().mockImplementation((file) => Promise.resolve(file)),
}))

import { createLink, deleteLink, getProfile, updateProfile, uploadLogo } from '../api/profile.ts'
import { getLinkpageStatus } from '../api/linkpage.ts'
import { compressLogo } from '../utils/compressImage.ts'

function wrap(ui, { user, bandsintown = true } = {}) {
  const activeUser = user ?? {
    isSuperAdmin: false,
    activeTenantRole: 'contributor',
    activeTenantKind: 'band',
    permissions: ['app.view', 'planning.write', 'purchase.create'],
  }
  return render(
    <ThemeProvider theme={theme}>
      <AuthContext.Provider value={{ user: activeUser, logout: vi.fn() }}>
        <ProfileContext.Provider value={{
          bandName: '', setBandName: vi.fn(), accentColor: null, setAccentColor: vi.fn(),
          integrations: { shopify: true, bandsintown, mollie: true, resend: true },
          isIntegrationConfigured: (integration) => integration !== 'bandsintown' || bandsintown,
          setIntegrationConfigured: vi.fn(),
        }}>
          <MemoryRouter>{ui}</MemoryRouter>
        </ProfileContext.Provider>
      </AuthContext.Provider>
    </ThemeProvider>
  )
}

// A plan without the customization feature — the identity-card image upload
// buttons should become diamond upsell links while editing.
const lockedEntitlements = {
  planSlug: 'free',
  subscriptionStatus: null,
  locked: false,
  financeReadOnly: false,
  flags: {
    finance: false,
    integrations: false,
    customization: false,
    song_files: false,
    chordpro: false,
    public_promotion: false,
  },
  limits: { storage_mb: 100, members: 5, bands: 1 },
}

describe('ProfilePage', () => {
  beforeEach(() => {
    getProfile.mockClear()
    updateProfile.mockClear()
    uploadLogo.mockClear()
    compressLogo.mockClear()
    createLink.mockClear()
    deleteLink.mockClear()
    getLinkpageStatus.mockClear()
  })

  it('fetches and renders profile data', async () => {
    const user = userEvent.setup()
    wrap(<ProfilePage />)
    await waitFor(() => expect(getProfile).toHaveBeenCalled())
    // Band identity is in display mode by default; click Edit to reveal inputs
    const editButtons = await waitFor(() => screen.getAllByRole('button', { name: /^edit$/i }))
    await user.click(editButtons[0]) // Band identity edit button
    await waitFor(() => expect(screen.getByDisplayValue('The Testers')).toBeInTheDocument())
    expect(screen.getByDisplayValue('We test things.')).toBeInTheDocument()
    // Switch to Links tab to see the EPK link
    await user.click(screen.getByRole('tab', { name: /links/i }))
    expect(await screen.findByText('EPK')).toBeInTheDocument()
  })

  it('renders the short bio above the full bio and caps it at 150 characters', async () => {
    const user = userEvent.setup()
    wrap(<ProfilePage />)
    await waitFor(() => expect(getProfile).toHaveBeenCalled())
    const editButtons = await waitFor(() => screen.getAllByRole('button', { name: /^edit$/i }))
    await user.click(editButtons[0])

    const shortBio = await screen.findByLabelText(/^short bio$/i)
    const fullBio = screen.getByLabelText(/^full bio$/i)
    expect(shortBio).toHaveValue('We test things, briefly.')
    expect(fullBio).toHaveValue('We test things.')
    expect(shortBio.compareDocumentPosition(fullBio) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(shortBio).toHaveAttribute('maxlength', '150')
  })

  it('auto-saves band name edits', async () => {
    const user = userEvent.setup()
    wrap(<ProfilePage />)
    await waitFor(() => screen.getAllByRole('button', { name: /^edit$/i }))
    const editButtons = screen.getAllByRole('button', { name: /^edit$/i })
    await user.click(editButtons[0])

    const input = await waitFor(() => screen.getByDisplayValue('The Testers'))
    await user.type(input, '!')

    await waitFor(
      () => expect(updateProfile).toHaveBeenCalledWith(
        expect.objectContaining({ band_name: 'The Testers!' })
      ),
      { timeout: 2000 }
    )
  })

  it('adds a new link', async () => {
    const user = userEvent.setup()
    wrap(<ProfilePage />)
    await waitFor(() => expect(getProfile).toHaveBeenCalled())
    await user.click(screen.getByRole('tab', { name: /links/i }))
    await waitFor(() => screen.getByText('EPK'))

    const labelInputs = screen.getAllByLabelText(/^label$/i)
    const urlInputs = screen.getAllByLabelText(/^url$/i)
    // Last of each are the "new link" inputs
    await user.type(labelInputs[labelInputs.length - 1], 'Website')
    await user.type(urlInputs[urlInputs.length - 1], 'https://example.com')

    await user.click(screen.getByRole('button', { name: /add link/i }))

    await waitFor(() =>
      expect(createLink).toHaveBeenCalledWith({
        label: 'Website',
        url: 'https://example.com',
      })
    )
  })

  it('renders BandMembersSection', async () => {
    wrap(<ProfilePage />)
    await waitFor(() => expect(screen.getByText(/band members/i)).toBeInTheDocument())
  })

  it('shows a reader the profile without edit controls', async () => {
    const user = userEvent.setup()
    wrap(<ProfilePage />, {
      user: { isSuperAdmin: false, activeTenantRole: 'reader', permissions: ['app.view'] },
    })

    expect(await screen.findByText(/you have read-only access/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /links/i }))
    expect(await screen.findByText('EPK')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /delete link/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add link/i })).not.toBeInTheDocument()
    expect(updateProfile).not.toHaveBeenCalled()
  })

  it('deletes a link', async () => {
    const user = userEvent.setup()
    wrap(<ProfilePage />)
    await waitFor(() => expect(getProfile).toHaveBeenCalled())
    await user.click(await screen.findByRole('tab', { name: /links/i }))
    await waitFor(() => screen.getByText('EPK'))

    const deleteBtn = screen.getByRole('button', { name: /delete link/i })
    await user.click(deleteBtn)

    await waitFor(() => expect(deleteLink).toHaveBeenCalledWith(10))
  })

  it('shows Bandsintown artist name in socials section', async () => {
    wrap(<ProfilePage />)
    await waitFor(() => expect(getProfile).toHaveBeenCalled())
    const label = await screen.findByText(/Bandsintown artist name/i)
    expect(label.parentElement).toHaveTextContent('The Testers')
  })

  it('keeps the shared profile but omits band-only roster and promotion fields in a personal workspace', async () => {
    wrap(<ProfilePage />, {
      user: {
        isSuperAdmin: false,
        activeTenantRole: 'contributor',
        activeTenantKind: 'personal',
        permissions: ['app.view', 'planning.write', 'purchase.create'],
      },
    })
    await waitFor(() => expect(getProfile).toHaveBeenCalled())

    expect(screen.queryByText('Band members')).not.toBeInTheDocument()
    expect(screen.queryByText(/Bandsintown artist name/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Bandsintown artist ID/i)).not.toBeInTheDocument()
    expect(screen.getAllByAltText('Profile logo')).not.toHaveLength(0)
  })

  it('offers the link-page editor to a band admin', async () => {
    wrap(<ProfilePage />, {
      user: {
        isSuperAdmin: false,
        activeTenantRole: 'tenant_admin',
        activeTenantKind: 'band',
        permissions: ['app.view', 'planning.write'],
      },
    })
    expect(await screen.findByRole('button', { name: /edit link page/i })).toBeInTheDocument()
  })

  it('omits the link-page editor in a personal workspace — link pages are built for bands', async () => {
    wrap(<ProfilePage />, {
      user: {
        isSuperAdmin: false,
        activeTenantRole: 'tenant_admin',
        activeTenantKind: 'personal',
        permissions: ['app.view', 'planning.write'],
      },
    })
    await waitFor(() => expect(getProfile).toHaveBeenCalled())

    expect(screen.queryByRole('button', { name: /edit link page/i })).not.toBeInTheDocument()
    // Gated before render, so the workspace never even asks for link-page status.
    expect(getLinkpageStatus).not.toHaveBeenCalled()
  })

  it('keeps Bandsintown profile fields but hides the API fetch when the integration is not configured', async () => {
    const user = userEvent.setup()
    wrap(<ProfilePage />, { bandsintown: false })
    await waitFor(() => expect(getProfile).toHaveBeenCalled())

    expect(await screen.findByText(/Bandsintown artist name/i)).toBeInTheDocument()
    expect(screen.getByText(/Bandsintown artist ID/i)).toBeInTheDocument()

    const editButtons = await screen.findAllByRole('button', { name: /^edit$/i })
    await user.click(editButtons.at(-1))
    expect(screen.queryByRole('button', { name: /Fetch from Bandsintown/i })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Bandsintown artist name')).toBeInTheDocument()
    expect(screen.getByLabelText('Bandsintown artist ID')).toBeInTheDocument()
  })

  it('renders social edit helpers without invalid nested block elements', async () => {
    const user = userEvent.setup()
    wrap(<ProfilePage />)
    await waitFor(() => expect(getProfile).toHaveBeenCalled())

    const instagramLabel = await screen.findByText('Instagram')
    const editButtons = await screen.findAllByRole('button', { name: /^edit$/i })
    const socialEditButton = editButtons.find(
      (button) => instagramLabel.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING,
    )
    await user.click(socialEditButton)

    const instagramInput = await screen.findByLabelText('Instagram')
    const helperId = instagramInput.getAttribute('aria-describedby')
    expect(helperId).toBeTruthy()
    expect(document.getElementById(helperId).querySelector('div')).toBeNull()
  })


  it('locks banner/avatar uploads behind diamonds but keeps the logo cameras when the plan lacks customization', async () => {
    const user = userEvent.setup()
    wrap(<ProfilePage />, {
      user: { isSuperAdmin: false, activeTenantRole: 'tenant_admin', entitlements: lockedEntitlements },
    })
    await waitFor(() => expect(getProfile).toHaveBeenCalled())
    const editButtons = screen.getAllByRole('button', { name: /^edit$/i })
    await user.click(editButtons[0]) // Band identity edit button

    // Banner + avatar cameras become diamond upsell links…
    const diamonds = await screen.findAllByRole('link', { name: /premium feature/i })
    expect(diamonds.length).toBeGreaterThan(0)
    for (const diamond of diamonds) {
      expect(diamond).toHaveAttribute('href', '/upgrade/customization')
    }
    // …but the band logo (light + dark) stays uploadable on every plan.
    expect(document.querySelector('[data-testid="CameraAltIcon"]')).not.toBeNull()
  })

  it('keeps the camera buttons when entitlements are unenforced', async () => {
    const user = userEvent.setup()
    wrap(<ProfilePage />, { user: { isSuperAdmin: false, activeTenantRole: 'tenant_admin' } })
    await waitFor(() => expect(getProfile).toHaveBeenCalled())
    const editButtons = screen.getAllByRole('button', { name: /^edit$/i })
    await user.click(editButtons[0])

    await waitFor(() =>
      expect(document.querySelector('[data-testid="CameraAltIcon"]')).not.toBeNull(),
    )
    expect(screen.queryByRole('link', { name: /premium feature/i })).not.toBeInTheDocument()
  })

  it('rejects GIF logo uploads before sending them', async () => {
    wrap(<ProfilePage />, { user: { isSuperAdmin: false, activeTenantRole: 'tenant_admin' } })
    await waitFor(() => expect(getProfile).toHaveBeenCalled())

    const user = userEvent.setup({ applyAccept: false })
    const input = document.querySelector('input[type="file"][accept="image/jpeg,image/png,image/webp"]')
    const file = new File(['gif'], 'logo.gif', { type: 'image/gif' })

    await user.upload(input, file)

    await waitFor(() => expect(screen.getByText('File type not allowed')).toBeInTheDocument())
    expect(uploadLogo).not.toHaveBeenCalled()
  })
})
