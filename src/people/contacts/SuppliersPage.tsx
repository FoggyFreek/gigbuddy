import { useTranslation } from 'react-i18next'
import ContactDirectoryPage from './ContactDirectoryPage.tsx'
import { SUPPLIER_CATEGORY, SUPPLIER_LIKE_CATEGORIES } from './contactCategories.ts'

const SUPPLIER_LIST_FILTER = { categoryIn: SUPPLIER_LIKE_CATEGORIES }
const SUPPLIER_CREATE_INITIAL = { category: SUPPLIER_CATEGORY }

export default function SuppliersPage() {
  const { t } = useTranslation('suppliers')
  return (
    <ContactDirectoryPage
      title={t($ => $.title)}
      basePath="/suppliers"
      listFilter={SUPPLIER_LIST_FILTER}
      categories={[...SUPPLIER_LIKE_CATEGORIES]}
      createInitial={SUPPLIER_CREATE_INITIAL}
      createTitle={t($ => $.addSupplier)}
      createSubmitLabel={t($ => $.addSupplier)}
      emptyMessage={t($ => $.empty)}
      importTitle={t($ => $.importTitle)}
    />
  )
}
