import { createHash, randomBytes } from 'node:crypto'
import sharp from 'sharp'
import { notFound } from '../../platform/http/serviceErrors.js'
import { getObject, statObject } from '../../platform/files/storageService.js'
import { fetchProfileTenant } from '../../people/profiles/profileRepository.js'
import { TENANT_CAPABILITIES, tenantKindSupports } from '../../../shared/tenantCapabilities.js'
import { ensureOutreachImageToken, resolveOutreachImageToken } from './imageRepository.js'

const NOT_FOUND = notFound('Not found')
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/
const AVATAR_SIZE = 192
const AVATAR_CACHE_LIMIT = 50
const avatarCache = new Map()
const avatarTasks = new Map()

const BRANDING = Object.freeze([
  { key: 'banner', path: 'banner_path', defaultWidth: '600', defaultHeight: 'auto' },
  { key: 'logo-light', path: 'logo_path', defaultWidth: '200', defaultHeight: 'auto' },
  { key: 'logo-dark', path: 'logo_dark_path', defaultWidth: '200', defaultHeight: 'auto' },
  { key: 'avatar', path: 'avatar_path', defaultWidth: '96', defaultHeight: '96' },
])

const SOCIALS = Object.freeze([
  { key: 'facebook', field: 'facebook_handle', href: 'https://facebook.com/{{band.facebook_handle}}' },
  { key: 'instagram', field: 'instagram_handle', href: 'https://instagram.com/{{band.instagram_handle}}' },
  { key: 'tiktok', field: 'tiktok_handle', href: 'https://tiktok.com/@{{band.tiktok_handle}}' },
  { key: 'youtube', field: 'youtube_handle', href: 'https://youtube.com/{{band.youtube_handle}}' },
  { key: 'spotify', field: 'spotify_handle', href: 'https://open.spotify.com/artist/{{band.spotify_handle}}' },
  {
    key: 'bandsintown',
    field: 'bandsintown_artist_id',
    href: 'https://bandsintown.com/a/{{band.bandsintown_artist_id}}',
    capability: TENANT_CAPABILITIES.BAND_PROMOTION_INTEGRATIONS,
  },
])

const SLOT_PATHS = Object.freeze(Object.fromEntries(BRANDING.map((item) => [item.key, item.path])))

function appUrl() {
  return (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '')
}

function stableEtag(objectKey, storageEtag = '') {
  return `"${createHash('sha256').update(`${objectKey}:${storageEtag}`).digest('base64url')}"`
}

async function streamBuffer(stream) {
  const chunks = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

function rememberAvatar(objectKey, buffer) {
  avatarCache.delete(objectKey)
  avatarCache.set(objectKey, buffer)
  while (avatarCache.size > AVATAR_CACHE_LIMIT) {
    avatarCache.delete(avatarCache.keys().next().value)
  }
  return buffer
}

async function renderCircularAvatar(objectKey) {
  const cached = avatarCache.get(objectKey)
  if (cached) {
    avatarCache.delete(objectKey)
    avatarCache.set(objectKey, cached)
    return cached
  }
  const pending = avatarTasks.get(objectKey)
  if (pending) return pending
  const task = (async () => {
    const source = await streamBuffer(await getObject(objectKey))
    const mask = Buffer.from(
      `<svg width="${AVATAR_SIZE}" height="${AVATAR_SIZE}"><circle cx="${AVATAR_SIZE / 2}" cy="${AVATAR_SIZE / 2}" r="${AVATAR_SIZE / 2}" fill="white"/></svg>`,
    )
    const buffer = await sharp(source)
      .rotate()
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'centre' })
      .ensureAlpha()
      .composite([{ input: mask, blend: 'dest-in' }])
      .png()
      .toBuffer()
    return rememberAvatar(objectKey, buffer)
  })()
  avatarTasks.set(objectKey, task)
  try {
    return await task
  } finally {
    avatarTasks.delete(objectKey)
  }
}

export async function getOutreachImages(db, tenantId) {
  const [tenant, token] = await Promise.all([
    fetchProfileTenant(db, tenantId),
    ensureOutreachImageToken(db, tenantId, randomBytes(32).toString('base64url')),
  ])
  if (!tenant) return NOT_FOUND
  const base = appUrl()
  const images = [
    ...BRANDING.map((item) => ({
      key: item.key,
      category: 'branding',
      available: Boolean(tenant[item.path]),
      src: `${base}/api/public/outreach/image/${item.key}?t=${encodeURIComponent(token)}`,
      defaultWidth: item.defaultWidth,
      defaultHeight: item.defaultHeight,
    })),
    ...SOCIALS.map((item) => ({
      key: item.key,
      category: 'social',
      available: Boolean(tenant[item.field])
        && (!item.capability || tenantKindSupports(tenant.kind, item.capability)),
      src: `${base}/icons/socials/${item.key}.png`,
      whiteSrc: `${base}/icons/socials/${item.key}-white.png`,
      href: item.href,
      defaultWidth: '32',
      defaultHeight: '32',
    })),
  ]
  return { images }
}

export async function loadPublicOutreachImage(db, token, slot) {
  if (!TOKEN_PATTERN.test(String(token ?? '')) || !Object.hasOwn(SLOT_PATHS, slot)) return NOT_FOUND
  const context = await resolveOutreachImageToken(db, token)
  if (!context || context.archived_at || context.deletion_status) return NOT_FOUND
  const objectKey = context[SLOT_PATHS[slot]]
  if (!objectKey) return NOT_FOUND
  try {
    const stat = await statObject(objectKey)
    const etag = stableEtag(objectKey, stat.etag)
    const lastModified = stat.lastModified instanceof Date ? stat.lastModified : null
    if (slot === 'avatar') {
      const buffer = await renderCircularAvatar(objectKey)
      return { buffer, contentType: 'image/png', contentLength: buffer.length, etag, lastModified }
    }
    return {
      stream: await getObject(objectKey),
      contentType: stat.metaData?.['content-type'] || 'application/octet-stream',
      contentLength: stat.size,
      etag,
      lastModified,
    }
  } catch {
    return NOT_FOUND
  }
}
