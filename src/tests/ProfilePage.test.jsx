import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ProfilePage from '../components/ProfilePage.jsx'
import theme from '../theme.js'

vi.mock('../api/bandMembers.js', () => ({
  listMembers: vi.fn().mockResolvedValue([]),
  createMember: vi.fn(),
  updateMember: vi.fn(),
  deleteMember: vi.fn(),
}))

vi.mock('../api/availability.js', () => ({
  listAvailability: vi.fn().mockResolvedValue([]),
  createSlot: vi.fn(),
  updateSlot: vi.fn(),
  deleteSlot: vi.fn(),
  getAvailabilityOn: vi.fn(),
}))

vi.mock('../api/profile.js', () => ({
  getProfile: vi.fn().mockResolvedValue({
    id: 1,
    band_name: 'The Testers',
    bio: 'We test things.',
    instagram_handle: 'thetesters',
    facebook_handle: '',
    tiktok_handle: '',
    youtube_handle: '',
    spotify_handle: '',
    links: [
      { id: 10, label: 'EPK', url: 'https://drive.google.com/xyz', sort_order: 0 },
    ],
  }),
  updateProfile: vi.fn().mockResolvedValue({}),
  createLink: vi.fn().mockResolvedValue({ id: 11, label: 'Website', url: 'https://example.com', sort_order: 1 }),
  updateLink: vi.fn().mockResolvedValue({}),
  deleteLink: vi.fn().mockResolvedValue(null),
}))

import { createLink, deleteLink, getProfile, updateProfile } from '../api/profile.js'

function wrap(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

describe('ProfilePage', () => {
  beforeEach(() => {
    getProfile.mockClear()
    updateProfile.mockClear()
    createLink.mockClear()
    deleteLink.mockClear()
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
    // EPK link appears as text in display mode
    expect(screen.getByText('EPK')).toBeInTheDocument()
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
    wrap(<ProfilePage />)
    await waitFor(() => screen.getByText('EPK'))

    const user = userEvent.setup()
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

  it('deletes a link', async () => {
    wrap(<ProfilePage />)
    await waitFor(() => screen.getByText('EPK'))

    const user = userEvent.setup()
    const deleteBtn = screen.getByRole('button', { name: /delete link/i })
    await user.click(deleteBtn)

    await waitFor(() => expect(deleteLink).toHaveBeenCalledWith(10))
  })
})
