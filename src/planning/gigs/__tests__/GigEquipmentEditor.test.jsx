import { useState } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CompactLayoutContext } from '../../../hooks/useCompactLayout.ts'
import GigEquipmentEditor from '../components/gigdetails/GigEquipmentEditor.tsx'
import theme from '../../../theme.ts'

vi.mock('../gigs.ts', () => ({
  setGigEquipment: vi.fn(),
}))

import { setGigEquipment } from '../gigs.ts'

function wrap(ui, compact = false) {
  return render(
    <ThemeProvider theme={theme}>
      <CompactLayoutContext.Provider value={compact}>{ui}</CompactLayoutContext.Provider>
    </ThemeProvider>
  )
}

// Renders with the parent's state lifted in, the way GigDetailContent holds it,
// so onChange actually re-renders the list.
function renderEditor({ equipment = [], canWrite = true, compact = false } = {}) {
  const onChange = vi.fn()
  function Host() {
    const [value, setValue] = useState(equipment)
    return (
      <GigEquipmentEditor
        gigId={7}
        equipment={value}
        canWrite={canWrite}
        onChange={(next) => { onChange(next); setValue(next) }}
      />
    )
  }
  wrap(<Host />, compact)
  return { onChange }
}

beforeEach(() => {
  vi.clearAllMocks()
  setGigEquipment.mockImplementation((_id, equipment) => Promise.resolve(equipment))
})

describe('GigEquipmentEditor', () => {
  it('adds an item as provided by the venue', async () => {
    const user = userEvent.setup()
    renderEditor()

    expect(screen.getByText('No equipment recorded yet')).toBeInTheDocument()

    await user.click(screen.getByLabelText('Add equipment'))
    await user.click(await screen.findByRole('option', { name: 'Drumkit' }))

    await waitFor(() => {
      expect(setGigEquipment).toHaveBeenCalledWith(7, [{ item: 'drumkit', provider: 'event' }])
    })
  })

  it('flips an item to the band and preserves the others', async () => {
    const user = userEvent.setup()
    renderEditor({
      equipment: [
        { item: 'drumkit', provider: 'event' },
        { item: 'pa_system', provider: 'event' },
      ],
    })

    const drumkitGroup = screen.getByRole('group', { name: 'Who provides Drumkit' })
    await user.click(within(drumkitGroup).getByRole('button', { name: 'We bring' }))

    await waitFor(() => {
      expect(setGigEquipment).toHaveBeenCalledWith(7, [
        { item: 'drumkit', provider: 'band' },
        { item: 'pa_system', provider: 'event' },
      ])
    })
  })

  it('removes an item', async () => {
    const user = userEvent.setup()
    renderEditor({
      equipment: [
        { item: 'drumkit', provider: 'event' },
        { item: 'pa_system', provider: 'band' },
      ],
    })

    await user.click(screen.getByRole('button', { name: 'Remove Drumkit' }))

    await waitFor(() => {
      expect(setGigEquipment).toHaveBeenCalledWith(7, [{ item: 'pa_system', provider: 'band' }])
    })
  })

  it('offers no clear control, so the whole set cannot be wiped in one click', () => {
    renderEditor({
      equipment: [
        { item: 'drumkit', provider: 'event' },
        { item: 'pa_system', provider: 'band' },
      ],
    })

    // By title, not by role: the indicator is visibility-hidden until hover, so
    // its accessible name computes to empty and a byRole query would pass while
    // the button is still there.
    expect(screen.queryByTitle('Clear')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove Drumkit' })).toBeInTheDocument()
  })

  it('ignores a click on the already-active provider (ToggleButtonGroup emits null)', async () => {
    const user = userEvent.setup()
    renderEditor({ equipment: [{ item: 'drumkit', provider: 'event' }] })

    const group = screen.getByRole('group', { name: 'Who provides Drumkit' })
    await user.click(within(group).getByRole('button', { name: 'At venue' }))

    expect(setGigEquipment).not.toHaveBeenCalled()
    expect(within(group).getByRole('button', { name: 'At venue' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('disables every control while a save is in flight so writes cannot overlap', async () => {
    const user = userEvent.setup()
    let resolveSave
    setGigEquipment.mockImplementation(() => new Promise((resolve) => { resolveSave = resolve }))

    renderEditor({ equipment: [{ item: 'drumkit', provider: 'event' }] })

    const group = screen.getByRole('group', { name: 'Who provides Drumkit' })
    await user.click(within(group).getByRole('button', { name: 'We bring' }))

    await waitFor(() => {
      expect(within(group).getByRole('button', { name: 'We bring' })).toBeDisabled()
    })
    expect(screen.getByLabelText('Add equipment')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remove Drumkit' })).toBeDisabled()

    // A second interaction while pending must not queue another whole-set PUT.
    // fireEvent bypasses the pointer-events guard, so this proves the handler
    // itself is inert rather than just visually blocked.
    fireEvent.click(within(group).getByRole('button', { name: 'We bring' }))
    expect(setGigEquipment).toHaveBeenCalledTimes(1)

    resolveSave([{ item: 'drumkit', provider: 'band' }])
    await waitFor(() => {
      expect(screen.getByLabelText('Add equipment')).not.toBeDisabled()
    })
  })

  it('reserves the busy indicator space so a save cannot reflow the section', async () => {
    const user = userEvent.setup()
    let resolveSave
    setGigEquipment.mockImplementation(() => new Promise((resolve) => { resolveSave = resolve }))

    renderEditor({ equipment: [{ item: 'drumkit', provider: 'event' }] })

    const slot = screen.getByTestId('equipment-busy-slot')
    expect(slot).toHaveStyle({ height: '16px' })
    expect(within(slot).queryByRole('progressbar')).not.toBeInTheDocument()

    const group = screen.getByRole('group', { name: 'Who provides Drumkit' })
    await user.click(within(group).getByRole('button', { name: 'We bring' }))

    expect(await within(slot).findByRole('progressbar')).toBeInTheDocument()
    // Same node, same reserved height: the spinner appears inside the row that
    // was already there rather than inserting one.
    expect(screen.getByTestId('equipment-busy-slot')).toBe(slot)
    expect(slot).toHaveStyle({ height: '16px' })

    resolveSave([{ item: 'drumkit', provider: 'band' }])
    await waitFor(() => {
      expect(within(slot).queryByRole('progressbar')).not.toBeInTheDocument()
    })
  })

  it('reports a failed save and falls back to the last confirmed set', async () => {
    const user = userEvent.setup()
    setGigEquipment.mockRejectedValue(new Error('Network down'))

    renderEditor({ equipment: [{ item: 'drumkit', provider: 'event' }] })

    const group = screen.getByRole('group', { name: 'Who provides Drumkit' })
    await user.click(within(group).getByRole('button', { name: 'We bring' }))

    expect(await screen.findByText('Network down')).toBeInTheDocument()
    expect(within(group).getByRole('button', { name: 'At venue' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('fills the row and enlarges the toggle in compact layout', () => {
    renderEditor({ equipment: [{ item: 'drumkit', provider: 'event' }], compact: true })

    const group = screen.getByRole('group', { name: 'Who provides Drumkit' })
    expect(within(group).getByRole('button', { name: 'We bring' }))
      .toHaveClass('MuiToggleButton-sizeMedium')
    expect(group.closest('.MuiCard-root')).toHaveStyle({ width: '100%' })
  })

  it('keeps the compact sizing off on desktop and spans half the width', () => {
    renderEditor({ equipment: [{ item: 'drumkit', provider: 'event' }] })

    const group = screen.getByRole('group', { name: 'Who provides Drumkit' })
    expect(within(group).getByRole('button', { name: 'We bring' }))
      .toHaveClass('MuiToggleButton-sizeSmall')
    // The Autocomplete and the rows share the container's width.
    expect(screen.getByLabelText('Add equipment').closest('.MuiStack-root'))
      .toHaveStyle({ width: '50%' })
  })

  it('is read-only without planning write access', () => {
    renderEditor({ equipment: [{ item: 'drumkit', provider: 'event' }], canWrite: false })

    // Read-only is not the same as disabled: the list stays readable and
    // focusable, only the writes are gone.
    const input = screen.getByLabelText('Add equipment')
    expect(input).toHaveAttribute('readonly')
    expect(input).not.toBeDisabled()

    const group = screen.getByRole('group', { name: 'Who provides Drumkit' })
    expect(within(group).getByRole('button', { name: 'We bring' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Remove Drumkit' })).not.toBeInTheDocument()

    fireEvent.click(within(group).getByRole('button', { name: 'We bring' }))
    expect(setGigEquipment).not.toHaveBeenCalled()
  })
})
