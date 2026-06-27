import { useTranslation } from 'react-i18next'
import ContactDirectoryPage from './ContactDirectoryPage.tsx'
import { CONTACT_CATEGORIES, SUPPLIER_CATEGORY } from '../utils/contactCategories.ts'

const CONTACT_LIST_FILTER = { excludeCategory: SUPPLIER_CATEGORY }

export default function ContactsPage() {
  const { t } = useTranslation('contacts')
  return (
    <ContactDirectoryPage
      title={t($ => $.title)}
      basePath="/contacts"
      listFilter={CONTACT_LIST_FILTER}
      categories={CONTACT_CATEGORIES}
    />
  )
}
