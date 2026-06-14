import { useCallback, useEffect, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import Grid from '@mui/material/Grid'
import Paper from '@mui/material/Paper'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import Typography from '@mui/material/Typography'
import Snackbar from '@mui/material/Snackbar'
import useDebouncedSave from '../hooks/useDebouncedSave.ts'
import { useAuth } from '../contexts/authContext.ts'
import { useProfile } from '../contexts/profileContext.ts'
import BandMembersSection from '../components/BandMembersSection.tsx'
import ImageCropDialog from '../components/ImageCropDialog.tsx'
import { createLink, deleteLink, getProfile, updateProfile, uploadLogo } from '../api/profile.ts'
import { compressLogo } from '../utils/compressImage.ts'
import { EMPTY_FORM, profileToForm, ProfileForm } from '../components/profile/profileForm.ts'
import ProfileIdentityCard from '../components/profile/ProfileIdentityCard.tsx'
import ProfileSocialsTab from '../components/profile/ProfileSocialsTab.tsx'
import ProfileLinksTab from '../components/profile/ProfileLinksTab.tsx'
import ProfileFinancialsTab from '../components/profile/ProfileFinancialsTab.tsx'
import SaveStatusLabel from '../components/SaveStatusLabel.tsx'
import type { Id } from '../types/entities.ts'

interface ProfileLink {
  id?: Id
  label?: string
  url?: string
  sort_order?: number
}

export default function ProfilePage() {
  const { user } = useAuth()
  const isAdmin = user?.isSuperAdmin || user?.activeTenantRole === 'tenant_admin'

  const [form, setForm] = useState<ProfileForm>(EMPTY_FORM)
  const [logoPath, setLogoPath] = useState<string | null>(null)
  const [logoUploading, setLogoUploading] = useState(false)
  const [logoCropOpen, setLogoCropOpen] = useState(false)
  const [logoCropSrc, setLogoCropSrc] = useState<string | null>(null)
  const [links, setLinks] = useState<ProfileLink[]>([])
  const [loading, setLoading] = useState(true)
  const [newLink, setNewLink] = useState<{ label: string; url: string }>({ label: '', url: '' })
  const [adding, setAdding] = useState(false)
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const [editingIdentity, setEditingIdentity] = useState(false)
  const [editingSocials, setEditingSocials] = useState(false)
  const [editingFinancials, setEditingFinancials] = useState(false)
  const [activeTab, setActiveTab] = useState('socials')
  const [snackbar, setSnackbar] = useState<string | null>(null)
  const logoInputRef = useRef<HTMLInputElement>(null)
  const { setBandName } = useProfile()

  function handleCopy(field: string, text: string) {
    const clearIfSame = (c: string | null) => (c === field ? null : c)
    navigator.clipboard.writeText(text).then(() => {
      setCopiedField(field)
      setTimeout(() => setCopiedField(clearIfSame), 1500)
    }).catch(() => {})
  }

  const saveFn = useCallback(async (patch: Partial<ProfileForm>) => { await updateProfile(patch) }, [])
  const { schedule, status: saveStatus } = useDebouncedSave(saveFn)

  useEffect(() => {
    getProfile()
      .then((data) => {
        setForm(profileToForm(data as Record<string, unknown>))
        setLogoPath((data.logo_path as string) || null)
        setLinks((data.links as ProfileLink[]) || [])
      })
      .finally(() => setLoading(false))
  }, [])

  function handleLogoFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    if (file.type === 'image/gif') {
      setSnackbar('File type not allowed')
      return
    }
    const url = URL.createObjectURL(file)
    setLogoCropSrc(url)
    setLogoCropOpen(true)
  }

  async function handleLogoCropConfirm(blob: Blob) {
    setLogoCropOpen(false)
    if (logoCropSrc) URL.revokeObjectURL(logoCropSrc)
    setLogoCropSrc(null)
    setLogoUploading(true)
    try {
      const compressed = await compressLogo(blob instanceof File ? blob : new File([blob], 'logo', { type: blob.type }))
      const result = await uploadLogo(compressed)
      setLogoPath((result as { logo_path?: string }).logo_path || null)
    } catch (err: unknown) {
      setSnackbar((err instanceof Error ? err.message : null) || 'Upload failed')
    } finally {
      setLogoUploading(false)
    }
  }

  function handleLogoCropCancel() {
    setLogoCropOpen(false)
    if (logoCropSrc) URL.revokeObjectURL(logoCropSrc)
    setLogoCropSrc(null)
  }

  function handleChange(field: string, value: unknown) {
    setForm((prev) => ({ ...prev, [field]: value }))
    if (field === 'band_name') setBandName(String(value))
    schedule({ [field]: value } as Partial<ProfileForm>)
  }

  async function handleAddLink() {
    if (!newLink.label.trim() || !newLink.url.trim() || adding) return
    setAdding(true)
    try {
      const created = await createLink({ label: newLink.label.trim(), url: newLink.url.trim() })
      setLinks((prev) => [...prev, created as ProfileLink])
      setNewLink({ label: '', url: '' })
    } finally {
      setAdding(false)
    }
  }

  async function handleDeleteLink(id: Id) {
    await deleteLink(id)
    setLinks((prev) => prev.filter((l) => l.id !== id))
  }

  function handleLinkChange(id: Id, patch: Partial<ProfileLink>) {
    setLinks((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)))
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    )
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 600,  flexGrow: 1  }}>Profile</Typography>
        <SaveStatusLabel status={saveStatus} />
      </Box>

      <Grid container spacing={3} sx={{ mb: 3, alignItems: 'flex-start' }}>
        <Grid size={{ xs: 12, lg: 8 }}>
          <ProfileIdentityCard
            form={form}
            isAdmin={isAdmin}
            editing={editingIdentity}
            onToggleEditing={() => setEditingIdentity((v) => !v)}
            onChange={handleChange}
            logoPath={logoPath ?? undefined}
            logoUploading={logoUploading}
            logoInputRef={logoInputRef}
            onLogoFileChange={handleLogoFileChange}
          />
        </Grid>
        <Grid size={{ xs: 12, lg: 4 }}>
          <BandMembersSection />
        </Grid>
      </Grid>

      <Grid container spacing={3} sx={{ mb: 3, alignItems: 'flex-start' }}>
        <Grid size={{ xs: 12, lg: 8 }}>
          <Paper variant="outlined">
            <Tabs
              value={activeTab}
              onChange={(_e, v) => setActiveTab(v as string)}
              variant="standard"
              textColor="primary"
              indicatorColor="primary"
            >
              <Tab value="socials" label="Social profiles" />
              <Tab value="links" label="Links" />
              <Tab value="financials" label="Financial details" />
            </Tabs>

            {activeTab === 'socials' && (
              <ProfileSocialsTab
                form={form}
                editing={editingSocials}
                onToggleEditing={() => setEditingSocials((v) => !v)}
                onChange={handleChange}
                copiedField={copiedField ?? undefined}
                onCopy={handleCopy}
              />
            )}

            {activeTab === 'links' && (
              <ProfileLinksTab
                links={links}
                newLink={newLink}
                setNewLink={setNewLink}
                adding={adding}
                onAdd={handleAddLink}
                onLinkChange={handleLinkChange}
                onDeleteLink={handleDeleteLink}
              />
            )}

            {activeTab === 'financials' && (
              <ProfileFinancialsTab
                form={form}
                isAdmin={isAdmin}
                editing={editingFinancials}
                onToggleEditing={() => setEditingFinancials((v) => !v)}
                onChange={handleChange}
                onFormChange={setForm}
                schedule={schedule}
              />
            )}
          </Paper>
        </Grid>
      </Grid>

      <Snackbar
        open={!!snackbar}
        autoHideDuration={4000}
        onClose={() => setSnackbar(null)}
        message={snackbar}
      />

      <ImageCropDialog
        open={logoCropOpen}
        imageSrc={logoCropSrc}
        title="Crop band logo"
        onConfirm={handleLogoCropConfirm}
        onCancel={handleLogoCropCancel}
      />
    </Box>
  )
}
