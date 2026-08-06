import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import Typography from '@mui/material/Typography'
import AttachFileIcon from '@mui/icons-material/AttachFile'
import { getBannerPath } from '../api/profile.ts'
import { setMyTaskDone, type MyGig } from '../api/me.ts'
import GigTasks from './GigTasks.tsx'
import { SourceTenantSwitch } from './SourceTenantIdentity.tsx'
import { venueCity, venueHeadline } from '../utils/venueDisplay.ts'
import type { PurchaseAttachment, Task } from '../types/entities.ts'

interface Props {
  gig: MyGig
  initialTab?: 'event' | 'tasks'
}

function Field({ label, value }: Readonly<{ label: string; value?: string | null }>) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="body2">{value || '—'}</Typography>
    </Box>
  )
}

export default function CrossTenantGigDetail({ gig, initialTab = 'event' }: Readonly<Props>) {
  const { t } = useTranslation('gigs')
  const [activeTab, setActiveTab] = useState<'event' | 'tasks'>(initialTab)
  const [artistBannerPath, setArtistBannerPath] = useState<string | null>(null)

  useEffect(() => {
    getBannerPath().then(setArtistBannerPath).catch(() => setArtistBannerPath(null))
  }, [])

  const place = gig.venue ?? gig.festival
  const attachments = (gig as MyGig & { attachments?: PurchaseAttachment[] }).attachments ?? []
  const tasks = (gig as MyGig & { tasks?: Task[] }).tasks ?? []

  return (
    <Box>
      <SourceTenantSwitch
        tenantId={gig.tenantId}
        tenantName={gig.tenantName}
        tenantAvatarPath={gig.tenantAvatarPath}
      />

      <Box
        data-testid="artist-only-gig-hero"
        sx={{
          height: { xs: 150, sm: 210 },
          borderRadius: 1,
          bgcolor: 'grey.800',
          backgroundImage: artistBannerPath ? `url(/api/files/${artistBannerPath})` : undefined,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          display: 'flex',
          alignItems: 'flex-end',
          p: 2,
        }}
      >
        <Typography variant="h5" sx={{ color: 'common.white', textShadow: '0 1px 4px #000' }}>
          {gig.event_description || t($ => $.page.titleFallback)}
        </Typography>
      </Box>

      <Tabs value={activeTab} onChange={(_e, value) => setActiveTab(value as 'event' | 'tasks')} centered>
        <Tab value="event" label={t($ => $.detail.tabs.event)} />
        <Tab value="tasks" label={t($ => $.detail.tabs.tasks)} />
      </Tabs>

      {activeTab === 'event' && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={2}>
            <Field label={t($ => $.detail.date)} value={String(gig.event_date ?? '').slice(0, 10)} />
            <Field label={t($ => $.detail.eventDescription)} value={gig.event_description} />
            <Field
              label={t($ => $.detail.location)}
              value={[venueHeadline(place), venueCity(place)].filter(Boolean).join(' · ')}
            />
            <Field label={t($ => $.detail.startTime)} value={gig.start_time?.slice(0, 5)} />
            <Field label={t($ => $.detail.endTime)} value={gig.end_time?.slice(0, 5)} />
            {attachments.length > 0 && (
              <>
                <Divider />
                <Typography variant="subtitle2">{t($ => $.detail.attachments)}</Typography>
                {attachments.map((attachment) => (
                  <Stack key={String(attachment.id)} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <AttachFileIcon fontSize="small" color="action" />
                    <Typography variant="body2">{attachment.original_filename}</Typography>
                  </Stack>
                ))}
              </>
            )}
          </Stack>
        </Paper>
      )}

      {activeTab === 'tasks' && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <GigTasks
            gigId={gig.id!}
            initialTasks={tasks}
            canWrite={false}
            currentBandMemberId={gig.viewerBandMemberId}
            onToggleTask={async (task, done) => {
              if (task.id == null) return task
              return setMyTaskDone(task.id, done)
            }}
          />
        </Paper>
      )}
    </Box>
  )
}

export function CrossTenantGigLoading() {
  return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
}
