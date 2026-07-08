import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useAuth } from '../../contexts/authContext.ts'
import { unlinkProvider } from '../../api/auth.ts'
import type { AuthProvider } from '../../api/auth.ts'
import { GoogleIcon, MicrosoftIcon } from '../shared/ProviderIcons.tsx'

const PROVIDERS: AuthProvider[] = ['google', 'microsoft']

const PROVIDER_ICONS: Record<AuthProvider, typeof GoogleIcon> = {
  google: GoogleIcon,
  microsoft: MicrosoftIcon,
}

const LINK_ERROR_KEYS = [
  'already_linked',
  'slot_occupied',
  'sub_taken',
  'no_primary',
  'reauth_mismatch',
  'expired',
  'failed',
] as const
type LinkErrorKey = (typeof LINK_ERROR_KEYS)[number]

function toLinkErrorKey(code: string): LinkErrorKey {
  return (LINK_ERROR_KEYS as readonly string[]).includes(code) ? (code as LinkErrorKey) : 'failed'
}

export default function ConnectedAccountsSection() {
  const { t } = useTranslation('settings')
  const { user, refreshUser } = useAuth()
  const [searchParams] = useSearchParams()
  const [confirmLink, setConfirmLink] = useState<AuthProvider | null>(null)
  const [confirmUnlink, setConfirmUnlink] = useState<AuthProvider | null>(null)
  const [unlinkError, setUnlinkError] = useState(false)

  const providers = user?.providers ?? { google: false, microsoft: false }
  const linkedCount = PROVIDERS.filter((p) => providers[p]).length

  // Set by the OIDC link-flow callback redirect.
  const linkedParam = searchParams.get('linked')
  const linkErrorParam = searchParams.get('linkError')

  const providerLabel = (provider: AuthProvider) => t($ => $.connectedAccounts.providers[provider])

  const startLink = (provider: AuthProvider) => {
    // Full-page navigation: the flow re-authenticates at the IdP and returns
    // here via the backend callback redirects.
    window.location.href = `/api/auth/link/${provider}/start`
  }

  const doUnlink = async (provider: AuthProvider) => {
    setConfirmUnlink(null)
    setUnlinkError(false)
    try {
      await unlinkProvider(provider)
      await refreshUser()
    } catch {
      setUnlinkError(true)
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
        {t($ => $.connectedAccounts.title)}
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        {t($ => $.connectedAccounts.description)}
      </Typography>

      {linkedParam && (PROVIDERS as readonly string[]).includes(linkedParam) && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {t($ => $.connectedAccounts.linkedSuccess, { provider: providerLabel(linkedParam as AuthProvider) })}
        </Alert>
      )}
      {linkErrorParam && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {t($ => $.connectedAccounts.errors[toLinkErrorKey(linkErrorParam)])}
        </Alert>
      )}
      {unlinkError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {t($ => $.connectedAccounts.unlinkFailed)}
        </Alert>
      )}

      <Stack spacing={1.5}>
        {PROVIDERS.map((provider) => {
          const isLinked = providers[provider]
          const lastMethod = isLinked && linkedCount <= 1
          const ProviderIcon = PROVIDER_ICONS[provider]
          return (
            <Box
              key={provider}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                p: 1.5,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 2,
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flex: 1 }}>
                <ProviderIcon size={20} />
                <Typography sx={{ fontWeight: 500 }}>{providerLabel(provider)}</Typography>
              </Box>
              <Chip
                size="small"
                label={isLinked ? t($ => $.connectedAccounts.linked) : t($ => $.connectedAccounts.notLinked)}
                color={isLinked ? 'success' : 'default'}
                variant={isLinked ? 'filled' : 'outlined'}
              />
              {isLinked ? (
                <Tooltip title={lastMethod ? t($ => $.connectedAccounts.onlyMethod) : ''}>
                  <span>
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={lastMethod}
                      onClick={() => setConfirmUnlink(provider)}
                    >
                      {t($ => $.connectedAccounts.unlink)}
                    </Button>
                  </span>
                </Tooltip>
              ) : (
                <Button size="small" variant="contained" onClick={() => setConfirmLink(provider)}>
                  {t($ => $.connectedAccounts.link)}
                </Button>
              )}
            </Box>
          )
        })}
      </Stack>

      <Dialog open={confirmLink !== null} onClose={() => setConfirmLink(null)}>
        {confirmLink !== null && (
          <>
            <DialogTitle>
              {t($ => $.connectedAccounts.linkDialog.title, { provider: providerLabel(confirmLink) })}
            </DialogTitle>
            <DialogContent>
              <DialogContentText>
                {t($ => $.connectedAccounts.linkDialog.body, { provider: providerLabel(confirmLink) })}
              </DialogContentText>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setConfirmLink(null)}>
                {t($ => $.actions.cancel, { ns: 'common' })}
              </Button>
              <Button variant="contained" onClick={() => startLink(confirmLink)}>
                {t($ => $.connectedAccounts.linkDialog.confirm)}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>

      <Dialog open={confirmUnlink !== null} onClose={() => setConfirmUnlink(null)}>
        {confirmUnlink !== null && (
          <>
            <DialogTitle>
              {t($ => $.connectedAccounts.unlinkDialog.title, { provider: providerLabel(confirmUnlink) })}
            </DialogTitle>
            <DialogContent>
              <DialogContentText>
                {t($ => $.connectedAccounts.unlinkDialog.body, { provider: providerLabel(confirmUnlink) })}
              </DialogContentText>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setConfirmUnlink(null)}>
                {t($ => $.actions.cancel, { ns: 'common' })}
              </Button>
              <Button color="error" variant="contained" onClick={() => doUnlink(confirmUnlink)}>
                {t($ => $.connectedAccounts.unlinkDialog.confirm)}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Paper>
  )
}
