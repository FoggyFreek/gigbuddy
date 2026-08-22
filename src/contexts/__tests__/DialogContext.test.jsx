import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DialogProvider } from '../DialogContext.tsx'
import { useDialog } from '../dialogContext.ts'
import { DIALOG_IDS } from '../../dialogs/dialogRegistry.ts'
import theme from '../../theme.ts'
import '../../i18n/index.ts'

function LocationProbe() {
  const { pathname } = useLocation()
  return <div data-testid="pathname">{pathname}</div>
}

function wrap(ui) {
  return render(
    <ThemeProvider theme={theme}>
      <MemoryRouter initialEntries={['/']}>
        <DialogProvider>
          <Routes>
            <Route path="*" element={<>{ui}<LocationProbe /></>} />
          </Routes>
        </DialogProvider>
      </MemoryRouter>
    </ThemeProvider>,
  )
}

describe('DialogProvider', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('resolves showDialog with the id of the clicked action', async () => {
    const onOutcome = vi.fn()
    function Trigger() {
      const { showDialog } = useDialog()
      return (
        <button onClick={() => showDialog({
          id: 'ad-hoc',
          title: 'Ad hoc title',
          body: 'Ad hoc body',
          actions: [{ id: 'no', label: 'No' }, { id: 'yes', label: 'Yes' }],
        }).then(onOutcome)}
        >
          open
        </button>
      )
    }
    wrap(<Trigger />)

    await userEvent.click(screen.getByText('open'))
    expect(await screen.findByText('Ad hoc title')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Yes' }))
    await waitFor(() => expect(onOutcome).toHaveBeenCalledWith('yes'))
  })

  it('confirm() resolves false when the dialog is dismissed', async () => {
    const onOutcome = vi.fn()
    function Trigger() {
      const { confirm } = useDialog()
      return <button onClick={() => confirm({ title: 'Sure?' }).then(onOutcome)}>open</button>
    }
    wrap(<Trigger />)

    await userEvent.click(screen.getByText('open'))
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(onOutcome).toHaveBeenCalledWith(false))
  })

  it('confirmDelete() offers the shared destructive pair and resolves on confirm', async () => {
    const onOutcome = vi.fn()
    function Trigger() {
      const { confirmDelete } = useDialog()
      return (
        <button onClick={() => confirmDelete({ title: 'Delete this song?' }).then(onOutcome)}>open</button>
      )
    }
    wrap(<Trigger />)

    await userEvent.click(screen.getByText('open'))
    expect(await screen.findByText('Delete this song?')).toBeTruthy()
    expect(screen.getByText('This cannot be undone.')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(onOutcome).toHaveBeenCalledWith(true))
  })

  it('navigates when the clicked action declares a settings target', async () => {
    function Trigger() {
      const { openDialog } = useDialog()
      return <button onClick={() => openDialog(DIALOG_IDS.TRIAL_ENDED)}>open</button>
    }
    wrap(<Trigger />)

    await userEvent.click(screen.getByText('open'))
    await userEvent.click(await screen.findByRole('button', { name: "Let's have a look" }))

    await waitFor(() => expect(screen.getByTestId('pathname').textContent).toBe('/settings/billing'))
  })

  it('stores the suppression and refuses to show the dialog again', async () => {
    const onOutcome = vi.fn()
    function Trigger() {
      const { openDialog } = useDialog()
      return <button onClick={() => openDialog(DIALOG_IDS.TRIAL_ENDED).then(onOutcome)}>open</button>
    }
    wrap(<Trigger />)

    await userEvent.click(screen.getByText('open'))
    await userEvent.click(await screen.findByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: 'Maybe later' }))

    await waitFor(() => expect(
      JSON.parse(localStorage.getItem('gigbuddy_suppressed_dialogs')),
    ).toContain(DIALOG_IDS.TRIAL_ENDED))

    onOutcome.mockClear()
    await userEvent.click(screen.getByText('open'))
    await waitFor(() => expect(onOutcome).toHaveBeenCalledWith(null))
    await waitFor(() => expect(screen.queryByText('Your free trial has ended')).toBeNull())
  })

  it('shows a second dialog after the first one has closed', async () => {
    function Trigger() {
      const { showDialog } = useDialog()
      return (
        <>
          <button onClick={() => showDialog({ id: 'first', title: 'First dialog', actions: [{ id: 'ok', label: 'OK' }] })}>
            first
          </button>
          <button onClick={() => showDialog({ id: 'second', title: 'Second dialog', actions: [{ id: 'ok', label: 'OK' }] })}>
            second
          </button>
        </>
      )
    }
    wrap(<Trigger />)

    await userEvent.click(screen.getByText('first'))
    await userEvent.click(await screen.findByRole('button', { name: 'OK' }))
    await waitFor(() => expect(screen.queryByText('First dialog')).toBeNull())

    await userEvent.click(screen.getByText('second'))
    expect(await screen.findByText('Second dialog')).toBeTruthy()
  })
})
