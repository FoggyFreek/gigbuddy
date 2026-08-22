import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Grid from '@mui/material/Grid'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
import { useTranslation } from 'react-i18next'
import InfoBlockLabelField from './InfoBlockLabelField.tsx'
import { addGigInfoBlock, deleteGigInfoBlock, updateGigInfoBlock } from '../../gigs.ts'
import type { GigInfoBlockInput } from '../../gigs.ts'
import { buildLabelOptions, labelTextOf } from '../../infoBlockLabels.ts'
import type { GigInfoLabelKey, InfoBlockLabelOption, InfoBlockLabelValue } from '../../infoBlockLabels.ts'
import useDebouncedSave from '../../../../hooks/useDebouncedSave.ts'
import { useDialog } from '../../../../contexts/dialogContext.ts'
import type { GigInfoBlock, Id } from '../../../../types/entities.ts'
import { DEFAULT_GIG_INFO_LABEL_KEY } from '../../../../../shared/gigInfoLabels.js'

// A block being edited. `id` is null until the row has been persisted: every
// gig shows a Remarks block whether or not one exists yet, and it is created on
// the first thing the user actually writes into it.
interface EditableBlock {
  key: string
  id: Id | null
  label: string
  label_is_custom: boolean
  content: string
}

function fromServer(block: GigInfoBlock): EditableBlock {
  return {
    key: `block-${block.id}`,
    id: block.id,
    label: block.label,
    label_is_custom: block.label_is_custom,
    content: block.content,
  }
}

function draftBlock(seq: number, label: string): EditableBlock {
  return { key: `draft-${seq}`, id: null, label, label_is_custom: false, content: '' }
}

// A gig is never shown an empty section: with nothing stored it falls back to
// the Remarks block, which is where the old free-text notes field ended up.
function withFallback(blocks: EditableBlock[], seq: number): EditableBlock[] {
  return blocks.length > 0 ? blocks : [draftBlock(seq, DEFAULT_GIG_INFO_LABEL_KEY)]
}

interface Props {
  gigId: Id
  editable: boolean
  initialBlocks: GigInfoBlock[]
}

export default function GigInfoBlocks({ gigId, editable, initialBlocks }: Readonly<Props>) {
  const { t } = useTranslation(['gigs', 'common'])
  const { confirmDelete } = useDialog()
  const [blocks, setBlocks] = useState<EditableBlock[]>(
    () => withFallback(initialBlocks.map(fromServer), 0),
  )
  const [error, setError] = useState<string | null>(null)

  // Saves run long after the render that scheduled them, so they read the rows
  // from a ref rather than from `blocks`: the id a create hands back has to be
  // visible to the next save immediately, not one commit later.
  const blocksRef = useRef<EditableBlock[]>(blocks)
  const draftSeq = useRef(1)
  const chains = useRef(new Map<string, Promise<unknown>>())

  const translateLabelKey = useCallback(
    (key: GigInfoLabelKey) => t($ => $.detail.infoBlocks.labels[key]),
    [t],
  )
  const options = useMemo(() => buildLabelOptions(translateLabelKey), [translateLabelKey])

  function mutate(updater: (prev: EditableBlock[]) => EditableBlock[]) {
    const next = updater(blocksRef.current)
    blocksRef.current = next
    setBlocks(next)
  }

  // One save at a time per row: a debounced content write and a label pick must
  // not both find the row unsaved and create it twice.
  const enqueue = useCallback((key: string, task: () => Promise<void>) => {
    const previous = chains.current.get(key) ?? Promise.resolve()
    const next = previous.catch(() => {}).then(task)
    chains.current.set(key, next)
    return next
  }, [])

  const saveBlock = useCallback(async (key: string, patch: Partial<GigInfoBlockInput>) => {
    const current = blocksRef.current.find((block) => block.key === key)
    if (!current) return
    try {
      if (current.id != null) {
        await updateGigInfoBlock(gigId, current.id, patch)
        return
      }
      // An added row has no label until the user picks one, and a block cannot
      // exist without one — so it waits, holding whatever has been typed.
      if (!current.label.trim()) return
      const created = await addGigInfoBlock(gigId, {
        label: current.label,
        label_is_custom: current.label_is_custom,
        content: current.content,
      })
      // Only the id is adopted: the row may have moved on while the create flew.
      mutate((prev) => prev.map((block) => (block.key === key ? { ...block, id: created.id } : block)))
      setError(null)
    } catch (err) {
      setError((err as Error).message || t($ => $.detail.infoBlocks.saveFailed))
    }
  }, [gigId, t])

  const handleSave = useCallback(
    (key: string, patch: Partial<GigInfoBlockInput>) => enqueue(key, () => saveBlock(key, patch)),
    [enqueue, saveBlock],
  )

  function handleContentChange(key: string, content: string) {
    mutate((prev) => prev.map((block) => (block.key === key ? { ...block, content } : block)))
  }

  function handleLabelChange(key: string, value: InfoBlockLabelValue) {
    const current = blocksRef.current.find((block) => block.key === key)
    if (!current) return
    if (current.label === value.label && current.label_is_custom === value.label_is_custom) return
    mutate((prev) => prev.map((block) => (block.key === key ? { ...block, ...value } : block)))
    void handleSave(key, value)
  }

  function handleAdd() {
    draftSeq.current += 1
    mutate((prev) => [...prev, draftBlock(draftSeq.current, '')])
  }

  async function handleDelete(block: EditableBlock) {
    // Nothing to lose in an untouched row the user just added by mistake.
    if (block.id != null || block.content.trim()) {
      const confirmed = await confirmDelete({
        title: t($ => $.detail.infoBlocks.deleteTitle, {
          label: labelTextOf(block, translateLabelKey) || t($ => $.detail.infoBlocks.labelField),
        }),
      })
      if (!confirmed) return
    }
    if (block.id != null) {
      try {
        await deleteGigInfoBlock(gigId, block.id)
      } catch (err) {
        setError((err as Error).message || t($ => $.detail.infoBlocks.saveFailed))
        return
      }
    }
    draftSeq.current += 1
    mutate((prev) => withFallback(prev.filter((row) => row.key !== block.key), draftSeq.current))
  }

  return (
    <Box>
      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ py: 0, mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Two columns from md up: the blocks are short and read side by side far
          better than as one long stack. One column below that. */}
      <Grid container spacing={2}>
        {blocks.map((block) => (
          <Grid key={block.key} size={{ xs: 12, md: 6 }}>
            <InfoBlockRow
              block={block}
              editable={editable}
              options={options}
              labelText={labelTextOf(block, translateLabelKey)}
              onContentChange={handleContentChange}
              onLabelChange={handleLabelChange}
              onSave={handleSave}
              onDelete={handleDelete}
            />
          </Grid>
        ))}
      </Grid>

      {editable && (
        <Box sx={{ mt: 2 }}>
          <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={handleAdd}>
            {t($ => $.detail.infoBlocks.add)}
          </Button>
        </Box>
      )}
    </Box>
  )
}

interface RowProps {
  block: EditableBlock
  editable: boolean
  options: InfoBlockLabelOption[]
  labelText: string
  onContentChange: (key: string, content: string) => void
  onLabelChange: (key: string, value: InfoBlockLabelValue) => void
  onSave: (key: string, patch: Partial<GigInfoBlockInput>) => Promise<unknown>
  onDelete: (block: EditableBlock) => void
}

// One labelled block. The text debounces like the gig's own fields; the label is
// a discrete choice, so it commits as soon as it is made.
function InfoBlockRow({
  block, editable, options, labelText, onContentChange, onLabelChange, onSave, onDelete,
}: Readonly<RowProps>) {
  const { t } = useTranslation('gigs')
  const saveFn = useCallback(
    async (patch: { content: string }) => { await onSave(block.key, patch) },
    [onSave, block.key],
  )
  const { schedule, flush } = useDebouncedSave<{ content: string }>(saveFn)

  // Closing the detail — or the modal around it — must not drop the last few
  // characters typed, so the pending save is flushed on the way out too.
  const flushRef = useRef(flush)
  useEffect(() => { flushRef.current = flush }, [flush])
  useEffect(() => () => { void flushRef.current() }, [])

  return (
    <Stack spacing={0.5}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <InfoBlockLabelField
            value={labelText}
            options={options}
            editable={editable}
            fieldLabel={t($ => $.detail.infoBlocks.labelField)}
            onChange={(value) => onLabelChange(block.key, value)}
          />
        </Box>
        {editable && (
          <Tooltip title={t($ => $.detail.infoBlocks.remove)}>
            <IconButton size="small" color="primary" onClick={() => onDelete(block)}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Stack>
      <TextField
        fullWidth
        multiline
        minRows={3}
        value={block.content}
        onChange={(event) => {
          onContentChange(block.key, event.target.value)
          schedule({ content: event.target.value })
        }}
        onBlur={() => { void flush() }}
        slotProps={{
          htmlInput: { readOnly: !editable, 'aria-label': labelText },
        }}
      />
    </Stack>
  )
}
