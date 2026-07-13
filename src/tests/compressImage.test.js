import { describe, expect, it, vi } from 'vitest'

const { imageCompression } = vi.hoisted(() => ({
  imageCompression: vi.fn(async (file) => file),
}))

vi.mock('browser-image-compression', () => ({ default: imageCompression }))

import { compressAvatar, compressBanner, compressReceipt } from '../utils/compressImage.ts'

describe('banner compression', () => {
  it('converts banners to a compact high-quality WebP', async () => {
    const file = new File(['banner'], 'banner.png', { type: 'image/png' })

    await compressBanner(file)

    expect(imageCompression).toHaveBeenCalledWith(file, {
      maxSizeMB: 0.5,
      maxWidthOrHeight: 820,
      initialQuality: 0.9,
      fileType: 'image/webp',
      useWebWorker: true,
    })
  })
})

describe('avatar compression', () => {
  it('converts avatars to a compact high-quality WebP', async () => {
    const file = new File(['avatar'], 'avatar.png', { type: 'image/png' })

    await compressAvatar(file)

    expect(imageCompression).toHaveBeenCalledWith(file, {
      maxSizeMB: 0.3,
      maxWidthOrHeight: 720,
      initialQuality: 0.9,
      fileType: 'image/webp',
      useWebWorker: true,
    })
  })
})

describe('compressReceipt', () => {
  it('uses the receipt-specific size and dimension limits', async () => {
    const file = new File(['receipt'], 'receipt.jpg', { type: 'image/jpeg' })

    await compressReceipt(file)

    expect(imageCompression).toHaveBeenCalledWith(file, expect.objectContaining({
      maxSizeMB: 1.5,
      maxWidthOrHeight: 2000,
      initialQuality: 0.85,
      useWebWorker: true,
    }))
  })

  it('preserves the original basename and gives the compressed file the MIME extension', async () => {
    const file = new File(['receipt'], '550e8400-e29b-41d4-a716-446655440000.tmp', { type: 'image/jpeg' })

    const compressed = await compressReceipt(file)

    expect(compressed.name).toBe('550e8400-e29b-41d4-a716-446655440000.jpg')
    expect(compressed.type).toBe('image/jpeg')
  })

  it('replaces a generic blob filename with a receipt UUID and MIME extension', async () => {
    const file = new File(['receipt'], 'blob', { type: 'image/png' })

    const compressed = await compressReceipt(file)

    expect(compressed.name).toMatch(/^receipt-[0-9a-f-]+\.png$/)
    expect(compressed.type).toBe('image/png')
  })
})
