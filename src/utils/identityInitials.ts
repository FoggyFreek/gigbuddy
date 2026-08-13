/**
 * The two-letter stand-in for a band that has no avatar to show: the initials of
 * the first two words, or the first two letters of a single-word name. Shared so
 * a band reads the same in an overview row and on a detail view.
 */
export function identityInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return `${words[0][0]}${words[1][0]}`.toUpperCase()
}
