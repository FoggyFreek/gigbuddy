import { describe, it, expect } from 'vitest'
import { classifyDevice, classifySource, resolveCountry, visitorHash } from '../server/classify.js'

const CHROME_DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36'
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
const IPAD =
  'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
const ANDROID_PHONE = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36'
const ANDROID_TABLET = 'Mozilla/5.0 (Linux; Android 14; SM-X910) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36'

describe('classifyDevice', () => {
  it('classifies desktop, phone and tablet user agents', () => {
    expect(classifyDevice(CHROME_DESKTOP)).toBe('desktop')
    expect(classifyDevice(IPHONE)).toBe('mobile')
    expect(classifyDevice(ANDROID_PHONE)).toBe('mobile')
    expect(classifyDevice(IPAD)).toBe('tablet')
    expect(classifyDevice(ANDROID_TABLET)).toBe('tablet')
  })

  it('flags crawlers and link preview bots', () => {
    expect(classifyDevice('Mozilla/5.0 (compatible; Googlebot/2.1)')).toBe('bot')
    expect(classifyDevice('facebookexternalhit/1.1')).toBe('bot')
    expect(classifyDevice('WhatsApp/2.23.20')).toBe('bot')
  })

  it('handles missing agents', () => {
    expect(classifyDevice(undefined)).toBe('unknown')
    expect(classifyDevice('')).toBe('unknown')
  })
})

describe('classifySource', () => {
  it('prefers a sane utm_source', () => {
    expect(classifySource('https://facebook.com/some/post', 'newsletter', 'link.example.com')).toBe('newsletter')
  })

  it('rejects garbage utm values and falls back to the referrer host', () => {
    expect(classifySource('https://www.facebook.com/some/post?fbclid=secret', 'a b<script>', 'link.example.com')).toBe(
      'facebook.com',
    )
  })

  it('never keeps referrer paths or queries', () => {
    const source = classifySource('https://instagram.com/private-profile?user=jan', null, null)
    expect(source).toBe('instagram.com')
  })

  it('treats own-host referrers and missing referrers as direct', () => {
    expect(classifySource('https://link.example.com/theband', null, 'link.example.com')).toBe('direct')
    expect(classifySource('', null, 'link.example.com')).toBe('direct')
    expect(classifySource('not a url', null, null)).toBe('direct')
  })
})

describe('resolveCountry', () => {
  it('reads CDN geo headers case-insensitively and uppercases', () => {
    const headers = { 'cf-ipcountry': 'nl' }
    expect(resolveCountry((name) => headers[name])).toBe('NL')
  })

  it('falls back to unknown without trusted headers', () => {
    expect(resolveCountry(() => undefined)).toBe('unknown')
    expect(resolveCountry(() => 'XX')).toBe('unknown')
    expect(resolveCountry(() => 'Netherlands')).toBe('unknown')
  })
})

describe('visitorHash', () => {
  it('is stable within a day but rotates across days', () => {
    const day1 = new Date('2026-07-18T10:00:00Z')
    const day1b = new Date('2026-07-18T22:00:00Z')
    const day2 = new Date('2026-07-19T10:00:00Z')
    const a = visitorHash('203.0.113.9', IPHONE, 'secret', day1)
    expect(visitorHash('203.0.113.9', IPHONE, 'secret', day1b)).toBe(a)
    expect(visitorHash('203.0.113.9', IPHONE, 'secret', day2)).not.toBe(a)
  })

  it('never contains the raw ip and stays short', () => {
    const hash = visitorHash('203.0.113.9', IPHONE, 'secret')
    expect(hash).not.toContain('203')
    expect(hash.length).toBeLessThanOrEqual(16)
  })

  it('is null when there is nothing to hash', () => {
    expect(visitorHash('', '', 'secret')).toBeNull()
  })
})
