// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { renderGigItineraryPdf } from '../../../../server/utils/renderGigItineraryPdf.js'

async function pdfText(buffer) {
  const pdf = await getDocument({ data: new Uint8Array(buffer), disableWorker: true }).promise
  let text = ''
  for (let page = 1; page <= pdf.numPages; page += 1) {
    const content = await (await pdf.getPage(page)).getTextContent()
    text += `${content.items.map((item) => item.str).join(' ')} `
  }
  return text
}

// A 1x1 transparent PNG — enough for pdfkit to embed a real image.
const PNG_PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

const GIG = {
  event_description: 'Paradiso Night',
  event_date: '2026-09-12',
  start_time: '20:00:00',
  end_time: '23:30:00',
  venue: {
    name: 'Paradiso',
    organization_name: 'Stichting Paradiso',
    street_and_number: 'Weteringschans 6-8',
    postal_code: '1017 SG',
    city: 'Amsterdam',
    country: 'NL',
  },
}

function render(overrides = {}) {
  return renderGigItineraryPdf({ gig: GIG, ...overrides })
}

describe('renderGigItineraryPdf', () => {
  it('renders a PDF with the event name, date and every section heading', async () => {
    const buffer = await render()
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-')

    const text = await pdfText(buffer)
    expect(text).toContain('Paradiso Night')
    expect(text).toContain('12 September 2026')
    expect(text).toContain('Event Information')
    expect(text).toContain('Contact Persons')
    expect(text).toContain('Tasks')
  })

  it('prints the event times and the full location details', async () => {
    const text = await pdfText(await render())

    expect(text).toContain('20:00')
    expect(text).toContain('23:30')
    expect(text).toContain('Paradiso')
    expect(text).toContain('Stichting Paradiso')
    expect(text).toContain('Weteringschans 6-8')
    expect(text).toContain('1017 SG Amsterdam')
  })

  it('puts every contact detail on the contact line', async () => {
    const text = await pdfText(await render({
      contacts: [
        { name: 'Jane Doe', category: 'booker', email: 'jane@example.nl', phone: '+31 6 1234 5678', is_primary: true },
        { name: 'Peter Press', category: 'press', email: 'peter@example.nl', phone: null, is_primary: false },
      ],
    }))

    expect(text).toContain('Jane Doe')
    expect(text).toContain('Booker')
    expect(text).toContain('jane@example.nl')
    expect(text).toContain('+31 6 1234 5678')
    expect(text).toContain('(primary)')
    expect(text).toContain('Peter Press')
  })

  it('says so when no contacts are linked', async () => {
    const text = await pdfText(await render({ contacts: [] }))
    expect(text).toContain('No contacts linked to this event.')
  })

  it('prints each task with its assignee and due date', async () => {
    const text = await pdfText(await render({
      tasks: [
        { title: 'Send tech rider', done: true, assigned_to_name: 'Sam', due_date: '2026-09-01' },
        { title: 'Book hotel', done: false, assigned_to_name: null, due_date: null },
      ],
    }))

    expect(text).toContain('Send tech rider')
    expect(text).toContain('Sam')
    expect(text).toContain('due 1 September 2026')
    expect(text).toContain('Book hotel')
    expect(text).toContain('Unassigned')
  })

  it('omits the timetable section entirely when the gig has no running order', async () => {
    const text = await pdfText(await render({ timetable: [] }))
    expect(text).not.toContain('Timetable')
  })

  it('draws the timetable when the gig has one', async () => {
    const text = await pdfText(await render({
      timetable: [
        { start_time: '17:00:00', end_time: '18:00:00', description: 'Get-in' },
        { start_time: '19:00:00', end_time: null, description: 'Doors' },
      ],
    }))

    expect(text).toContain('Timetable')
    expect(text).toContain('17:00 – 18:00')
    expect(text).toContain('Get-in')
    expect(text).toContain('19:00')
    expect(text).toContain('Doors')
  })

  it('renders non-empty information blocks and skips blank ones', async () => {
    const text = await pdfText(await render({
      infoBlocks: [
        { label: 'catering', label_is_custom: false, content: 'Vegetarian meals for 5.' },
        { label: 'Parking notes', label_is_custom: true, content: 'Van fits in the loading bay.' },
        { label: 'light', label_is_custom: false, content: '   ' },
      ],
    }))

    expect(text).toContain('Additional Information')
    expect(text).toContain('Catering')
    expect(text).toContain('Vegetarian meals for 5.')
    expect(text).toContain('Parking notes')
    expect(text).toContain('Van fits in the loading bay.')
    expect(text).not.toContain('Light')
  })

  it('leaves out the Additional Information section when every block is blank', async () => {
    const text = await pdfText(await render({
      infoBlocks: [{ label: 'remarks', label_is_custom: false, content: '' }],
    }))
    expect(text).not.toContain('Additional Information')
  })

  it('localizes the document when Dutch is requested', async () => {
    const text = await pdfText(await render({
      lng: 'nl',
      infoBlocks: [{ label: 'dressing_room', label_is_custom: false, content: 'Boven de zaal.' }],
    }))

    expect(text).toContain('Evenementgegevens')
    expect(text).toContain('Contactpersonen')
    expect(text).toContain('12 september 2026')
    expect(text).toContain('Kleedkamer')
  })

  it('falls back to English for an unsupported language', async () => {
    const text = await pdfText(await render({ lng: 'fr' }))
    expect(text).toContain('Event Information')
  })

  it('still renders when the gig has no name, times, venue or relations', async () => {
    const text = await pdfText(await renderGigItineraryPdf({
      gig: { event_description: null, event_date: '2026-09-12', start_time: null, end_time: null },
    }))

    expect(text).toContain('Untitled event')
    expect(text).toContain('Tasks')
    expect(text).toContain('No tasks for this event.')
  })

  it('tags contacts inherited from the venue and the festival', async () => {
    const text = await pdfText(await render({
      contacts: [
        { name: 'Venue Vera', category: 'booker', email: 'vera@venue.nl', source: 'venue' },
        { name: 'Festival Fred', category: 'promotion', email: 'fred@fest.nl', source: 'festival' },
        { name: 'Our Olivia', category: 'press', email: 'olivia@band.nl', source: null, is_primary: true },
      ],
    }))

    expect(text).toContain('[Venue]')
    expect(text).toContain('Venue Vera')
    expect(text).toContain('[Festival]')
    expect(text).toContain('Festival Fred')
    // The gig's own contact carries no source tag, only its primary marker.
    expect(text).toContain('Our Olivia')
    expect(text).toContain('(primary)')
  })

  it('signs the header with the band name when the tenant has no logo', async () => {
    const text = await pdfText(await render({ bandName: 'The Testing Tones' }))

    expect(text).toContain('The Testing Tones')
    expect(text).toContain('Paradiso Night')
  })

  it('leaves the band name out of the header when a logo is drawn', async () => {
    const text = await pdfText(await render({ bandName: 'The Testing Tones', logoBuffer: PNG_PIXEL }))

    expect(text).not.toContain('The Testing Tones')
    expect(text).toContain('Paradiso Night')
  })

  it('falls back to the band name when the logo bytes are not a decodable image', async () => {
    const text = await pdfText(await render({
      bandName: 'The Testing Tones',
      logoBuffer: Buffer.from('not an image'),
    }))

    expect(text).toContain('The Testing Tones')
    expect(text).toContain('Paradiso Night')
  })

  it('still renders a header when there is neither a logo nor a band name', async () => {
    const text = await pdfText(await render({ bandName: '   ' }))
    expect(text).toContain('Paradiso Night')
    expect(text).toContain('Itinerary')
  })
})
