const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function readSingle(query, key) {
  const value = query[key]
  return Array.isArray(value) ? value[0] : value
}

function parseIntParam(query, key) {
  const value = readSingle(query, key)
  if (value === undefined) return null
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : null
}

function isIsoDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false
  const date = new Date(`${value}T12:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function addMonths(year, month, count) {
  const date = new Date(Date.UTC(year, month - 1 + count, 1))
  return date.toISOString().slice(0, 10)
}

function padMonth(month) {
  return String(month).padStart(2, '0')
}

function rangeForQuery(query) {
  const mode = readSingle(query, 'mode')
  if (!mode || mode === 'all_time') return { range: null }

  if (mode === 'fiscal_year') {
    const year = parseIntParam(query, 'year')
    if (!year || year < 1) return { error: 'Invalid period year' }
    return { range: { from: `${year}-01-01`, toExclusive: `${year + 1}-01-01` } }
  }

  if (mode === 'month') {
    const year = parseIntParam(query, 'year')
    const month = parseIntParam(query, 'month')
    if (!year || year < 1 || month === null || month < 0 || month > 11) {
      return { error: 'Invalid period month' }
    }
    const sqlMonth = month + 1
    return {
      range: {
        from: `${year}-${padMonth(sqlMonth)}-01`,
        toExclusive: addMonths(year, sqlMonth, 1),
      },
    }
  }

  if (mode === 'quarter') {
    const year = parseIntParam(query, 'year')
    const quarter = parseIntParam(query, 'quarter')
    if (!year || year < 1 || !quarter || quarter < 1 || quarter > 4) {
      return { error: 'Invalid period quarter' }
    }
    const sqlMonth = (quarter - 1) * 3 + 1
    return {
      range: {
        from: `${year}-${padMonth(sqlMonth)}-01`,
        toExclusive: addMonths(year, sqlMonth, 3),
      },
    }
  }

  if (mode === 'custom') {
    const from = readSingle(query, 'from')
    const to = readSingle(query, 'to')
    if (!isIsoDate(from) || !isIsoDate(to) || from > to) {
      return { error: 'Invalid custom period' }
    }
    return { range: { from, toExclusive: nextDay(to) } }
  }

  return { error: 'Invalid period mode' }
}

function nextDay(isoDate) {
  const date = new Date(`${isoDate}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

export function buildPeriodWhere(query, columnSql, startIndex = 2) {
  const result = rangeForQuery(query)
  if (result.error) return { error: result.error }
  if (!result.range) return { sql: '', values: [] }

  return {
    sql: ` AND ${columnSql} >= $${startIndex}::date AND ${columnSql} < $${startIndex + 1}::date`,
    values: [result.range.from, result.range.toExclusive],
  }
}
