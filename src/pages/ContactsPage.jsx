import ContactDirectoryPage from './ContactDirectoryPage.jsx'
import { CONTACT_CATEGORIES, SUPPLIER_CATEGORY } from '../utils/contactCategories.js'

const CONTACT_LIST_FILTER = { excludeCategory: SUPPLIER_CATEGORY }

export default function ContactsPage() {
  return (
    <ContactDirectoryPage
      title="Contacts"
      basePath="/contacts"
      listFilter={CONTACT_LIST_FILTER}
      categories={CONTACT_CATEGORIES}
    />
  )
}
