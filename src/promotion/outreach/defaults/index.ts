import { invoiceDefault } from './invoiceDefaults.ts'
import type { TemplateContext } from '../outreachTemplates.ts'

export interface OutreachDefault {
  key: string
  context: TemplateContext
  locale: 'nl' | 'en'
  tenantKinds: readonly ('band' | 'personal')[]
  label: string
  description: string
  subject: string
  doc: Record<string, unknown>
  bodyHtml?: string
  bodyText?: string
}

const doc = (text: string): Record<string, unknown> => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

interface VisualPitchCopy {
  eyebrow: string
  title: string
  greeting: string
  intro: string
  cardOneTitle: string
  cardOneBody: string
  cardTwoTitle: string
  cardTwoBody: string
  callout: string
  footer: string
}

const visualPitchCopy: Record<'nl' | 'en', VisualPitchCopy> = {
  nl: {
    eyebrow: 'LIVE VOORSTEL', title: '{{band.name}} × {{venue.name}}', greeting: 'Hoi {{contact.first_name}},',
    intro: 'Wij zijn {{band.name}} uit {{band.city}} en zien een mooie match met {{venue.name}}. Geen lange pitch — liever laten we zien wat voor avond we samen kunnen neerzetten.',
    cardOneTitle: 'DE SOUND', cardOneBody: 'Een energieke liveshow die het publiek vanaf de eerste minuut meeneemt.',
    cardTwoTitle: 'DE MATCH', cardTwoBody: 'Een avond op maat voor jullie podium, publiek en programma.',
    callout: 'Zullen we samen een datum en passend programma verkennen?',
    footer: 'Met muzikale groet, {{band.name}}',
  },
  en: {
    eyebrow: 'LIVE PROPOSAL', title: '{{band.name}} × {{venue.name}}', greeting: 'Hi {{contact.first_name}},',
    intro: 'We are {{band.name}} from {{band.city}}, and we see a strong fit with {{venue.name}}. Rather than a long pitch, we would love to show what kind of night we can create together.',
    cardOneTitle: 'THE SOUND', cardOneBody: 'An energetic live show that draws the audience in from the first minute.',
    cardTwoTitle: 'THE MATCH', cardTwoBody: 'A night shaped around your stage, audience, and programme.',
    callout: 'Shall we explore a date and the right programme together?',
    footer: 'Musical regards, {{band.name}}',
  },
}

const textNode = (text: string, marks?: Record<string, unknown>[]) => ({ type: 'text', text, ...(marks ? { marks } : {}) })
const paragraph = (text: string, style: string, alignment?: string) => ({
  type: 'paragraph', attrs: { style, ...(alignment ? { alignment } : {}) }, content: [textNode(text)],
})
const heading = (text: string, level: number, style: string, alignment?: string) => ({
  type: 'heading', attrs: { level, style, ...(alignment ? { alignment } : {}) }, content: [textNode(text)],
})

function visualPitch(locale: 'nl' | 'en') {
  const copy = visualPitchCopy[locale]
  const purple = '#3b2463'
  const yellow = '#f4d35e'
  const ink = '#241b2f'
  const pale = '#f7f1ff'
  const docValue = {
    type: 'doc',
    content: [{
      type: 'container',
      content: [
        { type: 'section', attrs: { style: `background-color:${purple};padding:38px 32px 30px;border-radius:18px 18px 0 0;` }, content: [
          paragraph(copy.eyebrow, `color:${yellow};font-size:12px;font-weight:700;letter-spacing:2px;margin:0 0 12px;`, 'center'),
          heading(copy.title, 1, 'color:#ffffff;font-size:34px;line-height:1.15;margin:0;', 'center'),
        ] },
        { type: 'section', attrs: { style: 'background-color:#ffffff;padding:30px 32px 12px;' }, content: [
          heading(copy.greeting, 2, `color:${ink};font-size:22px;margin:0 0 12px;`),
          paragraph(copy.intro, `color:#51465e;font-size:16px;line-height:1.65;margin:0 0 22px;`),
        ] },
        { type: 'twoColumns', attrs: { cellspacing: 12 }, content: [
          { type: 'columnsColumn', attrs: { width: '50%', style: `background-color:${pale};padding:20px;border-radius:12px;vertical-align:top;` }, content: [
            heading(copy.cardOneTitle, 3, `color:${purple};font-size:14px;letter-spacing:1px;margin:0 0 8px;`),
            paragraph(copy.cardOneBody, 'color:#51465e;font-size:14px;line-height:1.5;margin:0;'),
          ] },
          { type: 'columnsColumn', attrs: { width: '50%', style: `background-color:#fff7d6;padding:20px;border-radius:12px;vertical-align:top;` }, content: [
            heading(copy.cardTwoTitle, 3, `color:${ink};font-size:14px;letter-spacing:1px;margin:0 0 8px;`),
            paragraph(copy.cardTwoBody, 'color:#51465e;font-size:14px;line-height:1.5;margin:0;'),
          ] },
        ] },
        { type: 'section', attrs: { style: 'background-color:#ffffff;padding:26px 32px 34px;' }, content: [
          { type: 'horizontalRule', attrs: { style: `border:0;border-top:2px solid ${yellow};margin:0 0 24px;` } },
          heading(copy.callout, 2, `color:${ink};font-size:22px;line-height:1.35;margin:0 0 20px;`, 'center'),
        ] },
        { type: 'section', attrs: { style: `background-color:${yellow};padding:18px 28px;border-radius:0 0 18px 18px;` }, content: [
          paragraph(copy.footer, `color:${ink};font-size:13px;font-weight:700;margin:0;`, 'center'),
        ] },
      ],
    }],
  }
  const html = `<div style="background-color:#ede8f2;padding:32px 12px;font-family:Arial,sans-serif"><div style="max-width:620px;margin:0 auto"><div style="background:${purple};padding:38px 32px 30px;border-radius:18px 18px 0 0;text-align:center"><div style="color:${yellow};font-size:12px;font-weight:700;letter-spacing:2px;margin-bottom:12px">${copy.eyebrow}</div><h1 style="color:#fff;font-size:34px;line-height:1.15;margin:0">${copy.title}</h1></div><div style="background:#fff;padding:30px 32px 12px"><h2 style="color:${ink};font-size:22px;margin:0 0 12px">${copy.greeting}</h2><p style="color:#51465e;font-size:16px;line-height:1.65;margin:0 0 22px">${copy.intro}</p></div><div style="background:#fff;padding:0 32px"><div style="display:inline-block;box-sizing:border-box;width:49%;vertical-align:top;background:${pale};padding:20px;border-radius:12px;margin-right:2%"><strong style="color:${purple};font-size:14px;letter-spacing:1px">${copy.cardOneTitle}</strong><p style="color:#51465e;font-size:14px;line-height:1.5">${copy.cardOneBody}</p></div><div style="display:inline-block;box-sizing:border-box;width:49%;vertical-align:top;background:#fff7d6;padding:20px;border-radius:12px"><strong style="color:${ink};font-size:14px;letter-spacing:1px">${copy.cardTwoTitle}</strong><p style="color:#51465e;font-size:14px;line-height:1.5">${copy.cardTwoBody}</p></div></div><div style="background:#fff;padding:26px 32px 34px;text-align:center"><hr style="border:0;border-top:2px solid ${yellow};margin:0 0 24px"><h2 style="color:${ink};font-size:22px;line-height:1.35;margin:0 0 20px">${copy.callout}</h2></div><div style="background:${yellow};padding:18px 28px;border-radius:0 0 18px 18px;text-align:center;color:${ink};font-size:13px;font-weight:700">${copy.footer}</div></div></div>`
  const bodyText = [copy.eyebrow, copy.title, copy.greeting, copy.intro, `${copy.cardOneTitle}: ${copy.cardOneBody}`, `${copy.cardTwoTitle}: ${copy.cardTwoBody}`, copy.callout, copy.footer].join('\n\n')
  return { doc: docValue, bodyHtml: html, bodyText }
}

const visualPitchNl = visualPitch('nl')
const visualPitchEn = visualPitch('en')

export const OUTREACH_DEFAULTS: readonly OutreachDefault[] = Object.freeze([
  { key: 'venue-booking-pitch', context: 'venue', locale: 'nl', tenantKinds: ['band', 'personal'], label: 'Visual venue booking pitch', description: 'A colorful, section-based introduction with cards and a call to action.', subject: '{{band.name}} × {{venue.name}}', ...visualPitchNl },
  { key: 'venue-follow-up', context: 'venue', locale: 'nl', tenantKinds: ['band', 'personal'], label: 'Venue follow-up', description: 'Follow up on an earlier introduction.', subject: 'Even terugkomend op {{band.name}}', doc: doc('Hoi {{contact.first_name}}, ik kom graag even terug op mijn eerdere bericht over {{band.name}}.') },
  { key: 'festival-pitch', context: 'venue', locale: 'nl', tenantKinds: ['band'], label: 'Festival pitch', description: 'Pitch a band to a festival.', subject: '{{band.name}} voor {{venue.name}}', doc: doc('Hoi {{contact.first_name}}, wij zijn {{band.name}} en stellen ons graag voor aan {{venue.name}}.') },
  { key: 'venue-booking-pitch-en', context: 'venue', locale: 'en', tenantKinds: ['band', 'personal'], label: 'Visual venue booking pitch (English)', description: 'A colorful, section-based introduction with cards and a call to action.', subject: '{{band.name}} × {{venue.name}}', ...visualPitchEn },
  { key: 'venue-follow-up-en', context: 'venue', locale: 'en', tenantKinds: ['band', 'personal'], label: 'Venue follow-up (English)', description: 'Follow up on an earlier introduction.', subject: 'Following up about {{band.name}}', doc: doc('Hi {{contact.first_name}}, I wanted to follow up on my earlier message about {{band.name}}.') },
  { key: 'festival-pitch-en', context: 'venue', locale: 'en', tenantKinds: ['band'], label: 'Festival pitch (English)', description: 'Pitch a band to a festival.', subject: '{{band.name}} for {{venue.name}}', doc: doc('Hi {{contact.first_name}}, we are {{band.name}} and would love to introduce ourselves to {{venue.name}}.') },
  { key: 'invoice-standard', context: 'invoice', locale: 'nl', tenantKinds: ['band', 'personal'], ...invoiceDefault('nl') },
  { key: 'invoice-standard-en', context: 'invoice', locale: 'en', tenantKinds: ['band', 'personal'], ...invoiceDefault('en') },
])
