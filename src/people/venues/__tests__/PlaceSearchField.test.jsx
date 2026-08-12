import { useState } from 'react'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The control's only side effect is the debounced place lookup.
vi.mock('../places.ts', () => ({
  searchPlaces: vi.fn().mockResolvedValue([]),
  getPlaceDetails: vi.fn(async (suggestion) => suggestion),
}))

import PlaceSearchField from '../../../components/shared/PlaceSearchField.tsx'
import { getPlaceDetails, searchPlaces } from '../places.ts'
import i18n from '../../../i18n/index.ts'
import theme from '../../../theme.ts'

const PARADISO = {
  id: 'NL/POI/p0/1',
  name: 'Paradiso',
  street_and_number: 'Weteringschans 6',
  postal_code: '1017SG',
  city: 'Amsterdam',
  region: 'Noord-Holland',
  country: 'NL',
  website: 'https://www.paradiso.nl',
  phone: '+31 20 626 4521',
  latitude: 52.3624,
  longitude: 4.8838,
  freeform_address: 'Weteringschans 6, 1017SG Amsterdam',
  categories: ['concert hall'],
}

// Holds the controlled text the way a real form would.
function Harness({ onPlaceSelect = () => {}, initial = '', ...props }) {
  const [value, setValue] = useState(initial)
  return (
    <PlaceSearchField
      value={value}
      onValueChange={setValue}
      onPlaceSelect={onPlaceSelect}
      label="Search venue name"
      {...props}
    />
  )
}

function wrap(ui) {
  return <ThemeProvider theme={theme}>{ui}</ThemeProvider>
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  searchPlaces.mockReset().mockResolvedValue([])
  getPlaceDetails.mockReset().mockImplementation(async (suggestion) => suggestion)
})

describe('PlaceSearchField', () => {
  it('does not search below the 3-character minimum', async () => {
    const user = userEvent.setup()
    render(wrap(<Harness />))

    await user.type(screen.getByRole('combobox'), 'Pa')

    await act(async () => { await new Promise((r) => setTimeout(r, 400)) })
    expect(searchPlaces).not.toHaveBeenCalled()
  })

  it('searches once per debounce window, not once per keystroke', async () => {
    const user = userEvent.setup()
    render(wrap(<Harness />))

    await user.type(screen.getByRole('combobox'), 'Paradiso')
    await waitFor(() => expect(searchPlaces).toHaveBeenCalled())

    // Past the 250 ms debounce — no trailing request should land.
    await act(async () => { await new Promise((r) => setTimeout(r, 400)) })
    expect(searchPlaces).toHaveBeenCalledTimes(1)
    expect(searchPlaces.mock.calls[0][0]).toBe('Paradiso')
  })

  it('emits the full suggestion when an option is picked', async () => {
    const onPlaceSelect = vi.fn()
    searchPlaces.mockResolvedValue([PARADISO])
    const user = userEvent.setup()
    render(wrap(<Harness onPlaceSelect={onPlaceSelect} />))

    await user.type(screen.getByRole('combobox'), 'Paradiso')
    await screen.findByText('Weteringschans 6, 1017SG Amsterdam')
    await user.keyboard('{ArrowDown}{Enter}')

    await waitFor(() => expect(onPlaceSelect).toHaveBeenCalledWith(PARADISO))
  })

  it('resolves a lightweight v3 suggestion before emitting it', async () => {
    const partial = {
      ...PARADISO,
      website: null,
      phone: null,
      latitude: null,
      longitude: null,
      details: { id: 'poi-paradiso', session_id: '34a45e58-9f68-4ca6-bc0e-4f04311fbc42' },
    }
    const onPlaceSelect = vi.fn()
    searchPlaces.mockResolvedValue([partial])
    getPlaceDetails.mockResolvedValue(PARADISO)
    const user = userEvent.setup()
    render(wrap(<Harness onPlaceSelect={onPlaceSelect} />))

    await user.type(screen.getByRole('combobox'), 'Paradiso')
    await screen.findByText('Weteringschans 6, 1017SG Amsterdam')
    await user.keyboard('{ArrowDown}{Enter}')

    await waitFor(() => expect(getPlaceDetails).toHaveBeenCalledWith(partial))
    expect(onPlaceSelect).toHaveBeenCalledWith(PARADISO)
  })

  it('keeps a typed name that matches nothing so manual entry still works', async () => {
    const onPlaceSelect = vi.fn()
    const user = userEvent.setup()
    render(wrap(<Harness onPlaceSelect={onPlaceSelect} />))

    const input = screen.getByRole('combobox')
    await user.type(input, 'Jansens Schuur')
    await waitFor(() => expect(searchPlaces).toHaveBeenCalled())

    expect(input).toHaveValue('Jansens Schuur')
    expect(onPlaceSelect).not.toHaveBeenCalled()
  })

  it('tells the user to keep typing before the minimum is reached', async () => {
    const user = userEvent.setup()
    render(wrap(<Harness />))

    await user.click(screen.getByRole('combobox'))
    await user.keyboard('Pa')

    expect(await screen.findByText('Type at least 3 characters to search')).toBeInTheDocument()
  })

  it('says no matches were found once a search comes back empty', async () => {
    const user = userEvent.setup()
    render(wrap(<Harness />))

    await user.type(screen.getByRole('combobox'), 'Paradiso')

    expect(
      await screen.findByText('No matches — keep typing to enter the details by hand.'),
    ).toBeInTheDocument()
  })

  it('passes an already-known country and city to the lookup', async () => {
    const user = userEvent.setup()
    render(wrap(<Harness country="NL" city="Amsterdam" />))

    await user.type(screen.getByRole('combobox'), 'Paradiso')

    await waitFor(() => expect(searchPlaces).toHaveBeenCalledWith(
      'Paradiso', expect.objectContaining({ country: 'NL', city: 'Amsterdam' }),
    ))
  })

  it('re-runs the lookup when the known city changes', async () => {
    const { rerender } = render(wrap(<Harness initial="Paradiso" city="Amsterdam" />))

    await waitFor(() => expect(searchPlaces).toHaveBeenCalledTimes(1))
    rerender(wrap(<Harness initial="Paradiso" city="Utrecht" />))

    await waitFor(() => expect(searchPlaces).toHaveBeenCalledTimes(2))
    expect(searchPlaces.mock.calls[1][1]).toMatchObject({ city: 'Utrecht' })
  })

  it('does not search while disabled', async () => {
    render(wrap(<Harness initial="Paradiso" disabled />))

    await act(async () => { await new Promise((r) => setTimeout(r, 400)) })
    expect(searchPlaces).not.toHaveBeenCalled()
  })
})
