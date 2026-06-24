import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import Typography from '@mui/material/Typography'
import AudioFileOutlinedIcon from '@mui/icons-material/AudioFileOutlined'
import NoteAddOutlinedIcon from '@mui/icons-material/NoteAddOutlined'
import ChordProViewerDialog from './ChordProViewerDialog.tsx'
import { createSongChart, deleteSongChart } from '../../api/songs.ts'
import type { SongChart, Id } from '../../types/entities.ts'

const CARD_W = 70
const CARD_H = 80

interface ChordProChartsSectionProps {
  songId: Id
  initialCharts?: SongChart[]
  canWrite?: boolean
}

interface ChartCardProps {
  chart: SongChart
  onOpen: (id: Id) => void
}

function NewChartCard({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5, width: CARD_W }}>
      <Box
        component="button"
        onClick={onClick}
        disabled={busy}
        aria-label="Create new chart"
        sx={{
          all: 'unset',
          cursor: busy ? 'default' : 'pointer',
          width: CARD_W,
          height: CARD_H,
          border: '1.5px dashed',
          borderColor: 'primary.main',
          borderRadius: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'primary.main',
          opacity: busy ? 0.5 : 1,
          transition: 'opacity 0.15s, box-shadow 0.15s',
          '&:hover:not(:disabled)': { boxShadow: 2, opacity: 0.8 },
        }}
      >
        {busy
          ? <CircularProgress size={20} color="primary" />
          : <NoteAddOutlinedIcon sx={{ fontSize: 36 }} />}
      </Box>
      <Typography variant="caption" sx={{ color: 'primary.main', lineHeight: 1.3 }}>
        Create
      </Typography>
    </Box>
  )
}

function ChartCard({ chart, onOpen }: ChartCardProps) {
  const id = chart.id as Id
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5, width: CARD_W }}>
      <Box
        component="button"
        onClick={() => onOpen(id)}
        aria-label={`Open ${chart.name || 'chart'}`}
        sx={{
          all: 'unset',
          cursor: 'pointer',
          width: CARD_W,
          height: CARD_H,
          border: '1.5px solid',
          borderColor: 'divider',
          borderRadius: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'border-color 0.15s, box-shadow 0.15s',
          '&:hover': { borderColor: 'primary.main', boxShadow: 2 },
        }}
      >
        <AudioFileOutlinedIcon sx={{ fontSize: 36, color: 'text.primary' }} />
      </Box>
      <Typography
        variant="caption"
        title={chart.name || 'Chart'}
        sx={{ width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3, textAlign: 'center' }}
      >
        {chart.name || 'Chart'}
      </Typography>
    </Box>
  )
}

export default function ChordProChartsSection({
  songId,
  initialCharts = [],
  canWrite = true,
}: ChordProChartsSectionProps) {
  const [charts, setCharts] = useState<SongChart[]>(initialCharts)
  const [openId, setOpenId] = useState<Id | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const openChart = charts.find((c) => c.id === openId) ?? null

  async function handleNew() {
    setError(null)
    setBusy(true)
    try {
      const chart = await createSongChart(songId, { name: 'New chart', source: '' })
      setCharts((prev) => [...prev, chart])
      setOpenId(chart.id as Id)
    } catch (err) {
      setError((err as Error).message || 'Could not create chart.')
    } finally {
      setBusy(false)
    }
  }

  function handleChartChange(updated: SongChart) {
    setCharts((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
  }

  async function handleDelete() {
    if (openId === null) return
    await deleteSongChart(songId, openId)
    setCharts((prev) => prev.filter((c) => c.id !== openId))
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ py: 0 }}>
          {error}
        </Alert>
      )}

      <Box sx={{ display: 'flex', flexWrap: 'wrap', ml: 2, gap: 2 }}>
        {charts.map((c) => (
          <ChartCard
            key={String(c.id)}
            chart={c}
            onOpen={(id) => setOpenId(id)}
          />
        ))}
        {canWrite && <NewChartCard busy={busy} onClick={handleNew} />}
      </Box>

      {openChart && (
        <ChordProViewerDialog
          key={String(openChart.id)}
          open
          songId={songId}
          chart={openChart}
          canWrite={canWrite}
          startInEdit={!openChart.source?.trim()}
          onClose={() => setOpenId(null)}
          onChartChange={handleChartChange}
          onDelete={canWrite ? handleDelete : undefined}
        />
      )}
    </Box>
  )
}
