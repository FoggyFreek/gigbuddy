import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CsvImportDialog from '../../components/csvImport/CsvImportDialog.tsx'
import theme from '../../theme.ts'

const FIELDS = [
  { key: 'name', label: 'Name', required: true, aliases: ['name', 'full name'] },
  { key: 'city', label: 'City', aliases: ['city', 'town'] },
]

const COLUMNS = [
  { key: 'name', header: 'Name', strong: true },
  { key: 'city', header: 'City' },
]

function renderDialog(props = {}) {
  const onImport = props.onImport ?? vi.fn().mockResolvedValue({ imported: 1, skipped: 0 })
  const onClose = props.onClose ?? vi.fn()
  render(
    <ThemeProvider theme={theme}>
      <CsvImportDialog
        fields={FIELDS}
        previewColumns={COLUMNS}
        requiredFieldKey="name"
        onImport={onImport}
        onClose={onClose}
        title="Import things"
        uploadHelp="Upload a CSV."
        mapHelp={(count) => `Map your columns. ${count} rows detected.`}
        formatResult={(r) => `Imported ${r.imported} things.`}
        {...props}
      />
    </ThemeProvider>,
  )
  return { onImport, onClose }
}

function upload(csv) {
  return userEvent.upload(
    document.querySelector('input[type="file"]'),
    new File([csv], 'data.csv', { type: 'text/csv' }),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('CsvImportDialog', () => {
  it('starts on the upload step with the caller-supplied copy', () => {
    renderDialog()

    expect(screen.getByText('Import things')).toBeInTheDocument()
    expect(screen.getByText('Upload a CSV.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('auto-maps columns by alias, case-insensitively', async () => {
    renderDialog()
    await upload('Full Name,TOWN\nParadiso,Amsterdam')

    expect(await screen.findByText('Map your columns. 1 rows detected.')).toBeInTheDocument()
    // The label carries the required marker; the Select shows the matched header.
    expect(screen.getByText('Name *', { selector: 'label' })).toBeInTheDocument()
    expect(screen.getByText('Full Name', { selector: '[role="combobox"]' })).toBeInTheDocument()
    expect(screen.getByText('TOWN', { selector: '[role="combobox"]' })).toBeInTheDocument()
  })

  it('blocks the preview step until the required column is mapped', async () => {
    renderDialog()
    await upload('Nickname,City\nParadiso,Amsterdam')

    await userEvent.click(await screen.findByRole('button', { name: 'Preview' }))

    expect(screen.getByText('Name column is required')).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('previews the first five rows and reports how many will import', async () => {
    renderDialog()
    const rows = ['Name,City']
    for (let i = 1; i <= 7; i += 1) rows.push(`Venue ${i},City ${i}`)
    await upload(rows.join('\n'))

    await userEvent.click(await screen.findByRole('button', { name: 'Preview' }))

    expect(screen.getByText(/Showing first 5 of 7 rows\./)).toBeInTheDocument()
    expect(screen.getByText(/7 rows will be imported\./)).toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(6) // header + 5 preview rows
    expect(screen.getByRole('button', { name: 'Import 7 rows' })).toBeInTheDocument()
  })

  it('imports transformed rows, skipping rows without the required field', async () => {
    const transformRow = (values) => ({ ...values, city: values.city.toUpperCase() })
    const { onImport } = renderDialog({ transformRow })
    await upload('Name,City\nParadiso,Amsterdam\n,Utrecht\nMelkweg,Amsterdam')

    await userEvent.click(await screen.findByRole('button', { name: 'Preview' }))
    await userEvent.click(screen.getByRole('button', { name: 'Import 2 rows' }))

    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1))
    expect(onImport).toHaveBeenCalledWith([
      { name: 'Paradiso', city: 'AMSTERDAM' },
      { name: 'Melkweg', city: 'AMSTERDAM' },
    ])
    expect(await screen.findByText('Imported 1 things.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })

  it('returns to the preview step and shows the error when the import fails', async () => {
    const onImport = vi.fn().mockRejectedValue(new Error('Quota exceeded'))
    renderDialog({ onImport })
    await upload('Name,City\nParadiso,Amsterdam')

    await userEvent.click(await screen.findByRole('button', { name: 'Preview' }))
    await userEvent.click(screen.getByRole('button', { name: 'Import 1 row' }))

    expect(await screen.findByText('Quota exceeded')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import 1 row' })).toBeInTheDocument()
  })

  it('reports whether anything was imported when closing', async () => {
    const { onClose } = renderDialog()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onClose).toHaveBeenCalledWith(false)
  })
})
