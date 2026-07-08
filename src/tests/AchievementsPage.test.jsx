import { render, screen, waitFor } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/achievements.ts', () => ({ listAchievements: vi.fn() }))

import AchievementsPage from '../pages/AchievementsPage.tsx'
import { listAchievements } from '../api/achievements.ts'
import theme from '../theme.ts'

function wrap(ui) {
  return render(
    <MemoryRouter initialEntries={['/achievements']}>
      <ThemeProvider theme={theme}>{ui}</ThemeProvider>
    </MemoryRouter>
  )
}

const ACHIEVEMENTS = [
  { key: 'welcome_to_the_giggle', category: 'platform', cheers: 1, unlocked_at: '2026-06-01T10:00:00Z' },
  { key: 'now_were_photogenic', category: 'profile', cheers: 1, unlocked_at: '2026-06-02T10:00:00Z' },
  { key: 'logo_a_go_go', category: 'profile', cheers: 2, unlocked_at: null },
  { key: 'fifty_people_who_might_answer', category: 'network', cheers: 5, unlocked_at: null },
]

describe('AchievementsPage', () => {
  beforeEach(() => {
    listAchievements.mockResolvedValue(ACHIEVEMENTS)
  })
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders category sections in order with their achievements', async () => {
    wrap(<AchievementsPage />)
    await waitFor(() => expect(screen.getByText('Achievements')).toBeInTheDocument())
    expect(screen.getByText('Profile')).toBeInTheDocument()
    expect(screen.getByText('Platform')).toBeInTheDocument()
    expect(screen.getByText('Network')).toBeInTheDocument()
    // Categories without achievements are omitted.
    expect(screen.queryByText('Finance')).not.toBeInTheDocument()
    expect(screen.getByText('Welcome to the Giggle')).toBeInTheDocument()
    expect(screen.getByText('Celebrate your arrival on gigBuddy.')).toBeInTheDocument()
  })

  it('renders unlocked and locked banners with their cheers value', async () => {
    wrap(<AchievementsPage />)
    await waitFor(() => expect(screen.getByText('Now We’re Photogenic')).toBeInTheDocument())
    const unlocked = screen.getByTestId('achievement-now_were_photogenic')
    expect(unlocked).toHaveAttribute('data-locked', 'false')
    expect(unlocked).toHaveTextContent(/Unlocked/)

    const locked = screen.getByTestId('achievement-logo_a_go_go')
    expect(locked).toHaveAttribute('data-locked', 'true')
    // Cheers badge: number and the letter C in an aria-labelled circle.
    expect(screen.getByRole('img', { name: '5 cheers' })).toBeInTheDocument()
    // Two achievements are worth a single cheer — singular label on both.
    expect(screen.getAllByRole('img', { name: '1 cheer' })).toHaveLength(2)
  })

  it('shows earned vs total cheers in the summary chip', async () => {
    wrap(<AchievementsPage />)
    // Earned: 1 + 1 unlocked; total: 1+1+2+5.
    await waitFor(() => expect(screen.getByText('2 / 9 cheers')).toBeInTheDocument())
  })

  it('shows an error message when loading fails', async () => {
    listAchievements.mockRejectedValue(new Error('boom'))
    wrap(<AchievementsPage />)
    await waitFor(() =>
      expect(screen.getByText(/couldn't load achievements/i)).toBeInTheDocument()
    )
  })
})
