// Input parsing for the tutorial routes. No DB access here.

// Tutorial keys are stable slugs defined by the frontend registry
// (src/tutorials/registry.tsx). The server accepts any well-formed key so a new
// tutorial can ship without a backend change; the key's meaning lives on the
// client.
const TUTORIAL_KEY = /^[a-z0-9_-]{1,64}$/

export function parseTutorialKey(value) {
  return typeof value === 'string' && TUTORIAL_KEY.test(value) ? value : null
}
