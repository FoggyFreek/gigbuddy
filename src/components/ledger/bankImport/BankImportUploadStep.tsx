import UploadFileIcon from '@mui/icons-material/UploadFile'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'

interface Props {
  onFileSelect: (file: File) => void
}

export function BankImportUploadStep({ onFileSelect }: Readonly<Props>) {
  const { t } = useTranslation('ledger')

  return (
    <Box sx={{ py: 4, textAlign: 'center' }}>
      <Button component="label" variant="contained" startIcon={<UploadFileIcon />}>
        {t($ => $.bankImport.chooseFile)}
        <input
          type="file"
          accept=".xml,.sta,.940,.txt"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) onFileSelect(file)
          }}
        />
      </Button>
      <Typography variant="caption" sx={{ display: 'block', mt: 2, color: 'text.secondary' }}>
        {t($ => $.bankImport.fileHint)}
      </Typography>
    </Box>
  )
}
