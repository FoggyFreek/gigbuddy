import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import CircularProgress from '@mui/material/CircularProgress'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import DesktopWindowsOutlinedIcon from '@mui/icons-material/DesktopWindowsOutlined'
import { useSetWideContent } from '../../contexts/contentWidthContext.ts'
import { useDialog } from '../../contexts/dialogContext.ts'
import type { Id } from '../../types/entities.ts'
import { useCompactLayout } from '../../hooks/useCompactLayout.ts'
import JournalEntryRow from '../journal/components/JournalEntryRow.tsx'
import JournalApproveErrorDialog from '../journal/components/JournalApproveErrorDialog.tsx'
import JournalEffectsOverlay from '../journal/components/JournalEffectsOverlay.tsx'
import { useJournalListState } from '../journal/components/useJournalListState.ts'
import { computeJournalEffects } from './journalEffects.ts'
import type { JournalForm } from '../journal/components/journalFormHelpers.ts'

export default function JournalPage() {
  const { t } = useTranslation(['journal', 'common'])
  const { confirmDelete } = useDialog()
  const compact = useCompactLayout()
  const setWideContent = useSetWideContent()
  useEffect(() => {
    setWideContent(!compact)
    return () => setWideContent(false)
  }, [setWideContent, compact])

  const {
    journals, accounts, postableAccounts, accountingSettings, loading, error,
    approvalErrors, clearApprovalErrors,
    selected, draftIds, liveForms,
    registerFlush, reportForm, reportSaveStatus, saveStatus,
    toggleSelect, selectAll,
    addEntry, approveAll, approveSelected, deleteSelected,
  } = useJournalListState()


  // Ledger-effect preview of the selected entries only (live form state, so it
  // tracks unsaved edits); nothing selected → no overlay.
  const effects = useMemo(() => {
    const forms = [...selected]
      .map((id) => liveForms.get(id))
      .filter((f): f is JournalForm => Boolean(f))
    return computeJournalEffects(forms, accounts, accountingSettings)
  }, [selected, liveForms, accounts, accountingSettings])
  const showEffects = effects.debit.length > 0 || effects.credit.length > 0

  // The journal is a wide, multi-column editing grid that doesn't fit a phone.
  // On compact layouts we don't render the editor at all — just a heading, the
  // entry count, and a nudge to switch to a desktop screen.
  if (compact) {
    return (
      <Box>
        <Typography variant="h4" sx={{ fontWeight: 700, mb: 2 }}>{t($ => $.title)}</Typography>
        {error && <Typography color="error" sx={{ mb: 2 }}>{error}</Typography>}
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Box sx={{ textAlign: 'center', py: 6, px: 2 }}>
            <DesktopWindowsOutlinedIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
            <Typography variant="h6" sx={{ mb: 1 }}>{t($ => $.compact.title)}</Typography>
            <Typography color="text.secondary" sx={{ mb: 3 }}>
              {t($ => $.compact.body)}
            </Typography>
            <Typography variant="body1" sx={{ fontWeight: 600 }}>
              {t($ => $.ledgerEntries, { count: journals.length })}
            </Typography>
          </Box>
        )}
      </Box>
    )
  }

  const selectionCount = selected.size
  const hasSelection = selectionCount > 0
  const allSelected = draftIds.length > 0 && draftIds.every((id) => selected.has(id))
  const someSelected = hasSelection && !allSelected

  async function handleDeleteSelected() {
    const confirmed = await confirmDelete({
      title: t($ => $.deleteDialog.title),
      body: t($ => $.deleteDialog.body, { count: selectionCount }),
    })
    if (confirmed) deleteSelected()
  }

  return (
    <Box sx={{ pb: showEffects ? 14 : 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <Typography variant="h4" sx={{ fontWeight: 700, flexGrow: 1 }}>{t($ => $.title)}</Typography>
      </Box>

      <Box data-testid="journal-toolbar" sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
        <Checkbox
          size="small"
          checked={allSelected}
          indeterminate={someSelected}
          disabled={!draftIds.length}
          onChange={(e) => selectAll(e.target.checked)}
          slotProps={{ input: { 'aria-label': t($ => $.toolbar.selectAll) } }}
        />

        {hasSelection ? (
          <>
            <Typography variant="body2" color="text.secondary">{t($ => $.toolbar.selected, { count: selectionCount })}</Typography>
            <Button
              variant="contained"
              size="small"
              onClick={approveSelected}
              sx={{ bgcolor: 'text.primary', color: 'background.paper', '&:hover': { bgcolor: 'text.primary', opacity: 0.9 } }}
            >
              {t($ => $.toolbar.approveSelected)}
            </Button>
            <Button variant="contained" size="small" color="error" onClick={() => { void handleDeleteSelected() }}>
              {t($ => $.toolbar.deleteSelected)}
            </Button>
          </>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary">
              {t($ => $.ledgerEntries, { count: journals.length })}
            </Typography>
            <Button
              variant="contained"
              size="small"
              disabled={!draftIds.length}
              onClick={approveAll}
              sx={{ bgcolor: 'text.primary', color: 'background.paper', '&:hover': { bgcolor: 'text.primary', opacity: 0.9 } }}
            >
              {t($ => $.toolbar.approveAll)}
            </Button>
          </>
        )}

        <Box sx={{ flexGrow: 1 }} />
        {saveStatus === 'saving' && <Typography variant="caption" color="text.secondary">{t($ => $.toolbar.saving)}</Typography>}
        {saveStatus === 'error' && <Typography variant="caption" color="error">{t($ => $.toolbar.saveFailed)}</Typography>}
        <Button startIcon={<AddIcon />} onClick={addEntry}>{t($ => $.toolbar.addEntry)}</Button>
      </Box>

      {error && <Typography color="error" sx={{ mb: 2 }}>{error}</Typography>}

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {!loading && journals.map((journal) => (
        <JournalEntryRow
          key={journal.id}
          journal={journal}
          accounts={postableAccounts}
          selected={selected.has(journal.id!)}
          onToggleSelect={toggleSelect}
          registerFlush={registerFlush as (id: Id, fn: (() => void) | null) => void}
          onSaveStatus={reportSaveStatus}
          onFormChange={reportForm}
        />
      ))}

      {showEffects && <JournalEffectsOverlay effects={effects} />}

      <JournalApproveErrorDialog
        errors={approvalErrors}
        journals={journals}
        onClose={clearApprovalErrors}
      />

    </Box>
  )
}
