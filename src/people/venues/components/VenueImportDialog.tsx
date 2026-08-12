import { useTranslation } from 'react-i18next'
import CsvImportDialog from '../../../components/csvImport/CsvImportDialog.tsx'
import type { CsvPreviewColumn } from '../../../components/csvImport/CsvImportDialog.tsx'
import type { CsvImportResult } from '../../../components/csvImport/useCsvImport.ts'
import type { Venue } from '../../../types/entities.ts'
import { importVenues } from '../venues.ts'

type VenueFieldLabelKey =
  | 'venueName' | 'category' | 'title' | 'givenName' | 'familyName' | 'organizationName'
  | 'streetAndNumber' | 'streetAdditional' | 'postalCode' | 'city' | 'region' | 'country'
  | 'website' | 'phone' | 'email'
  | 'latitude' | 'longitude'

interface VenueField {
  key: string
  labelKey: VenueFieldLabelKey
  required?: boolean
  aliases: string[]
}

const VENUE_FIELDS: VenueField[] = [
  { key: 'name',              labelKey: 'venueName',        required: true, aliases: ['name', 'venue', 'venue name'] },
  { key: 'category',          labelKey: 'category',         aliases: ['category', 'type', 'venue type'] },
  { key: 'title',             labelKey: 'title',            aliases: ['title', 'salutation'] },
  { key: 'given_name',        labelKey: 'givenName',        aliases: ['given_name', 'given name', 'givenname', 'first name', 'firstname', 'contact_person', 'contact person', 'contact', 'booking contact'] },
  { key: 'family_name',       labelKey: 'familyName',       aliases: ['family_name', 'family name', 'familyname', 'last name', 'lastname', 'surname'] },
  { key: 'organization_name', labelKey: 'organizationName', aliases: ['organization_name', 'organization name', 'organizationname', 'organisation', 'organisation name', 'organization', 'company', 'company name'] },
  { key: 'street_and_number', labelKey: 'streetAndNumber',  aliases: ['street_and_number', 'street and number', 'streetandnumber', 'address', 'street', 'address line 1'] },
  { key: 'street_additional', labelKey: 'streetAdditional', aliases: ['street_additional', 'street additional', 'streetadditional', 'address line 2', 'address2'] },
  { key: 'postal_code',       labelKey: 'postalCode',       aliases: ['postal_code', 'postal code', 'postalcode', 'postcode', 'zip', 'zip code', 'zipcode'] },
  { key: 'city',              labelKey: 'city',             aliases: ['city'] },
  { key: 'region',            labelKey: 'region',           aliases: ['region', 'province', 'state'] },
  { key: 'country',           labelKey: 'country',          aliases: ['country'] },
  { key: 'website',           labelKey: 'website',          aliases: ['website', 'url', 'web'] },
  { key: 'phone',             labelKey: 'phone',            aliases: ['phone', 'tel', 'telephone', 'phone number'] },
  { key: 'email',             labelKey: 'email',            aliases: ['email', 'e-mail', 'email address'] },
  { key: 'latitude',          labelKey: 'latitude',         aliases: ['latitude', 'lat'] },
  { key: 'longitude',         labelKey: 'longitude',        aliases: ['longitude', 'lon', 'lng'] },
]

type VenueRow = Record<string, string>

function transformRow(values: Record<string, string>): VenueRow {
  const category = values.category?.toLowerCase()
  return { ...values, category: category === 'venue' || category === 'festival' ? category : 'venue' }
}

interface VenueImportDialogProps {
  onClose: (imported: boolean) => void
}

export default function VenueImportDialog({ onClose }: Readonly<VenueImportDialogProps>) {
  const { t } = useTranslation(['venues', 'common'])

  const previewColumns: CsvPreviewColumn<VenueRow>[] = [
    { key: 'category', header: t($ => $.import.columns.category) },
    { key: 'name', header: t($ => $.import.columns.name), strong: true },
    { key: 'city', header: t($ => $.import.columns.city) },
    { key: 'country', header: t($ => $.import.columns.country) },
    {
      key: 'contact',
      header: t($ => $.import.columns.contact),
      render: (row) => [row.title, row.given_name, row.family_name].filter(Boolean).join(' ') || '—',
    },
  ]

  return (
    <CsvImportDialog<VenueRow>
      fields={VENUE_FIELDS.map((f) => ({ ...f, label: t($ => $.fields[f.labelKey]) }))}
      previewColumns={previewColumns}
      requiredFieldKey="name"
      transformRow={transformRow}
      onImport={async (rows) =>
        await importVenues(rows as unknown as Partial<Venue>[]) as unknown as CsvImportResult}
      onClose={onClose}
      title={t($ => $.import.title)}
      uploadHelp={t($ => $.import.uploadHelp)}
      mapHelp={(count) => t($ => $.import.mapHelp, { count })}
      formatResult={(result) => (result.skipped > 0
        ? t($ => $.import.resultSkipped, { count: result.imported, skipped: result.skipped })
        : t($ => $.import.result, { count: result.imported }))}
    />
  )
}
