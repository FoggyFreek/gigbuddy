import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ImageCropDialog from '../../components/ImageCropDialog.tsx'

describe('ImageCropDialog', () => {
  it('does not render an image when no crop source is available', () => {
    render(
      <ImageCropDialog
        open
        imageSrc={null}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(document.querySelector('img')).toBeNull()
  })

  it('renders the selected image when a crop source is available', () => {
    render(
      <ImageCropDialog
        open
        imageSrc="blob:https://gigbuddy.test/image"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(document.querySelector('img')).toHaveAttribute(
      'src',
      'blob:https://gigbuddy.test/image',
    )
  })
})
