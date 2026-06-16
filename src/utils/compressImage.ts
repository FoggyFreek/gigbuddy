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

export function compressLogo(file: File): Promise<File> {
  if (file.type === 'image/gif') {
    return Promise.reject(new Error('File type not allowed'))
  }
  return imageCompression(file, LOGO_OPTIONS)
}

const BANNER_OPTIONS: Options = {
  maxSizeMB: 1,
  maxWidthOrHeight: 820,
  initialQuality: 0.88,
  useWebWorker: true,
}

export function compressBanner(file: File): Promise<File> {
  return imageCompression(file, BANNER_OPTIONS)
}

const AVATAR_OPTIONS: Options = {
  maxSizeMB: 2,
  maxWidthOrHeight: 720,
  initialQuality: 0.9,
  useWebWorker: true,
}

export function compressAvatar(file: File): Promise<File> {
  return imageCompression(file, AVATAR_OPTIONS)
}
