import { request } from './_client.ts'

// Records that the current user dismissed a tutorial (per-user, global). The key
// is a stable slug from the tutorial registry (src/tutorials/registry.tsx).
export function dismissTutorial(key: string): Promise<void> {
  return request<void>(`/api/tutorials/${key}/dismiss`, { method: 'POST' })
}
