import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useCompactLayout } from '../../hooks/useCompactLayout.ts'
import {
  searchBands,
  requestToJoinBand,
  withdrawJoinRequest,
  listJoinRequests,
  type DirectoryBand,
  type JoinRequest,
} from '../../api/bandDirectory.ts'
import { MAX_REQUEST_MESSAGE_LENGTH } from '../../utils/membership.ts'
import type { Id } from '../../types/entities.ts'

const MIN_QUERY = 3
const SEARCH_DEBOUNCE_MS = 350

// Find a band that opted into being findable and ask to join it. Bands that
// haven't opted in simply never appear — there is no "hidden" state to show.
export default function BandDirectorySearch() {
  const { t } = useTranslation('settings')
  const compact = useCompactLayout()
  const [query, setQuery] = useState('')
  const [fetchedResults, setFetchedResults] = useState<DirectoryBand[] | null>(null)
  const [openRequests, setOpenRequests] = useState<JoinRequest[]>([])
  const [asking, setAsking] = useState<DirectoryBand | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadRequests = useCallback(() => {
    listJoinRequests().then((res) => setOpenRequests(res.items)).catch(() => {})
  }, [])

  useEffect(() => { loadRequests() }, [loadRequests])

  // A too-short query has no results by definition, so that case is derived
  // during render instead of cleared by the effect; the effect only ever
  // records what the server returned.
  const trimmedQuery = query.trim()
  const searchable = trimmedQuery.length >= MIN_QUERY
  const results = searchable ? fetchedResults : null

  // Debounced so a picker doesn't fire a request per keystroke; the endpoint
  // has its own rate limiter regardless.
  useEffect(() => {
    if (!searchable) return
    let cancelled = false
    const timer = setTimeout(() => {
      searchBands(trimmedQuery)
        .then((res) => { if (!cancelled) setFetchedResults(res.items) })
        .catch(() => { if (!cancelled) setFetchedResults([]) })
    }, SEARCH_DEBOUNCE_MS)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [trimmedQuery, searchable])

  async function submitRequest() {
    if (!asking) return
    setBusy(true)
    setError(null)
    try {
      await requestToJoinBand(asking.id, message.trim() || undefined)
      setAsking(null)
      setMessage('')
      // Clearing the query is enough — `results` is derived from it.
      setQuery('')
      loadRequests()
    } catch (err) {
      const code = (err as { code?: string }).code
      setError(code === 'join_request_limit'
        ? t($ => $.directory.errors.tooManyRequests)
        : t($ => $.directory.errors.requestFailed))
    } finally {
      setBusy(false)
    }
  }

  async function withdraw(tenantId: Id) {
    try {
      await withdrawJoinRequest(tenantId)
      loadRequests()
    } catch {
      setError(t($ => $.directory.errors.withdrawFailed))
    }
  }

  return (
    <Box sx={{ mt: 3 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
        {t($ => $.directory.title)}
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5, mb: 1.5 }}>
        {t($ => $.directory.help)}
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setError(null)}>{error}</Alert>}

      <TextField
        label={t($ => $.directory.searchLabel)}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        fullWidth
        size="small"
        helperText={t($ => $.directory.searchHelp)}
      />

      {results !== null && results.length === 0 && (
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>
          {t($ => $.directory.noResults)}
        </Typography>
      )}

      {results !== null && results.length > 0 && (
        <List dense>
          {results.map((band) => (
            <ListItem
              key={String(band.id)}
              disableGutters
              secondaryAction={
                band.membershipStatus === 'none' ? (
                  <Button size="small" onClick={() => { setAsking(band); setMessage('') }}>
                    {t($ => $.directory.ask)}
                  </Button>
                ) : (
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {t($ => $.directory.already[band.membershipStatus])}
                  </Typography>
                )
              }
            >
              <ListItemText primary={band.displayName} />
            </ListItem>
          ))}
        </List>
      )}

      {openRequests.length > 0 && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {t($ => $.directory.openRequests)}
          </Typography>
          <List dense>
            {openRequests.map((r) => (
              <ListItem
                key={String(r.tenantId)}
                disableGutters
                secondaryAction={
                  <Button size="small" color="error" onClick={() => { void withdraw(r.tenantId) }}>
                    {t($ => $.directory.withdraw)}
                  </Button>
                }
              >
                <ListItemText
                  primary={r.displayName}
                  secondary={t($ => $.bands.awaitingApproval)}
                />
              </ListItem>
            ))}
          </List>
        </Box>
      )}

      <Dialog open={asking !== null} onClose={() => setAsking(null)} fullWidth maxWidth="sm" fullScreen={compact}>
        <DialogTitle>{t($ => $.directory.askTitle, { band: asking?.displayName ?? '' })}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {t($ => $.directory.askHelp)}
            </Typography>
            <TextField
              label={t($ => $.directory.messageLabel)}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              multiline
              minRows={3}
              fullWidth
              slotProps={{ htmlInput: { maxLength: MAX_REQUEST_MESSAGE_LENGTH } }}
              helperText={`${message.length} / ${MAX_REQUEST_MESSAGE_LENGTH}`}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAsking(null)} disabled={busy}>
            {t($ => $.directory.cancel)}
          </Button>
          <Button variant="contained" onClick={() => { void submitRequest() }} disabled={busy}>
            {t($ => $.directory.send)}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
