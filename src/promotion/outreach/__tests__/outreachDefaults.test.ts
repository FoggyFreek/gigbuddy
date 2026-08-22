import { Editor } from '@tiptap/core'
import { StarterKit } from '@react-email/editor/extensions'
import { EmailTheming } from '@react-email/editor/plugins'
import { composeReactEmail } from '@react-email/editor/core'
import { describe, expect, it } from 'vitest'
import { OUTREACH_DEFAULTS } from '../defaults/index.ts'
import { MergeBlock, MergeField } from '../editor/mergeFieldExtension.ts'

describe('visual outreach defaults', () => {
  it.each(['nl', 'en'] as const)('keeps the %s venue pitch editable and email-renderable', async (locale) => {
    const template = OUTREACH_DEFAULTS.find((entry) => entry.key === `venue-booking-pitch${locale === 'en' ? '-en' : ''}`)
    expect(template).toBeDefined()
    const editor = new Editor({
      extensions: [StarterKit, EmailTheming.configure({ theme: 'basic' }), MergeField, MergeBlock],
      content: template?.doc,
    })
    try {
      const json = editor.getJSON()
      const serialized = JSON.stringify(json)
      expect(serialized).toContain('twoColumns')
      expect(serialized).not.toContain('band.website')
      expect(serialized).toContain('#3b2463')
      const rendered = await composeReactEmail({ editor })
      expect(rendered.html).toContain('{{band.name}}')
      expect(rendered.html).not.toContain('band.website')
      expect(rendered.html).toContain('#3b2463')
      expect(rendered.text).toContain('{{venue.name}}')
    } finally {
      editor.destroy()
    }
  })
})
