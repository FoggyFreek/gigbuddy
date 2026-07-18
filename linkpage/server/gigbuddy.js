// The only integration point with GigBuddy: pulling a band's content export
// over HTTP with the shared-secret bearer. See README.md for the contract.

export async function fetchExport(slug) {
  const base = (process.env.GIGBUDDY_URL || '').replace(/\/$/, '')
  if (!base || !process.env.GIGBUDDY_SYNC_SECRET) {
    throw new Error('GIGBUDDY_URL / GIGBUDDY_SYNC_SECRET are not configured')
  }
  const res = await fetch(`${base}/api/public/linkpage/export/${encodeURIComponent(slug)}`, {
    headers: { authorization: `Bearer ${process.env.GIGBUDDY_SYNC_SECRET}` },
  })
  if (res.status === 404) return { notFound: true }
  if (!res.ok) throw new Error(`GigBuddy export failed with status ${res.status}`)
  return { content: await res.json() }
}
