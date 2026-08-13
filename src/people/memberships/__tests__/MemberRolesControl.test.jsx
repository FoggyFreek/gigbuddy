import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it, vi } from 'vitest'
import MemberRolesControl from '../components/MemberRolesControl.tsx'
import theme from '../../../theme.ts'

function wrap(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

describe('MemberRolesControl', () => {
  it('renders ordered roles and an edit option in view mode', async () => {
    const onEdit = vi.fn()
    const user = userEvent.setup()
    wrap(
      <MemberRolesControl
        roles={['Lead Vocals', 'Piano']}
        mode="view"
        canEdit
        onEdit={onEdit}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByText('Lead Vocals')).toBeInTheDocument()
    expect(screen.getByText('Piano')).toBeInTheDocument()
    expect(screen.getByText('Lead Vocals').compareDocumentPosition(screen.getByText('Piano'))
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /^edit$/i }))
    expect(onEdit).toHaveBeenCalledOnce()
  })

  it('keeps view mode read-only when editing is not permitted', () => {
    wrap(
      <MemberRolesControl
        roles={[]}
        mode="view"
        canEdit={false}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByText('No roles selected.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^roles$/i)).not.toBeInTheDocument()
  })

  it('preserves selection order, appends new roles, and reorders them in edit mode', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    const { rerender } = wrap(
      <MemberRolesControl roles={['Lead Guitar']} mode="edit" onChange={onChange} />,
    )

    await user.click(screen.getByLabelText(/^roles$/i))
    await user.click(screen.getByRole('option', { name: 'Drums' }))
    expect(onChange).toHaveBeenLastCalledWith(['Lead Guitar', 'Drums'])

    rerender(
      <ThemeProvider theme={theme}>
        <MemberRolesControl roles={['Lead Guitar', 'Drums']} mode="edit" onChange={onChange} />
      </ThemeProvider>,
    )
    await user.click(screen.getByRole('button', { name: /move drums up/i }))
    expect(onChange).toHaveBeenLastCalledWith(['Drums', 'Lead Guitar'])
  })
})
