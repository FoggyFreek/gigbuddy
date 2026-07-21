// National check-digit / control-character algorithms for VAT identification
// numbers, per the Invoice Compliance Validation FRS (FR-ID-003…008). The regex
// in shared/vatRates.js proves a number is structurally plausible; these prove
// it also satisfies its country's checksum, so a regex-valid but transposed /
// mistyped number is rejected rather than silently accepted (and then zeroed via
// the reverse charge). This is FORMAT+CHECKSUM validation only — it is NOT a
// VIES authority check (the number may be well-formed yet not registered).
//
// Each function receives the whitespace-stripped, UPPERCASED VAT id INCLUDING
// the country prefix (the same shape the regex matched) and returns a boolean.
//
// Countries deliberately left as format-only (no checksum here): NL — the
// post-2020 natural-person "btw-id" is random and does NOT satisfy the classic
// mod-11 that legal-entity numbers do, so enforcing mod-11 would reject valid
// sole-trader bands (our core users). Its structure is still regex-checked.

// Luhn (mod-10) over a digit string. Used for the French SIREN.
export function luhnValid(digits) {
  let sum = 0
  let double = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48
    if (d < 0 || d > 9) return false
    if (double) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
    double = !double
  }
  return sum % 10 === 0
}

// Digit sum of a small number (used where a doubled digit must be "cross-summed",
// e.g. 16 -> 7). For 0..18 this equals n>9 ? n-9 : n.
function crossSum(n) {
  return n > 9 ? n - 9 : n
}

// Belgium: BE + 10 digits (leading 0/1). The last two digits are 97 minus the
// first eight taken mod 97. The enterprise number IS these ten digits, so this
// same control covers the enterprise/VAT relationship (FR-ID-004).
export function checkBE(vat) {
  const n = vat.slice(2) // 10 digits
  const base = Number(n.slice(0, 8))
  const check = Number(n.slice(8, 10))
  return check === 97 - (base % 97)
}

// Germany: DE + 9 digits. ISO 7064 mod-11,10 iterative algorithm over the first
// eight digits yields the ninth (check) digit.
export function checkDE(vat) {
  const n = vat.slice(2)
  let product = 10
  for (let i = 0; i < 8; i++) {
    let sum = (Number(n[i]) + product) % 10
    if (sum === 0) sum = 10
    product = (sum * 2) % 11
  }
  let check = 11 - product
  if (check === 10) check = 0
  return check === Number(n[8])
}

// France: FR + 2-char key + 9-digit SIREN. The SIREN passes Luhn. When the key
// is fully numeric it equals (12 + 3*(SIREN mod 97)) mod 97; the newer
// alphanumeric key is not computable this way, so only the SIREN is checked then.
export function checkFR(vat) {
  const key = vat.slice(2, 4)
  const siren = vat.slice(4)
  if (!luhnValid(siren)) return false
  if (/^\d{2}$/.test(key)) {
    const expected = (12 + 3 * (Number(siren) % 97)) % 97
    return Number(key) === expected
  }
  return true // alphanumeric key: SIREN Luhn is the available control
}

// Italy: IT + 11 digits. Luhn-style control where odd 1-indexed positions count
// as-is and even positions are doubled then cross-summed; the 11th digit closes
// the sum to a multiple of ten.
export function checkIT(vat) {
  const n = vat.slice(2)
  let sum = 0
  for (let i = 0; i < 10; i++) {
    const d = Number(n[i])
    sum += (i % 2 === 0) ? d : crossSum(d * 2)
  }
  const check = (10 - (sum % 10)) % 10
  return check === Number(n[10])
}

// Austria: ATU + 8 digits. Weighted (1,2,1,2,1,2,1) cross-summed sum over the
// first seven digits; check digit = (96 - sum) mod 10.
export function checkAT(vat) {
  const n = vat.slice(3) // 8 digits after 'ATU'
  let sum = 0
  for (let i = 0; i < 7; i++) {
    const d = Number(n[i])
    sum += (i % 2 === 0) ? d : crossSum(d * 2)
  }
  const check = (96 - sum) % 10
  return check === Number(n[7])
}

// Luxembourg: LU + 8 digits. The first six digits taken mod 89 equal the last two.
export function checkLU(vat) {
  const n = vat.slice(2)
  return Number(n.slice(0, 6)) % 89 === Number(n.slice(6, 8))
}

const IE_CHECK_ALPHABET = 'WABCDEFGHIJKLMNOPQRSTUV' // remainder 0 -> 'W'

// Ireland: IE + body. Current forms are 7 digits + 1 check letter, or 7 digits +
// check letter + a second letter (group registrations). The legacy form
// (digit, letter/+/*, 5 digits, check letter) is canonicalised first. Control is
// a weighted (8..2) sum mod 23 mapped to the check-letter alphabet; the optional
// second letter contributes (its A=1.. index * 9).
export function checkIE(vat) {
  let body = vat.slice(2)
  // Legacy -> canonical: 0 + digits[2..6] + digits[0] + trailing check letter.
  if (/^\d[A-Z+*]\d{5}[A-W]$/.test(body)) {
    body = `0${body.slice(2, 7)}${body[0]}${body[7]}`
  }
  if (!/^\d{7}[A-W][A-Z]?$/.test(body)) return false
  let sum = 0
  for (let i = 0; i < 7; i++) sum += Number(body[i]) * (8 - i)
  if (body.length === 9) {
    // Second trailing letter: A=1..I? Uses full A=1..Z contribution * 9.
    sum += (body.charCodeAt(8) - 64) * 9
  }
  return IE_CHECK_ALPHABET[sum % 23] === body[7]
}

// GB / XI mod-97 (old) or mod-97 with +55 offset (new). Government-department
// (GD###) and health-authority (HA###) numbers carry no checksum. 12-digit
// branch numbers validate on their first nine digits; the branch suffix is free.
function checkGbNumeric(n) {
  const w = [8, 7, 6, 5, 4, 3, 2]
  let total = 0
  for (let i = 0; i < 7; i++) total += Number(n[i]) * w[i]
  total += Number(n.slice(7, 9)) // check pair as a two-digit number
  return total % 97 === 0 || (total + 55) % 97 === 0
}

export function checkGB(vat) {
  const n = vat.slice(2)
  if (/^(GD|HA)\d{3}$/.test(n)) return true // no checksum for gov/health ranges
  return checkGbNumeric(n.slice(0, 9))
}

// Northern Ireland shares the UK VAT-number algorithm; the prefix differs (XI).
export function checkXI(vat) {
  return checkGB(`GB${vat.slice(2)}`)
}

const ES_DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE'
const ES_CIF_CONTROL_LETTERS = 'JABCDEFGHI'

// The company (CIF) control: sum even-position digits, add cross-summed doubled
// odd-position digits, close to a multiple of ten. Returns that units digit.
function esCifControlDigit(sevenDigits) {
  let sum = 0
  for (let i = 0; i < 7; i++) {
    const d = Number(sevenDigits[i])
    sum += (i % 2 === 1) ? d : crossSum(d * 2) // 1-indexed even == 0-indexed odd
  }
  return (10 - (sum % 10)) % 10
}

// Spain (FR-ID-003): a genuine type-aware validator, NOT regex-only.
//   NIF (natural person): 8 digits + control letter (mod-23 letter table).
//   NIE (foreigner): X/Y/Z + 7 digits + control letter (X=0,Y=1,Z=2, then NIF rule).
//   CIF (entity): leading letter + 7 digits + control (a digit or a letter,
//   depending on the entity-type letter).
export function checkES(vat) {
  const id = vat.slice(2) // 9 chars
  // NIE: starts X/Y/Z.
  if (/^[XYZ]\d{7}[A-Z]$/.test(id)) {
    const num = String('XYZ'.indexOf(id[0])) + id.slice(1, 8)
    return ES_DNI_LETTERS[Number(num) % 23] === id[8]
  }
  // NIF (natural person): 8 digits + letter.
  if (/^\d{8}[A-Z]$/.test(id)) {
    return ES_DNI_LETTERS[Number(id.slice(0, 8)) % 23] === id[8]
  }
  // CIF (entity): letter + 7 digits + control char.
  if (/^[A-HJ-NP-SUVW]\d{7}[0-9A-J]$/.test(id)) {
    const control = esCifControlDigit(id.slice(1, 8))
    const last = id[8]
    // Some entity types use the control DIGIT, others the mapped control LETTER;
    // rather than branch on every leading-letter class we accept whichever form
    // the last character takes, as long as it matches the computed control.
    if (last >= '0' && last <= '9') return Number(last) === control
    return last === ES_CIF_CONTROL_LETTERS[control]
  }
  return false
}

// Dispatch table: country code -> checksum validator. Absent = format-only.
const CHECKERS = Object.freeze({
  be: checkBE,
  de: checkDE,
  fr: checkFR,
  it: checkIT,
  at: checkAT,
  lu: checkLU,
  ie: checkIE,
  gb: checkGB,
  xi: checkXI,
  es: checkES,
})

// True when the country has an algorithmic control beyond its regex.
export function hasVatChecksum(country) {
  return Object.hasOwn(CHECKERS, country)
}

// Runs the country's checksum if one exists; countries without one (nl) return
// true so the caller's regex result stands. `vat` must be prefix-included,
// whitespace-stripped and uppercased.
export function vatChecksumValid(country, vat) {
  const fn = CHECKERS[country]
  return fn ? fn(vat) : true
}
