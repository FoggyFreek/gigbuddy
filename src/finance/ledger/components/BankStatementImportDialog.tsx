import { BankStatementImportDialogView } from './bankImport/BankStatementImportDialogView.tsx'
import { useBankStatementImportDialog } from './useBankStatementImportDialog.ts'

interface Props {
  onClose: (imported: boolean) => void
}

export default function BankStatementImportDialog({ onClose }: Readonly<Props>) {
  const dialog = useBankStatementImportDialog(onClose)
  return <BankStatementImportDialogView dialog={dialog} />
}
