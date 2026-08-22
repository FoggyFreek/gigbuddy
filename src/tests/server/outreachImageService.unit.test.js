// @vitest-environment node
import { Readable } from 'node:stream'
import sharp from 'sharp'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const repository = vi.hoisted(() => ({
  ensureOutreachImageToken: vi.fn(),
  resolveOutreachImageToken: vi.fn(),
}))
const profileRepository = vi.hoisted(() => ({ fetchProfileTenant: vi.fn() }))
const storage = vi.hoisted(() => ({
  getObject: vi.fn(),
  statObject: vi.fn(),
}))

vi.mock('../../../server/promotion/outreach/imageRepository.js', () => repository)
vi.mock('../../../server/people/profiles/profileRepository.js', () => profileRepository)
vi.mock('../../../server/platform/files/storageService.js', () => storage)

import { getOutreachImages, loadPublicOutreachImage } from '../../../server/promotion/outreach/imageService.js'

describe('outreach image service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.APP_URL = 'https://app.test'
    repository.ensureOutreachImageToken.mockResolvedValue('stable-token-abcdefghijklmnopqrstuvwxyz123456')
    profileRepository.fetchProfileTenant.mockResolvedValue({
      id: 7,
      kind: 'band',
      logo_path: 'tenants/7/logo/light.png',
      logo_dark_path: null,
      banner_path: 'tenants/7/banner/banner.png',
      avatar_path: 'tenants/7/avatar/avatar.webp',
      instagram_handle: 'test-band',
      facebook_handle: null,
      tiktok_handle: null,
      youtube_handle: null,
      spotify_handle: 'artist-id',
      bandsintown_artist_id: '15556138',
    })
  })

  it('returns stable branding URLs and merge-enabled social links without object keys', async () => {
    const result = await getOutreachImages({}, 7)

    expect(result.images).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'avatar', available: true,
        src: 'https://app.test/api/public/outreach/image/avatar?t=stable-token-abcdefghijklmnopqrstuvwxyz123456',
      }),
      expect.objectContaining({
        key: 'instagram', available: true,
        href: 'https://instagram.com/{{band.instagram_handle}}',
        whiteSrc: 'https://app.test/icons/socials/instagram-white.png',
      }),
      expect.objectContaining({ key: 'facebook', available: false }),
      expect.objectContaining({
        key: 'bandsintown', available: true,
        href: 'https://bandsintown.com/a/{{band.bandsintown_artist_id}}',
      }),
    ]))
    expect(JSON.stringify(result.images)).not.toContain('tenants/7/')
  })

  it('disables Bandsintown when the tenant kind lacks that capability', async () => {
    profileRepository.fetchProfileTenant.mockResolvedValue({
      kind: 'personal',
      bandsintown_artist_id: '15556138',
    })

    const result = await getOutreachImages({}, 7)

    expect(result.images.find((image) => image.key === 'bandsintown')).toMatchObject({ available: false })
  })

  it('renders the current avatar as a high-density circular PNG', async () => {
    const source = await sharp({
      create: { width: 20, height: 20, channels: 3, background: { r: 200, g: 20, b: 30 } },
    }).webp().toBuffer()
    repository.resolveOutreachImageToken.mockResolvedValue({
      tenant_id: 7,
      archived_at: null,
      deletion_status: null,
      avatar_path: 'tenants/7/avatar/avatar.webp',
    })
    storage.statObject.mockResolvedValue({ size: source.length, etag: 'avatar-etag', lastModified: new Date('2026-08-21T10:00:00Z') })
    storage.getObject.mockResolvedValue(Readable.from([source]))

    const result = await loadPublicOutreachImage({}, 'stable-token-abcdefghijklmnopqrstuvwxyz123456', 'avatar')
    const image = sharp(result.buffer)
    const metadata = await image.metadata()
    const { data, info } = await image.raw().ensureAlpha().toBuffer({ resolveWithObject: true })
    const topLeftAlpha = data[3]
    const centerAlpha = data[((Math.floor(info.height / 2) * info.width) + Math.floor(info.width / 2)) * 4 + 3]

    expect(metadata).toMatchObject({ format: 'png', width: 192, height: 192 })
    expect(topLeftAlpha).toBe(0)
    expect(centerAlpha).toBe(255)
    expect(result.contentType).toBe('image/png')
  })
})
