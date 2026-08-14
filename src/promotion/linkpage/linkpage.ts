import { request } from '../../api/_client.ts'

export interface LinkpageStatus {
  configured: boolean
  publicUrl: string | null
  linkpageSync?: 'synced' | 'pending'
}

export interface LinkpageHandoff {
  url: string
}

/** Click kinds the link page records, keyed by the part of the target before the colon. */
export type LinkpageClickKind = 'platform' | 'song' | 'link' | 'embed' | 'share' | 'social' | 'shop' | 'other'

export interface LinkpageStatsDay {
  /** Local day bucket, `YYYY-MM-DD`. */
  day: string
  views: number
  /** Outbound clicks for that day, per kind; kinds with no clicks are absent. */
  clicks: Partial<Record<LinkpageClickKind, number>>
}

/** One of the tenant's link pages, as the picker needs it. */
export interface LinkpagePage {
  id: number
  /** Public path segment(s): `band` for the main page, `band/release` for a release. */
  slug: string
  pageType: 'main' | 'release'
  /** Release title when the page is a release landing page, else null. */
  title: string | null
  published: boolean
}

/** The link page exists and reported its numbers. */
export interface LinkpageStatsSummary {
  hasPage: true
  /** Which page these numbers belong to — the main page unless one was asked for. */
  pageId: number
  slug: string
  /** The window actually served, which the plan's retention can shrink. */
  days: number
  retentionDays: number
  /** False when the link page app has visit collection switched off. */
  enabled: boolean
  totalViews: number
  uniqueVisits: number
  totalClicks: number
  /** Percentage, or null when there were no views to divide by. */
  clickThroughRate: number | null
  byDay: LinkpageStatsDay[]
}

/** The tenant is entitled to a link page but has not created one yet. */
export interface LinkpageStatsAbsent {
  hasPage: false
}

export type LinkpageStats = LinkpageStatsSummary | LinkpageStatsAbsent

/** Windows the tile offers; the backend refuses anything else. */
export const LINKPAGE_STATS_WINDOWS = [7, 30] as const
export type LinkpageStatsWindow = (typeof LINKPAGE_STATS_WINDOWS)[number]

const api = <T = unknown>(path: string, options?: RequestInit) =>
  request<T>(`/api/linkpage${path}`, options)

export const getLinkpageStatus = () => api<LinkpageStatus>('/status')
export const createLinkpageHandoff = () => api<LinkpageHandoff>('/handoff', { method: 'POST' })
export const getLinkpageStats = (days: LinkpageStatsWindow, pageId: number | null = null) =>
  api<LinkpageStats>(`/stats?days=${days}${pageId === null ? '' : `&pageId=${pageId}`}`)
export const listLinkpagePages = () => api<{ pages: LinkpagePage[] }>('/pages')
