import { useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { usePermissions } from '../../../hooks/usePermissions.ts'
import type { Id } from '../../../types/entities.ts'
import { countersignGigContract, contractPdfUrl, generateGigContract, listGigContracts, type GigContract } from '../gigContracts.ts'
import { listVenueContacts } from '../../../people/venues/venues.ts'

interface Props { gigId: Id; venueId?: Id }

export default function GigContractsSection({ gigId, venueId }: Readonly<Props>) {
  const { t, i18n } = useTranslation('outreach')
  const navigate = useNavigate()
  const { canManageFinance } = usePermissions()
  const [contracts, setContracts] = useState<GigContract[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void listGigContracts(gigId).then((contractResult) => {
      if (!cancelled) setContracts(contractResult.items)
    }).catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught)) })
    return () => { cancelled = true }
  }, [gigId])
  async function generate() {
    setBusy(true); setError(null)
    try {
      const created = await generateGigContract(gigId, i18n.language)
      setContracts((current) => [created, ...current])
    }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
    finally { setBusy(false) }
  }
  async function countersign(contract: GigContract) {
    const updated = await countersignGigContract(contract.id, {})
    setContracts((current) => current.map((entry) => entry.id === updated.id ? updated : entry))
  }
  async function emailContract(contract: GigContract) {
    if (!venueId) return
    try {
      const contacts = await listVenueContacts(venueId)
      const contact = contacts.find((entry) => entry.is_primary)?.contact ?? contacts[0]?.contact
      if (!contact?.id) { setError(t($ => $.contracts.noRecipient)); return }
      navigate('/outreach/compose', { state: { contractId: contract.id, recipients: [{ contactId: contact.id, venueId }] } })
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
  }
  return <Paper variant="outlined" sx={{ p: 2, mt: 2, width: '100%' }}>
    <Typography variant="h6" sx={{ mb: 1 }}>{t($ => $.contracts.title)}</Typography>
    {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
    {canManageFinance && <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 2 }}>
      <Button variant="contained" disabled={busy} onClick={() => { void generate() }}>{t($ => $.contracts.generate)}</Button>
    </Stack>}
    {!contracts.length && <Typography variant="body2" sx={{ color: 'text.secondary' }}>{t($ => $.contracts.empty)}</Typography>}
    <Stack spacing={1}>{contracts.map((contract) => <Box key={contract.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, borderTop: '1px solid', borderColor: 'divider', pt: 1 }}>
      <Typography sx={{ flexGrow: 1 }}>{contract.reference} · v{contract.version} · {contract.status}</Typography>
      {contract.pdf_object_key && <Button component="a" href={contractPdfUrl(contract.id)} target="_blank">{t($ => $.contracts.download)}</Button>}
      {canManageFinance && contract.status === 'draft' && venueId && <Button onClick={() => { void emailContract(contract) }}>{t($ => $.contracts.email)}</Button>}
      {canManageFinance && !['countersigned', 'void'].includes(contract.status) && <Button onClick={() => { void countersign(contract) }}>{t($ => $.contracts.countersign)}</Button>}
    </Box>)}</Stack>
  </Paper>
}
