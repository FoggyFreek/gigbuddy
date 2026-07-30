const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

function pad(value) {
  return String(value).padStart(2, '0')
}

// Highest day that exists in `month` in EVERY year — February caps at 28, so a
// fiscal year can never start on a date some years lack. Mirrors the
// tap_financial_year_start_valid CHECK (migration 137) and maxDayForMonth in
// accountingProfileValidators; all three must agree.
function maxDayForMonth(month) {
  if (month === 2) return 28
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30
  return 31
}

function assertStart(start) {
  const month = Number(start?.month)
  const day = Number(start?.day)
  if (!Number.isInteger(month) || month < 1 || month > 12
    || !Number.isInteger(day) || day < 1 || day > maxDayForMonth(month)) {
    throw new RangeError('Invalid fiscal-year start')
  }
  return { month, day }
}

// Fiscal years are labelled by the calendar year in which they start. Ranges
// use an exclusive upper bound so they can be passed directly to SQL.
export function fiscalYearRange(startYear, start) {
  const year = Number(startYear)
  if (!Number.isInteger(year) || year < 1) throw new RangeError('Invalid fiscal year')
  const { month, day } = assertStart(start)
  const suffix = `${pad(month)}-${pad(day)}`
  return {
    from: `${year}-${suffix}`,
    toExclusive: `${year + 1}-${suffix}`,
  }
}

export function fiscalYearForDate(date, start) {
  const match = ISO_DATE_RE.exec(String(date).slice(0, 10))
  if (!match) throw new RangeError('Invalid date')
  const year = Number(match[1])
  const { month, day } = assertStart(start)
  const boundary = `${match[1]}-${pad(month)}-${pad(day)}`
  return String(date).slice(0, 10) < boundary ? year - 1 : year
}

export function currentFiscalYear(start, today = new Date().toISOString().slice(0, 10)) {
  return fiscalYearForDate(today, start)
}

export function fiscalYearLabel(startYear) {
  return `FY ${startYear}`
}
