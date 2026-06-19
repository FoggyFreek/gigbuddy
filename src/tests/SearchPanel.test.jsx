import { useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import theme from '../theme.ts'

// Every category resolves through a mocked api module so no real fetch happens.
vi.mock('../api/gigs.ts', () => ({ searchGigs: vi.fn().mockResolvedValue([]) }))
vi.mock('../api/contacts.ts', () => ({ searchContacts: vi.fn().mockResolvedValue([]) }))
vi.mock('../api/songs.ts', () => ({ searchSongs: vi.fn().mockResolvedValue([]) }))
vi.mock('../api/setlists.ts', () => ({ searchSetlists: vi.fn().mockResolvedValue([]) }))
vi.mock('../api/invoices.ts', () => ({ searchInvoices: vi.fn().mockResolvedValue([]) }))
vi.mock('../api/purchases.ts', () => ({ searchPurchases: vi.fn().mockResolvedValue([]) }))
vi.mock('../api/ledger.ts', () => ({ searchLedgerTransactions: vi.fn().mockResolvedValue([]) }))
vi.mock('../api/files.ts', () => ({ searchFiles: vi.fn().mockResolvedValue([]) }))
// Default to a finance-capable user so every category is visible.
vi.mock('../hooks/usePermissions.ts', () => ({ usePermissions: () => ({ can: () => true }) }))

import SearchPanel from '../components/appShell/SearchPanel.tsx'
import { searchGigs } from '../api/gigs.ts'
import { searchContacts } from '../api/contacts.ts'

const TENANT_ID = 1
const STORAGE_KEY = `gigbuddy:recent-searches:${TENANT_ID}`

function LocationProbe() {
  const { pathname } = useLocation()
  return <div data-testid="pathname">{pathname}</div>
}

// Mirrors how AppShell wires the panel: it owns the query, and onNavigate both
// clears the query AND closes (unmounts) the panel when a result is picked —
// the latter is essential, since the panel unmounting in the same click is what
// previously dropped the localStorage write.
function Harness({ tenantId = TENANT_ID }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(true)
  return (
    <ThemeProvider theme={theme}>
      <MemoryRouter initialEntries={['/']}>
        <input
          aria-label="search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button aria-label="open-search" onClick={() => setOpen(true)}>open</button>
        {open && (
          <SearchPanel
            query={query}
            tenantId={tenantId}
            onNavigate={() => { setOpen(false); setQuery('') }}
          />
        )}
        <LocationProbe />
      </MemoryRouter>
    </ThemeProvider>
  )
}

const input = () => screen.getByLabelText('search-input')
const pathname = () => screen.getByTestId('pathname').textContent

// Type into the controlled query input and let the debounce + search promises
// resolve so results render.
async function search(term) {
  fireEvent.change(input(), { target: { value: term } })
  // First flush fires the debounce; the search effect then awaits the api
  // promises, which a second flush resolves into rendered results.
  await act(async () => { await vi.runAllTimersAsync() })
  await act(async () => { await vi.runAllTimersAsync() })
}

describe('SearchPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    searchGigs.mockReset().mockResolvedValue([])
    searchContacts.mockReset().mockResolvedValue([])
  })
  afterEach(() => {
    vi.useRealTimers()
    localStorage.clear()
  })

  it('stores the clicked result, resets the query, and shows it under Recent', async () => {
    searchContacts.mockResolvedValue([
      { id: 5, name: 'Foo Contact', email: 'foo@example.com' },
    ])
    render(<Harness />)
    await search('foo')

    // Contacts is a default category and excludes suppliers.
    expect(searchContacts).toHaveBeenCalledWith('foo', { excludeCategory: 'supplier' })
    const result = screen.getByText('Foo Contact')
    fireEvent.click(result)
    await act(async () => { await vi.runAllTimersAsync() })

    // Navigating closed (unmounted) the panel, just like in the app…
    expect(screen.queryByText('Search in')).not.toBeInTheDocument()
    // …it navigated to the result's target…
    expect(pathname()).toBe('/contacts/5')
    // …the query was reset…
    expect(input()).toHaveValue('')
    // …and the destination (not the query) was persisted for this tenant even
    // though the write raced with the unmount.
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY))
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({
      category: 'contacts',
      id: '5',
      label: 'Foo Contact',
      to: '/contacts/5',
    })

    // Reopening the panel reads it back from storage into the Recent block.
    fireEvent.click(screen.getByLabelText('open-search'))
    expect(screen.getByText('Recent')).toBeInTheDocument()
    expect(screen.getByText('Foo Contact')).toBeInTheDocument()
  })

  it('renders persisted recents on open and clicking one re-navigates', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([
      { category: 'gigs', id: 'gigs-3', label: 'Summer festival', to: '/gigs/3', at: 1 },
    ]))
    render(<Harness />)

    // Empty query → Recent block visible with the stored item.
    expect(screen.getByText('Recent')).toBeInTheDocument()
    const recent = screen.getByText('Summer festival')
    fireEvent.click(recent)
    expect(pathname()).toBe('/gigs/3')
  })

  it('hides the Recent block as soon as the user starts typing', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([
      { category: 'gigs', id: 'gigs-3', label: 'Summer festival', to: '/gigs/3', at: 1 },
    ]))
    render(<Harness />)
    expect(screen.getByText('Recent')).toBeInTheDocument()

    // A single keystroke hides recents immediately (no debounce wait needed).
    fireEvent.change(input(), { target: { value: 'a' } })
    expect(screen.queryByText('Recent')).not.toBeInTheDocument()
    expect(screen.queryByText('Summer festival')).not.toBeInTheDocument()
  })

  it('does not show a Recent block when there is nothing stored', () => {
    render(<Harness />)
    expect(screen.queryByText('Recent')).not.toBeInTheDocument()
  })

  it('searches the gigs category via the API and navigates to the gig on click', async () => {
    searchGigs.mockResolvedValue([
      { id: 42, event_description: 'Alpha Gig', venue: { name: 'Alpha Hall', city: 'Gent' } },
    ])
    render(<Harness />)
    await search('Alpha')

    // Query passed straight through to the gigs API.
    expect(searchGigs).toHaveBeenCalledWith('Alpha')
    // Result mapped to label + venue sublabel.
    const result = screen.getByText('Alpha Gig')
    expect(screen.getByText('Alpha Hall · Gent')).toBeInTheDocument()

    fireEvent.click(result)
    await act(async () => { await vi.runAllTimersAsync() })
    expect(pathname()).toBe('/gigs/42')
  })
})
