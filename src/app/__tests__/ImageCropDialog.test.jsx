import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ImageCropDialog from '../../components/ImageCropDialog.tsx'

const cropHarness = vi.hoisted(() => ({ latestProps: null }))

vi.mock('react-image-crop', async (importOriginal) => {
  const actual = await importOriginal()

  return {
    ...actual,
    default: (props) => {
      cropHarness.latestProps = props
      return <div data-testid="crop-editor">{props.children}</div>
    },
  }
})

afterEach(() => {
  vi.restoreAllMocks()
  cropHarness.latestProps = null
})

function loadImage(width, height) {
  const image = document.querySelector('img')
  Object.defineProperties(image, {
    naturalWidth: { configurable: true, value: width },
    naturalHeight: { configurable: true, value: height },
  })
  fireEvent.load(image)
}

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

  it('initializes a full-image crop when no aspect ratio is requested', async () => {
    render(
      <ImageCropDialog
        open
        imageSrc="blob:https://gigbuddy.test/image"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    loadImage(1200, 600)

    await waitFor(() => {
      expect(cropHarness.latestProps.crop).toEqual({
        unit: '%',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      })
    })
  })

  it('initializes a centered crop constrained to the requested aspect ratio', async () => {
    render(
      <ImageCropDialog
        open
        imageSrc="blob:https://gigbuddy.test/image"
        aspect={1}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    loadImage(1200, 600)

    await waitFor(() => {
      expect(cropHarness.latestProps.crop).toEqual({
        unit: '%',
        x: 25,
        y: 0,
        width: 50,
        height: 100,
      })
    })
  })

  it('renders the completed crop to a PNG blob before confirming it', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const blob = new Blob(['cropped image'], { type: 'image/png' })
    const drawImage = vi.fn()
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage })
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(blob))

    render(
      <ImageCropDialog
        open
        imageSrc="blob:https://gigbuddy.test/image"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    )

    loadImage(1000, 500)
    act(() => {
      cropHarness.latestProps.onComplete(null, {
        unit: '%',
        x: 10,
        y: 20,
        width: 50,
        height: 40,
      })
    })

    await user.click(screen.getByRole('button', { name: 'Use this crop' }))

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith(blob)
    })
    expect(drawImage).toHaveBeenCalledWith(
      document.querySelector('img'),
      100,
      100,
      500,
      200,
      0,
      0,
      500,
      200,
    )
    expect(getContext).toHaveBeenCalledWith('2d')
    expect(toBlob.mock.instances[0]).toMatchObject({ width: 500, height: 200 })
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png')
  })
})
