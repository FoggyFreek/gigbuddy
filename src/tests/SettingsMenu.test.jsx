import { render, screen } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import theme from '../theme.ts'
import SettingsMenu from '../components/appShell/SettingsMenu.tsx'

function wrap(ui) {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>{ui}</ThemeProvider>
    </MemoryRouter>,
  )
}

function renderMenu(props = {}) {
  return wrap(
    <SettingsMenu
      anchorEl={document.body}
      open
      onClose={vi.fn()}
      mode="light"
      onToggleTheme={vi.fn()}
      {...props}
    />,
  )
}

describe('SettingsMenu', () => {
  it('links to the settings page', () => {
    renderMenu()
    const link = screen.getByRole('menuitem', { name: /^settings$/i })
    expect(link).toHaveAttribute('href', '/settings')
  })

  it('closes the menu when the settings link is clicked', () => {
    const onClose = vi.fn()
    renderMenu({ onClose })
    screen.getByRole('menuitem', { name: /^settings$/i }).click()
    expect(onClose).toHaveBeenCalled()
  })
})
