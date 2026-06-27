import { useCallback, useRef, useState } from 'react'
import type { ChangeEvent, RefObject } from 'react'

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

export interface ImageUploadConfig {
  compress: (file: File) => Promise<File>
  /** Uploads the cropped/compressed file and returns the new stored path. */
  upload: (file: File) => Promise<string | null>
  onError: (msg: string) => void
  allowedTypes: Set<string>
  /** `accept` attribute for the hidden file input. */
  accept: string
  /** Crop-dialog title. */
  title: string
  /** Crop aspect ratio; omit for a free crop. */
  aspect?: number
  /** Whether the current user may upload (gates the picker affordance). */
  canEdit?: boolean
}

export interface ImageUploadSlot extends ImageCropControls {
  path: string | null
  setPath: (path: string | null) => void
  inputRef: RefObject<HTMLInputElement | null>
  accept: string
  title: string
  aspect?: number
  openPicker: () => void
  /** Props for an `ImageSlot` consumer (e.g. ProfileIdentityCard). */
  cardProps: { path: string | null; uploading: boolean; onUploadClick?: () => void }
}

/**
 * Bundles the full per-slot image-upload concern: the hidden file input ref,
 * the stored path state, the crop-dialog lifecycle (via {@link useImageCrop}),
 * and the picker opener — so a page with several upload slots renders them by
 * mapping over the returned slots instead of repeating the wiring each time.
 */
export function useImageUpload(cfg: ImageUploadConfig): ImageUploadSlot {
  const inputRef = useRef<HTMLInputElement>(null)
  const [path, setPath] = useState<string | null>(null)
  const crop = useImageCrop(
    cfg.compress,
    async (file) => { setPath(await cfg.upload(file)) },
    cfg.onError,
    cfg.allowedTypes,
  )
  const openPicker = useCallback(() => inputRef.current?.click(), [])
  return {
    ...crop,
    path,
    setPath,
    inputRef,
    accept: cfg.accept,
    title: cfg.title,
    aspect: cfg.aspect,
    openPicker,
    cardProps: {
      path,
      uploading: crop.uploading,
      onUploadClick: cfg.canEdit ? openPicker : undefined,
    },
  }
}
