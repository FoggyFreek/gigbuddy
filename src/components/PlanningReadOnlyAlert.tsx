import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'

interface PlanningReadOnlyAlertProps {
  canWrite: boolean
}

export default function PlanningReadOnlyAlert({ canWrite }: Readonly<PlanningReadOnlyAlertProps>) {
  const { t } = useTranslation('common')
  if (canWrite) return null

  return (
    <Alert severity="info" sx={{ mb: 2 }}>
      {t($ => $.readOnly.planning)}
    </Alert>
  )
}
