import { useTranslation } from 'react-i18next'
import CsvImportDialog from '../../../components/csvImport/CsvImportDialog.tsx'
import type { CsvPreviewColumn } from '../../../components/csvImport/CsvImportDialog.tsx'
import type { CsvImportResult } from '../../../components/csvImport/useCsvImport.ts'
import type { Song } from '../../../types/entities.ts'
import { importSongs } from '../songs.ts'

interface SongField {
  key: string
  labelKey: 'title' | 'artist' | 'key' | 'tempo' | 'duration' | 'tags'
  required?: boolean
  aliases: string[]
}

const SONG_FIELDS: SongField[] = [
  { key: 'title',    labelKey: 'title',    required: true, aliases: ['title', 'song', 'song title', 'name'] },
  { key: 'artist',   labelKey: 'artist',   aliases: ['artist', 'band', 'performer'] },
  { key: 'song_key', labelKey: 'key',      aliases: ['key', 'song key', 'song_key'] },
  { key: 'tempo',    labelKey: 'tempo',    aliases: ['tempo', 'bpm'] },
  { key: 'duration', labelKey: 'duration', aliases: ['duration', 'length', 'time', 'duration_seconds'] },
  { key: 'tags',     labelKey: 'tags',     aliases: ['tags', 'genre', 'genres', 'style'] },
]

// Parse a duration cell that may be "mm:ss", "h:mm:ss" or plain seconds.
function durationToSeconds(raw: string): number | null {
  const s = raw.trim()
  if (!s) return null
  if (/^\d+$/.test(s)) return Number(s)
  const parts = s.split(':').map((p) => p.trim())
  if (parts.some((p) => !/^\d+$/.test(p))) return null
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0)
}

type SongRow = {
  title: string
  artist: string
  song_key: string
  tempo: number | null
  duration_seconds: number | null
  tags: string
}

function transformRow(values: Record<string, string>): SongRow {
  return {
    title: values.title,
    artist: values.artist,
    song_key: values.song_key,
    tempo: values.tempo ? Number(values.tempo) : null,
    duration_seconds: durationToSeconds(values.duration),
    tags: values.tags,
  }
}

interface SongImportDialogProps {
  onClose: (imported: boolean) => void
}

export default function SongImportDialog({ onClose }: Readonly<SongImportDialogProps>) {
  const { t } = useTranslation(['songs', 'common'])

  const previewColumns: CsvPreviewColumn<SongRow>[] = [
    { key: 'title', header: t($ => $.fields.title), strong: true },
    { key: 'artist', header: t($ => $.fields.artist) },
    { key: 'song_key', header: t($ => $.fields.key) },
    { key: 'tempo', header: t($ => $.fields.tempo) },
    { key: 'tags', header: t($ => $.fields.tags) },
  ]

  return (
    <CsvImportDialog<SongRow>
      fields={SONG_FIELDS.map((f) => ({ ...f, label: t($ => $.fields[f.labelKey]) }))}
      previewColumns={previewColumns}
      requiredFieldKey="title"
      requiredFieldError={t($ => $.import.titleColumnRequired)}
      transformRow={transformRow}
      onImport={async (rows) =>
        await importSongs(rows as unknown as Partial<Song>[]) as unknown as CsvImportResult}
      onClose={onClose}
      title={t($ => $.import.csvTitle)}
      uploadHelp={t($ => $.import.uploadHelp)}
      mapHelp={(count) => t($ => $.import.mapHelp, { count })}
      formatResult={(result) => (result.skipped > 0
        ? t($ => $.import.resultSkipped, { count: result.imported, skipped: result.skipped })
        : t($ => $.import.result, { count: result.imported }))}
    />
  )
}
