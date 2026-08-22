import { EmailNode } from '@react-email/editor/core'
import { mergeAttributes } from '@tiptap/core'

export const MergeField = EmailNode.create({
  name: 'mergeField',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes: () => ({ fieldKey: { default: null } }),
  parseHTML: () => [{ tag: 'span[data-merge-field]' }],
  renderHTML: ({ HTMLAttributes }) => ['span', mergeAttributes(HTMLAttributes, {
    'data-merge-field': '',
    class: 'gb-merge-field',
  }), `{{${HTMLAttributes.fieldKey}}}`],
  renderToReactEmail: ({ node }) => `{{${node.attrs?.fieldKey ?? ''}}}`,
})

export const MergeBlock = EmailNode.create({
  name: 'mergeBlock',
  group: 'block',
  atom: true,
  addAttributes: () => ({ fieldKey: { default: null }, label: { default: null } }),
  parseHTML: () => [{ tag: 'div[data-merge-block]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, {
    'data-merge-block': '',
    class: 'gb-merge-block',
  }), HTMLAttributes.label ?? `{{#${HTMLAttributes.fieldKey}}}`],
  renderToReactEmail: ({ node }) => `{{#${node.attrs?.fieldKey ?? ''}}}`,
})
