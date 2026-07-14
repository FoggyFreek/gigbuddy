import imageCompression, { type Options } from 'browser-image-compression'

const PHOTO_OPTIONS: Options = {
  maxSizeMB: 0.9,
  maxWidthOrHeight: 1200,
  initialQuality: 0.85,
  useWebWorker: true,
}

const LOGO_OPTIONS: Options = {
  maxSizeMB: 0.8,
  maxWidthOrHeight: 800,
  initialQuality: 0.9,
  useWebWorker: true,
}

export function compressPhoto(file: File): Promise<File> {
  return imageCompression(file, PHOTO_OPTIONS)
}

// The dashboard memory tile stores its photo long-term, so encode to WebP for a
// smaller footprint (the server re-encode preserves the uploaded MIME type).
const MEMORY_PHOTO_OPTIONS: Options = {
  maxSizeMB: 0.9,
  maxWidthOrHeight: 1600,
  initialQuality: 0.85,
  fileType: 'image/webp',
  useWebWorker: true,
}

export function compressMemoryPhoto(file: File): Promise<File> {
  return imageCompression(file, MEMORY_PHOTO_OPTIONS)
}

export function compressLogo(file: File): Promise<File> {
  if (file.type === 'image/gif') {
    return Promise.reject(new Error('File type not allowed'))
  }
  return imageCompression(file, LOGO_OPTIONS)
}

const BANNER_OPTIONS: Options = {
  maxSizeMB: 0.5,
  maxWidthOrHeight: 820,
  initialQuality: 0.9,
  fileType: 'image/webp',
  useWebWorker: true,
}

export function compressBanner(file: File): Promise<File> {
  return imageCompression(file, BANNER_OPTIONS)
}

const AVATAR_OPTIONS: Options = {
  maxSizeMB: 0.3,
  maxWidthOrHeight: 720,
  initialQuality: 0.9,
  fileType: 'image/webp',
  useWebWorker: true,
}

export function compressAvatar(file: File): Promise<File> {
  return imageCompression(file, AVATAR_OPTIONS)
}

const RECEIPT_OPTIONS: Options = {
  maxSizeMB: 1.5,
  maxWidthOrHeight: 2000,
  initialQuality: 0.85,
  useWebWorker: true,
}

const RECEIPT_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
}

function receiptFilename(file: File, mimetype: string): string {
  const originalBase = file.name.replace(/\.[^.]+$/, '') || 'receipt'
  const base = originalBase.toLowerCase() === 'blob'
    ? `receipt-${crypto.randomUUID()}`
    : originalBase
  const extension = RECEIPT_EXTENSIONS[mimetype] ?? 'bin'
  return `${base}.${extension}`
}

export async function compressReceipt(file: File): Promise<File> {
  const compressed = await imageCompression(file, RECEIPT_OPTIONS)
  const mimetype = compressed.type || file.type
  return new File([compressed], receiptFilename(file, mimetype), {
    type: mimetype,
    lastModified: file.lastModified,
  })
}
