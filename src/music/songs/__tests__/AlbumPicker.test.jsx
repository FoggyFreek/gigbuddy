import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import theme from '../../../theme.ts'

vi.mock('../songs.ts', () => ({
  listAlbums: vi.fn(),
  createAlbum: vi.fn(),
  updateAlbum: vi.fn(),
  uploadAlbumArt: vi.fn(),
  deleteAlbumArt: vi.fn(),
}))

vi.mock('../../../utils/compressImage.ts', () => ({
  compressAlbumArt: vi.fn(async (file) => file),
}))

vi.mock('../../../components/ImageCropDialog.tsx', () => ({
  default: ({ open, onConfirm }) => open
    ? <button onClick={() => onConfirm(new Blob(['cropped'], { type: 'image/png' }))}>Confirm crop</button>
    : null,
}))

import AlbumPicker from '../components/AlbumPicker.tsx'
import { createAlbum, listAlbums, updateAlbum, uploadAlbumArt } from '../songs.ts'
import { compressAlbumArt } from '../../../utils/compressImage.ts'

function wrap(onChange = vi.fn()) {
  render(
    <ThemeProvider theme={theme}>
      <AlbumPicker value={null} onChange={onChange} />
    </ThemeProvider>,
  )
  return onChange
}

describe('AlbumPicker', () => {
  beforeEach(() => {
    listAlbums.mockReset()
    listAlbums.mockResolvedValue([])
    createAlbum.mockReset()
    updateAlbum.mockReset()
    uploadAlbumArt.mockReset()
    URL.createObjectURL = vi.fn(() => 'blob:album-art')
    URL.revokeObjectURL = vi.fn()
  })

  it('offers a modal create flow for a title that does not exist and selects the result', async () => {
    const created = { id: 7, title: 'In Rainbows', release_date: '2007-10-10' }
    createAlbum.mockResolvedValue(created)
    const onChange = wrap()
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('Album'), 'In Rainbows')
    const createOption = await screen.findByText('Create album “In Rainbows”…')
    await user.click(createOption)

    const dialog = screen.getByRole('dialog', { name: 'Create album' })
    expect(within(dialog).getByDisplayValue('In Rainbows')).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText('Release date'), '2007-10-10')
    await user.click(within(dialog).getByRole('button', { name: 'Create album' }))

    await waitFor(() => expect(createAlbum).toHaveBeenCalledWith({
      title: 'In Rainbows',
      release_date: '2007-10-10',
    }))
    expect(onChange).toHaveBeenCalledWith(created)
  })

  it('opens the same album modal in edit mode from the selected album', async () => {
    const album = { id: 7, title: 'In Rainbows', release_date: '2007-10-10', album_art_url: null }
    updateAlbum.mockResolvedValue({ ...album, title: 'In Rainbows (Disk 2)' })
    const onChange = vi.fn()
    render(
      <ThemeProvider theme={theme}>
        <AlbumPicker value={album} onChange={onChange} />
      </ThemeProvider>,
    )
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Edit album' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit album' })
    const title = within(dialog).getByLabelText(/^Title/)
    await user.clear(title)
    await user.type(title, 'In Rainbows (Disk 2)')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateAlbum).toHaveBeenCalledWith(7, {
      title: 'In Rainbows (Disk 2)',
      release_date: '2007-10-10',
    }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ title: 'In Rainbows (Disk 2)' }))
  })

  it('crops, compresses and uploads art while creating an album', async () => {
    const created = { id: 8, title: 'The Bends', release_date: null, album_art_url: null }
    const withArt = { ...created, album_art_url: 'tenants/1/album-art/bends.webp' }
    createAlbum.mockResolvedValue(created)
    uploadAlbumArt.mockResolvedValue(withArt)
    const onChange = wrap()
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('Album'), 'The Bends')
    await user.click(await screen.findByText('Create album “The Bends”…'))
    const file = new File(['pixels'], 'cover.png', { type: 'image/png' })
    await user.upload(document.querySelector('input[type="file"][accept*="image/png"]'), file)
    await user.click(screen.getByText('Confirm crop'))
    await user.click(within(screen.getByRole('dialog', { name: 'Create album' }))
      .getByRole('button', { name: 'Create album' }))

    await waitFor(() => expect(uploadAlbumArt).toHaveBeenCalledWith(8, expect.any(File)))
    expect(compressAlbumArt).toHaveBeenCalledWith(expect.any(File))
    expect(onChange).toHaveBeenCalledWith(withArt)
  })
})
