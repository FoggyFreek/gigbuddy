// One email shape for the whole backend. Deliberately permissive: the only
// things it rules out are the ones that break downstream — whitespace, angle
// brackets (which would let a value forge an address in a mail header), a
// missing @, and a domain without a dot.
//
// Full RFC 5322 validation is not the goal and never has been; deliverability
// is proven by sending, not by a regex.
export const EMAIL_RE = /^[^\s@<>]+@[^.\s@<>]+(?:\.[^.\s@<>]+)+$/

export const MAX_EMAIL_LENGTH = 254

export function isValidEmail(value) {
  return typeof value === 'string' && value.length <= MAX_EMAIL_LENGTH && EMAIL_RE.test(value)
}
