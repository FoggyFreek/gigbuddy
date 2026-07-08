import { render, screen } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it } from 'vitest'
import PlanningReadOnlyAlert from '../components/PlanningReadOnlyAlert.tsx'
import theme from '../theme.ts'

function wrap(canWrite) {
  return render(
    <ThemeProvider theme={theme}>
      <PlanningReadOnlyAlert canWrite={canWrite} />
    </ThemeProvider>,
  )
}

describe('PlanningReadOnlyAlert', () => {
  it('explains that content can be read but not edited', () => {
    wrap(false)
    expect(screen.getByRole('alert')).toHaveTextContent(/view this information, but you can.t edit it/i)
  })

  it('stays hidden for members with planning write access', () => {
    wrap(true)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
