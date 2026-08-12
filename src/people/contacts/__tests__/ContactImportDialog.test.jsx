import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ContactImportDialog from '../components/ContactImportDialog.tsx'
import { importContacts } from '../contacts.ts'
import theme from '../../../theme.ts'

vi.mock('../contacts.ts', () => ({ importContacts: vi.fn() }))

function wrap(props = {}) {
  render(
    <ThemeProvider theme={theme}>
      <ContactImportDialog onClose={() => {}} {...props} />
    </ThemeProvider>,
  )
}

function upload(csv) {
  return userEvent.upload(
    document.querySelector('input[type="file"]'),
    new File([csv], 'contacts.csv', { type: 'text/csv' }),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  importContacts.mockResolvedValue({ imported: 1, skipped: 0 })
})

describe('ContactImportDialog', () => {
  it('coerces loose category values onto the known categories', async () => {
    wrap()
    await upload([
      'Name,Category',
      'Radio 1,radio station',
      'Agent,bookings',
      'Blog,press',
      'Unknown,something else',
    ].join('\n'))

    await userEvent.click(await screen.findByRole('button', { name: 'Preview' }))
    await userEvent.click(screen.getByRole('button', { name: 'Import 4 rows' }))

    await waitFor(() => expect(importContacts).toHaveBeenCalledTimes(1))
    expect(importContacts.mock.calls[0][0].map((r) => r.category)).toEqual([
      'radio & tv', 'booker', 'press', 'press',
    ])
  })

  it('hides the category mapping and column and forces the category when fixed', async () => {
    wrap({ fixedCategory: 'supplier', title: 'Import Suppliers from CSV' })

    expect(screen.getByText('Import Suppliers from CSV')).toBeInTheDocument()
    await upload('Name,Category,Email\nStagehands BV,press,hi@stagehands.test')

    // Category is neither offered as a mapping target…
    expect(await screen.findByText('Name *', { selector: 'label' })).toBeInTheDocument()
    expect(screen.queryByText('Category', { selector: 'label' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Preview' }))

    // …nor previewed, and the CSV's own category value is ignored.
    expect(screen.queryByRole('columnheader', { name: 'Category' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Import 1 row' }))

    await waitFor(() => expect(importContacts).toHaveBeenCalledTimes(1))
    expect(importContacts).toHaveBeenCalledWith([
      { name: 'Stagehands BV', email: 'hi@stagehands.test', phone: '', category: 'supplier' },
    ])
  })

  it('defaults an unmapped category to press', async () => {
    wrap()
    await upload('Name,Email\nBlog,hi@blog.test')

    await userEvent.click(await screen.findByRole('button', { name: 'Preview' }))
    await userEvent.click(screen.getByRole('button', { name: 'Import 1 row' }))

    await waitFor(() => expect(importContacts).toHaveBeenCalledTimes(1))
    expect(importContacts.mock.calls[0][0][0].category).toBe('press')
  })
})
