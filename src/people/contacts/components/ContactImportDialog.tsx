import { useTranslation } from 'react-i18next'
import CsvImportDialog from '../../../components/csvImport/CsvImportDialog.tsx'
import type { CsvPreviewColumn } from '../../../components/csvImport/CsvImportDialog.tsx'
import type { CsvImportResult } from '../../../components/csvImport/useCsvImport.ts'
import type { Contact } from '../../../types/entities.ts'
import { importContacts } from '../contacts.ts'
import { useContactCategoryLabel } from '../contactCategories.ts'

interface ContactImportDialogProps {
  onClose: (created: boolean) => void
  /** When set, every imported row is forced to this category and the category
   *  mapping/preview column is hidden (e.g. the suppliers directory). */
  fixedCategory?: string
  title?: string
}

const VALID_CATEGORIES = new Set(['press', 'radio & tv', 'booker', 'promotion', 'network'])

interface ContactField {
  key: string
  labelKey: 'name' | 'email' | 'phone' | 'category'
  required?: boolean
  aliases: string[]
}

const CONTACT_FIELDS: ContactField[] = [
  { key: 'name',     labelKey: 'name',     required: true, aliases: ['name', 'contact name', 'full name'] },
  { key: 'email',    labelKey: 'email',    aliases: ['email', 'e-mail', 'email address'] },
  { key: 'phone',    labelKey: 'phone',    aliases: ['phone', 'tel', 'phone number', 'telephone'] },
  { key: 'category', labelKey: 'category', aliases: ['category', 'type', 'contact type'] },
]

function coerceCategory(raw: string): string {
  if (!raw) return 'press'
  const lower = raw.toLowerCase().trim()
  if (VALID_CATEGORIES.has(lower)) return lower
  // fuzzy matches
  if (lower.includes('radio') || lower.includes('tv') || lower.includes('television')) return 'radio & tv'
  if (lower.includes('book')) return 'booker'
  if (lower.includes('promo')) return 'promotion'
  if (lower.includes('network')) return 'network'
  return 'press'
}

type ContactRow = Record<string, string>

export default function ContactImportDialog({ onClose, fixedCategory, title }: Readonly<ContactImportDialogProps>) {
  const { t } = useTranslation(['contacts', 'common'])
  const categoryLabel = useContactCategoryLabel()

  // In fixed-category mode the category column is neither mapped nor previewed.
  const fields = (fixedCategory ? CONTACT_FIELDS.filter((f) => f.key !== 'category') : CONTACT_FIELDS)
    .map((f) => ({ ...f, label: t($ => $.fields[f.labelKey]) }))

  const previewColumns: CsvPreviewColumn<ContactRow>[] = [
    ...(fixedCategory ? [] : [{ key: 'category', header: t($ => $.fields.category) }]),
    { key: 'name', header: t($ => $.fields.name), strong: true },
    { key: 'email', header: t($ => $.fields.email) },
    { key: 'phone', header: t($ => $.fields.phone) },
  ]

  return (
    <CsvImportDialog<ContactRow>
      fields={fields}
      previewColumns={previewColumns}
      requiredFieldKey="name"
      transformRow={(values) => ({ ...values, category: fixedCategory ?? coerceCategory(values.category) })}
      onImport={async (rows) =>
        await importContacts(rows as unknown as Partial<Contact>[]) as unknown as CsvImportResult}
      onClose={onClose}
      title={title ?? t($ => $.import.title)}
      uploadHelp={fixedCategory
        ? t($ => $.import.uploadHelpFixed, { category: categoryLabel(fixedCategory) })
        : t($ => $.import.uploadHelp)}
      mapHelp={(count) => t($ => $.import.mapHelp, { count })}
      formatResult={(result) => (result.skipped > 0
        ? t($ => $.import.resultSkipped, { count: result.imported, skipped: result.skipped })
        : t($ => $.import.result, { count: result.imported }))}
    />
  )
}
