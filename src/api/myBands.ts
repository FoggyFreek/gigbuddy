import { request } from './_client.ts'
import type { Id, MyBand, MyBandEventCounts } from '../types/entities.ts'
import type { LimitedCollectionResponse } from '../types/api.ts'
import type { BandProfileInput } from './bandProfiles.ts'

const api = <T = unknown>(path: string, options?: RequestInit) =>
  request<T>(`/api/my-bands${path}`, options)

export const listMyBands = () => api<LimitedCollectionResponse<MyBand>>('/')

/**
 * Takes either an existing profile id or a whole new profile. Creating and
 * holding are one server-side transaction, so this is a single call — a
 * create-then-add pair could be interrupted between its halves and leave a
 * global row nobody holds.
 */
export type AddMyBandBody =
  | { bandProfileId: Id }
  | { bandProfile: BandProfileInput }

export const addMyBand = (body: AddMyBandBody) =>
  api<MyBand>('/', { method: 'POST', body: JSON.stringify(body) })

/** What removing this band would touch. Read-only. */
export const getRemovalPreview = (id: Id) =>
  api<MyBandEventCounts>(`/${id}/removal-preview`)

/** `keep` unlinks the events, `delete` removes them. Never destructive by default. */
export type RemovalMode = 'keep' | 'delete'

export interface MyBandRemoval {
  removed: boolean
  mode: RemovalMode
  unlinked: MyBandEventCounts
  deleted: MyBandEventCounts
  /** True when that was the last holder and the global profile is now gone. */
  profileDeleted: boolean
}

export const removeMyBand = (id: Id, mode: RemovalMode = 'keep') =>
  api<MyBandRemoval>(`/${id}?mode=${mode}`, { method: 'DELETE' })
