const TOKEN_PATTERN = /{{\s*(#?[^{}\s]+)\s*}}/g

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function extractTokens(input = '') {
  const tokens = []
  const seen = new Set()
  for (const match of String(input).matchAll(TOKEN_PATTERN)) {
    if (!seen.has(match[1])) {
      seen.add(match[1])
      tokens.push(match[1])
    }
  }
  return tokens
}

export function mergeTokens(input = '', values = {}, { escape = false } = {}) {
  return String(input).replace(TOKEN_PATTERN, (original, token) => {
    if (token.startsWith('#')) return original
    const value = values[token]
    if (value === undefined || value === null) return original
    return escape ? escapeHtml(value) : String(value)
  })
}

export function mergeBlocks(html = '', blocks = {}) {
  return String(html).replace(TOKEN_PATTERN, (original, token) => {
    if (!token.startsWith('#')) return original
    const value = blocks[token.slice(1)]
    return value === undefined || value === null ? '' : String(value)
  })
}

export function findUnresolvable(tokens, values = {}) {
  return tokens.filter((token) => {
    const key = token.replace(/^#/, '')
    return values[key] === undefined || values[key] === null || values[key] === ''
  })
}
