import imageCompression from 'browser-image-compression'

const PHOTO_OPTIONS = {
  maxSizeMB: 0.9,
  maxWidthOrHeight: 1200,
  initialQuality: 0.85,
  useWebWorker: true,
}

const LOGO_OPTIONS = {
  maxSizeMB: 0.8,
  maxWidthOrHeight: 800,
  initialQuality: 0.9,
  useWebWorker: true,
}

export function compressPhoto(file) {
  return imageCompression(file, PHOTO_OPTIONS)
}

export function compressLogo(file) {
  if (file.type === 'image/gif') {
    return Promise.reject(new Error('File type not allowed'))
  }
  return imageCompression(file, LOGO_OPTIONS)
}
