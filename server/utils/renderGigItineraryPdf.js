// Renders a gig's itinerary — the one-page summary a band sends round before
// the show — to an A4 PDF. Same pdfkit conventions as renderInvoicePdf.js and
// renderFinancialReportPdf.js: buffered output, manual y cursor, A4 margins.
//
// Everything it prints is passed in; it reads no database and derives no
// business values, so it stays a pure function of the gig snapshot it is given.
import PDFDocument from 'pdfkit'
import { createDocumentI18n, documentIntlLocale } from './documentI18n.js'
import { isGigInfoLabelKey } from '../../shared/gigInfoLabels.js'

const getItineraryT = createDocumentI18n('itinerary')

const PAGE_MARGIN = 48
const PAGE_W = 595.28 // A4 width in points
const USABLE_W = PAGE_W - 2 * PAGE_MARGIN
const RIGHT_EDGE = PAGE_W - PAGE_MARGIN

// The header splits in two: the band's mark on the left, the event on the right.
const HEADER_LEFT_W = 200
const HEADER_GUTTER = 16
const HEADER_RIGHT_X = PAGE_MARGIN + HEADER_LEFT_W + HEADER_GUTTER
const HEADER_RIGHT_W = USABLE_W - HEADER_LEFT_W - HEADER_GUTTER
const HEADER_MARK_H = 55

// Event Information is a label/value grid; the rest run full width.
const LABEL_W = 110
const VALUE_X = PAGE_MARGIN + LABEL_W
const VALUE_W = USABLE_W - LABEL_W

// Tasks and timetable lines each get one row, never wrapping (see drawOneLine).
const CHECKBOX_SIZE = 9
const TIME_COL_W = 95
const TASK_STATE_W = 190

const INK = '#000000'
const MUTED = '#555555'
const RULE = '#cccccc'
const HEADING_RULE = '#999999'

// ─── helpers ─────────────────────────────────────────────────────────────────

function bufferDocument(doc) {
  return new Promise((resolve, reject) => {
    const chunks = []
    doc.on('data', (c) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })
}

function hline(doc, y, color = RULE) {
  doc.moveTo(PAGE_MARGIN, y).lineTo(RIGHT_EDGE, y).strokeColor(color).lineWidth(0.5).stroke()
}

// Starts a new page when fewer than `needed` points remain; returns current y.
function ensureSpace(doc, y, needed) {
  if (y + needed <= doc.page.height - PAGE_MARGIN) return y
  doc.addPage()
  return PAGE_MARGIN
}

function sectionTitle(doc, y, title) {
  y = ensureSpace(doc, y, 60)
  doc.fontSize(13).font('Helvetica-Bold').fillColor(INK)
  doc.text(title, PAGE_MARGIN, y)
  hline(doc, y + 18, HEADING_RULE)
  return y + 28
}

// A DATE column arrives as 'YYYY-MM-DD' (see server/db/index.js), so it is
// formatted in UTC — reading it in the server's zone would shift the day.
function fmtDate(value, locale, opts = {}) {
  if (!value) return null
  const iso = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleDateString(locale, {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC', ...opts,
  })
}

// A TIME column arrives as 'HH:MM:SS'; the itinerary only ever shows HH:MM.
function fmtTime(value) {
  if (!value) return null
  const text = String(value).trim()
  return text ? text.slice(0, 5) : null
}

function timeRange(start, end, t) {
  const from = fmtTime(start)
  const until = fmtTime(end)
  if (from && until) return `${from} – ${until}`
  return from || until || t('notSet')
}

// One row that must stay on a single line whatever the content — pdfkit
// truncates with an ellipsis instead of wrapping onto a second line.
function drawOneLine(doc, text, x, y, width, options = {}) {
  const { size = 9, font = 'Helvetica', color = INK, align = 'left' } = options
  doc.fontSize(size).font(font).fillColor(color)
  doc.text(text, x, y, { width, align, lineBreak: false, ellipsis: true })
}

// Vector-drawn so the mark does not depend on a glyph the standard PDF fonts
// lack: an empty square for an open task, a ticked one for a completed task.
function drawCheckbox(doc, x, y, done) {
  doc.save()
  doc.roundedRect(x, y, CHECKBOX_SIZE, CHECKBOX_SIZE, 1.5)
    .lineWidth(0.8).strokeColor(done ? INK : HEADING_RULE).stroke()
  if (done) {
    doc.moveTo(x + 2, y + CHECKBOX_SIZE / 2)
      .lineTo(x + CHECKBOX_SIZE / 2 - 0.5, y + CHECKBOX_SIZE - 2.5)
      .lineTo(x + CHECKBOX_SIZE - 1.5, y + 2)
      .lineWidth(1.2).strokeColor(INK).stroke()
  }
  doc.restore()
}

// The block's own label: a canonical key is translated, a user-typed one is
// printed verbatim (shared/gigInfoLabels.js owns that distinction).
function infoBlockLabel(block, t) {
  if (!block.label_is_custom && isGigInfoLabelKey(block.label)) return t(`infoLabels.${block.label}`)
  return block.label
}

function placeLines(place) {
  if (!place) return []
  return [
    place.name,
    place.organization_name,
    place.street_and_number,
    [place.postal_code, place.city].filter(Boolean).join(' '),
    place.region,
    place.country,
  ].map((line) => (typeof line === 'string' ? line.trim() : line)).filter(Boolean)
}

// ─── main ────────────────────────────────────────────────────────────────────

export async function renderGigItineraryPdf({
  gig,
  contacts = [],
  tasks = [],
  timetable = [],
  infoBlocks = [],
  logoBuffer = null,
  bandName = '',
  lng = 'en',
}) {
  const t = getItineraryT(lng)
  const locale = documentIntlLocale(lng)
  const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN })
  const done = bufferDocument(doc)

  let y = drawHeader(doc, gig, { logoBuffer, bandName }, { t, locale })
  y = drawEventInformation(doc, gig, y, { t, locale })
  y = drawContacts(doc, contacts, y, { t })
  y = drawTasks(doc, tasks, y, { t, locale })
  y = drawTimetable(doc, timetable, y, { t })
  drawAdditionalInformation(doc, infoBlocks, y, { t })

  doc.end()
  return done
}

// ─── header ──────────────────────────────────────────────────────────────────
// The band's mark top-left, the event name and date right-aligned beside it.

// The band's logo if it has one. Returns false when there is nothing to draw or
// the bytes turn out not to be an image, so the caller can fall back to type.
function drawLogo(doc, logoBuffer, y) {
  if (!logoBuffer) return false
  try {
    doc.image(logoBuffer, PAGE_MARGIN, y, { fit: [HEADER_LEFT_W, HEADER_MARK_H] })
    return true
  } catch {
    // A corrupt logo must not cost the whole document.
    return false
  }
}

// Without a logo the band still has to sign the document, so its name takes the
// logo's place, set large and clipped to the same slot.
function drawBandName(doc, bandName, y) {
  const name = (bandName || '').trim()
  if (!name) return
  doc.fontSize(18).font('Helvetica-Bold').fillColor(INK)
  doc.text(name, PAGE_MARGIN, y, {
    width: HEADER_LEFT_W, height: HEADER_MARK_H, ellipsis: true,
  })
}

function drawHeader(doc, gig, { logoBuffer, bandName }, { t, locale }) {
  const y = PAGE_MARGIN

  if (!drawLogo(doc, logoBuffer, y)) drawBandName(doc, bandName, y)

  const eventName = (gig.event_description || '').trim() || t('eventFallback')
  doc.fontSize(16).font('Helvetica-Bold').fillColor(INK)
  doc.text(eventName, HEADER_RIGHT_X, y, { width: HEADER_RIGHT_W, align: 'right' })
  let metaY = Math.max(doc.y, y + 20) + 2

  doc.fontSize(10).font('Helvetica').fillColor(MUTED)
  const dateText = fmtDate(gig.event_date, locale, { weekday: 'long' })
  if (dateText) {
    doc.text(dateText, HEADER_RIGHT_X, metaY, { width: HEADER_RIGHT_W, align: 'right' })
    metaY += 14
  }
  doc.fontSize(9).text(t('documentTitle'), HEADER_RIGHT_X, metaY, {
    width: HEADER_RIGHT_W, align: 'right',
  })
  metaY += 14

  const bottom = Math.max(metaY, y + HEADER_MARK_H + 5)
  hline(doc, bottom, HEADING_RULE)
  return bottom + 16
}

// ─── event information ───────────────────────────────────────────────────────

// One "Label   value" row; the value may wrap onto further lines (an address).
function infoRow(doc, y, label, value) {
  const lines = Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean)
  if (!lines.length) return y
  const text = lines.join('\n')

  doc.fontSize(9).font('Helvetica')
  const needed = doc.heightOfString(text, { width: VALUE_W }) + 4
  y = ensureSpace(doc, y, needed)

  doc.font('Helvetica-Bold').fillColor(MUTED)
  doc.text(label, PAGE_MARGIN, y, { width: LABEL_W - 8 })
  doc.font('Helvetica').fillColor(INK)
  doc.text(text, VALUE_X, y, { width: VALUE_W })
  return y + needed
}

function drawEventInformation(doc, gig, y, { t, locale }) {
  const venueLines = placeLines(gig.venue)
  y = sectionTitle(doc, y, t('eventInformation'))
  y = infoRow(doc, y, t('eventName'), (gig.event_description || '').trim() || t('eventFallback'))
  y = infoRow(doc, y, t('date'), fmtDate(gig.event_date, locale, { weekday: 'long' }))
  y = infoRow(doc, y, t('startTime'), fmtTime(gig.start_time) || t('notSet'))
  y = infoRow(doc, y, t('endTime'), fmtTime(gig.end_time) || t('notSet'))
  y = infoRow(doc, y, t('location'), venueLines.length ? venueLines : t('notSet'))
  y = infoRow(doc, y, t('festival'), placeLines(gig.festival))
  return y + 10
}

// ─── contact persons ─────────────────────────────────────────────────────────
// Every contact on one line: where it came from, name, category, email, phone.

// Contacts inherited from the gig's venue or festival say so, exactly as the
// Contacts tab tags them; the gig's own contacts carry no source.
function contactSource(contact, t) {
  if (contact.source === 'venue') return `[${t('sourceVenue')}]`
  if (contact.source === 'festival') return `[${t('sourceFestival')}]`
  return null
}

function contactLine(contact, t) {
  const category = contact.category
    ? t(`categories.${contact.category}`, { defaultValue: contact.category })
    : null
  return [
    contactSource(contact, t),
    contact.name,
    category,
    contact.email,
    contact.phone,
    contact.is_primary ? `(${t('primary')})` : null,
  ].filter(Boolean).join('  ·  ')
}

function drawContacts(doc, contacts, y, { t }) {
  y = sectionTitle(doc, y, t('contactPersons'))
  if (!contacts.length) {
    y = ensureSpace(doc, y, 16)
    drawOneLine(doc, t('noContacts'), PAGE_MARGIN, y, USABLE_W, { color: MUTED })
    return y + 24
  }

  for (const contact of contacts) {
    y = ensureSpace(doc, y, 16)
    drawOneLine(doc, contactLine(contact, t), PAGE_MARGIN, y, USABLE_W, {
      font: contact.is_primary ? 'Helvetica-Bold' : 'Helvetica',
    })
    y += 14
  }
  return y + 10
}

// ─── tasks ───────────────────────────────────────────────────────────────────
// One line each: a tick box, the title, then the state (assignee, due date).

function taskState(task, t, locale) {
  const due = fmtDate(task.due_date, locale)
  return [
    task.assigned_to_name || t('taskUnassigned'),
    due ? t('taskDue', { date: due }) : null,
  ].filter(Boolean).join('  ·  ')
}

function drawTasks(doc, tasks, y, { t, locale }) {
  y = sectionTitle(doc, y, t('tasks'))
  if (!tasks.length) {
    y = ensureSpace(doc, y, 16)
    drawOneLine(doc, t('noTasks'), PAGE_MARGIN, y, USABLE_W, { color: MUTED })
    return y + 24
  }

  // The state column is right-aligned against the page edge, so reserve it and
  // give the title whatever is left.
  const titleX = PAGE_MARGIN + CHECKBOX_SIZE + 8
  const titleW = RIGHT_EDGE - TASK_STATE_W - 10 - titleX

  for (const task of tasks) {
    y = ensureSpace(doc, y, 16)
    drawCheckbox(doc, PAGE_MARGIN, y + 1, Boolean(task.done))
    drawOneLine(doc, task.title || '', titleX, y, titleW, { color: task.done ? MUTED : INK })
    drawOneLine(doc, taskState(task, t, locale), RIGHT_EDGE - TASK_STATE_W, y, TASK_STATE_W, {
      color: MUTED, align: 'right',
    })
    y += 15
  }
  return y + 10
}

// ─── timetable ───────────────────────────────────────────────────────────────
// Optional: an empty running order prints no section at all.

function drawTimetable(doc, timetable, y, { t }) {
  if (!timetable.length) return y

  y = sectionTitle(doc, y, t('timetable'))
  for (const entry of timetable) {
    y = ensureSpace(doc, y, 16)
    drawOneLine(doc, timeRange(entry.start_time, entry.end_time, t), PAGE_MARGIN, y, TIME_COL_W, {
      font: 'Helvetica-Bold',
    })
    drawOneLine(doc, entry.description || '', PAGE_MARGIN + TIME_COL_W, y, USABLE_W - TIME_COL_W)
    y += 15
  }
  return y + 10
}

// ─── additional information ──────────────────────────────────────────────────
// Every non-empty block, in the order the band arranged them. Content flows and
// paginates on its own, so the cursor is picked back up from doc.y.

function drawAdditionalInformation(doc, infoBlocks, y, { t }) {
  const blocks = infoBlocks.filter((block) => (block.content || '').trim())
  if (!blocks.length) return y

  y = sectionTitle(doc, y, t('additionalInformation'))
  for (const block of blocks) {
    y = ensureSpace(doc, y, 40)
    doc.fontSize(10).font('Helvetica-Bold').fillColor(INK)
    doc.text(infoBlockLabel(block, t), PAGE_MARGIN, y, { width: USABLE_W })
    y = doc.y + 2

    doc.fontSize(9).font('Helvetica').fillColor(INK)
    doc.text(block.content.trim(), PAGE_MARGIN, y, { width: USABLE_W })
    y = doc.y + 12
  }
  return y
}
