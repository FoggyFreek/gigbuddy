import ContactDirectoryPage from './ContactDirectoryPage.tsx'
import { SUPPLIER_CATEGORY } from '../utils/contactCategories.ts'

const SUPPLIER_CATEGORIES = [SUPPLIER_CATEGORY]
const SUPPLIER_LIST_FILTER = { category: SUPPLIER_CATEGORY }
const SUPPLIER_CREATE_INITIAL = { category: SUPPLIER_CATEGORY }

export default function SuppliersPage() {
  return (
    <ContactDirectoryPage
      title="Suppliers"
      basePath="/suppliers"
      listFilter={SUPPLIER_LIST_FILTER}
      categories={SUPPLIER_CATEGORIES}
      createInitial={SUPPLIER_CREATE_INITIAL}
      createTitle="Add supplier"
      createSubmitLabel="Add supplier"
      allowImport={false}
      emptyMessage="No suppliers yet - add one."
    />
  )
}
