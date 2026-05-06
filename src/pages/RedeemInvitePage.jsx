import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { redeemInvite } from '../api/invites.js'
import { useAuth } from '../contexts/authContext.js'

export default function RedeemInvitePage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const { user, logout, refreshUser } = useAuth()
  const [code, setCode] = useState(params.get('code') || '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  // If code is in the URL, attempt redemption immediately on first render.
  useEffect(() => {
    const initial = params.get('code')
    if (!initial) return
    let cancelled = false
    setSubmitting(true)
    redeemInvite(initial)
      .then(async (res) => {
        if (cancelled) return
        setResult(res)
        await refreshUser()
        const next = new URLSearchParams(params)
        next.delete('code')
        setParams(next, { replace: true })
      })
      .catch((err) => {
        if (cancelled) return
        setError(err.message || 'Failed to redeem invite')
      })
      .finally(() => {
        if (!cancelled) setSubmitting(false)
      })
    return () => {
      cancelled = true
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!code.trim()) return
    setError('')
    setSubmitting(true)
    try {
      const res = await redeemInvite(code.trim())
      setResult(res)
      await refreshUser()
    } catch (err) {
      setError(err.message || 'Failed to redeem invite')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        bgcolor: 'background.default',
        px: 2,
      }}
    >
      <Paper
        elevation={3}
        sx={{ p: 4, maxWidth: 480, width: '100%', display: 'flex', flexDirection: 'column', gap: 3 }}
      >
        <Typography variant="h5" fontWeight={700}>
          Join a band
        </Typography>

        {result ? (
          <Stack spacing={2}>
            <Typography variant="body1">
              You requested to join <strong>{result.tenant.name}</strong>. A band
              admin must approve your membership before you can access band
              data.
            </Typography>
            <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
              <Button onClick={logout}>Log out</Button>
              <Button variant="contained" onClick={() => navigate('/')}>
                Continue
              </Button>
            </Stack>
          </Stack>
        ) : (
          <Stack component="form" spacing={2} onSubmit={handleSubmit}>
            <Typography variant="body2" color="text.secondary">
              {user?.memberships?.length
                ? 'Paste an invite code to join an additional band.'
                : "You don't belong to a band yet. Paste an invite code from a band admin to join."}
            </Typography>
            <TextField
              label="Invite code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoFocus
              fullWidth
              disabled={submitting}
            />
            {error && (
              <Typography color="error" variant="body2">
                {error}
              </Typography>
            )}
            <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between' }}>
              <Button onClick={logout} disabled={submitting}>
                Log out
              </Button>
              <Button
                type="submit"
                variant="contained"
                disabled={submitting || !code.trim()}
              >
                Redeem
              </Button>
            </Stack>
          </Stack>
        )}
      </Paper>
    </Box>
  )
}
