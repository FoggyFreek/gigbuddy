import { useState } from 'react'
import type { ChangeEvent } from 'react'

export interface ImageCropControls {
  uploading: boolean
  cropOpen: boolean
  cropSrc: string | null
  handleFileChange: (e: ChangeEvent<HTMLInputElement>) => void
  handleCropConfirm: (blob: Blob) => Promise<void>
  handleCropCancel: () => void
}

export const JPEG_PNG = new Set(['image/jpeg', 'image/png'])
export const JPEG_PNG_WEBP = new Set(['image/jpeg', 'image/png', 'image/webp'])

/**
 * Manages the crop-dialog lifecycle for an image upload slot.
 * The caller owns the file input element (ref + onChange) and the resulting
 * path state. This hook only handles the crop modal and upload progress.
 */
export function useImageCrop(
  compress: (file: File) => Promise<File>,
  upload: (file: File) => Promise<void>,
  onError: (msg: string) => void,
  allowedTypes?: Set<string>,
): ImageCropControls {
  const [uploading, setUploading] = useState(false)
  const [cropOpen, setCropOpen] = useState(false)
  const [cropSrc, setCropSrc] = useState<string | null>(null)

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    if (allowedTypes && !allowedTypes.has(file.type)) {
      onError('File type not allowed')
      return
    }
    setCropSrc(URL.createObjectURL(file))
    setCropOpen(true)
  }

  async function handleCropConfirm(blob: Blob) {
    setCropOpen(false)
    if (cropSrc) URL.revokeObjectURL(cropSrc)
    setCropSrc(null)
    setUploading(true)
    try {
      const file = blob instanceof File ? blob : new File([blob], 'image', { type: blob.type })
      const compressed = await compress(file)
      await upload(compressed)
    } catch (err: unknown) {
      onError((err instanceof Error ? err.message : null) ?? 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  function handleCropCancel() {
    setCropOpen(false)
    if (cropSrc) URL.revokeObjectURL(cropSrc)
    setCropSrc(null)
  }

  return { uploading, cropOpen, cropSrc, handleFileChange, handleCropConfirm, handleCropCancel }
}
