import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@mui/material/Button'
import Menu from '@mui/material/Menu'
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown'
import DownloadIcon from '@mui/icons-material/Download'
import { useInvoiceDownloadItems, type InvoiceDownloadItemsArgs } from './invoiceDownloadItems.tsx'

type Props = Omit<InvoiceDownloadItemsArgs, 'onClose'>

const MENU_ID = 'invoice-download-menu'
const BUTTON_ID = 'invoice-download-button'

// The DOWNLOADS an invoice offers, behind one control. All are reads, so they
// stay available to every finance viewer; the mutations — re-generating the PDF
// and emailing the invoice — deliberately live outside this menu.
//
// Wide screens only: on a compact one these same entries are folded into the
// single overflow menu in InvoiceDocumentActions.
export default function InvoiceDownloadMenu(props: Readonly<Props>) {
  const { t } = useTranslation('invoices')
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const open = Boolean(anchorEl)
  const close = () => setAnchorEl(null)
  const items = useInvoiceDownloadItems({ ...props, onClose: close })

  return (
    <>
      <Button
        id={BUTTON_ID}
        size="small"
        startIcon={<DownloadIcon />}
        endIcon={<ArrowDropDownIcon />}
        onClick={(event) => setAnchorEl(event.currentTarget)}
        aria-haspopup="menu"
        aria-expanded={open || undefined}
        aria-controls={open ? MENU_ID : undefined}
      >
        {t($ => $.detail.download)}
      </Button>

      <Menu
        id={MENU_ID}
        anchorEl={anchorEl}
        open={open}
        onClose={close}
        slotProps={{ list: { 'aria-labelledby': BUTTON_ID } }}
      >
        {items}
      </Menu>
    </>
  )
}
