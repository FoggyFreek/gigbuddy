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
import { useImageCrop, JPEG_PNG, JPEG_PNG_WEBP } from '../hooks/useImageCrop.ts'
import { useAuth } from '../contexts/authContext.ts'
import { useProfile } from '../contexts/profileContext.ts'
import BandMembersSection from '../components/BandMembersSection.tsx'
import ImageCropDialog from '../components/ImageCropDialog.tsx'
import {
  createLink, deleteLink, getProfile, updateProfile,
  uploadLogo, uploadBanner, uploadAvatar, uploadLogoDark,
} from '../api/profile.ts'
import { compressLogo, compressBanner, compressAvatar } from '../utils/compressImage.ts'
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
  const [bannerPath, setBannerPath] = useState<string | null>(null)
  const [avatarPath, setAvatarPath] = useState<string | null>(null)
  const [logoDarkPath, setLogoDarkPath] = useState<string | null>(null)
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
  const { setBandName } = useProfile()

  const logoInputRef = useRef<HTMLInputElement>(null)
  const bannerInputRef = useRef<HTMLInputElement>(null)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const logoDarkInputRef = useRef<HTMLInputElement>(null)

  const logoCrop = useImageCrop(
    compressLogo,
    async (file) => { const r = await uploadLogo(file); setLogoPath(r.logo_path ?? null) },
    setSnackbar,
    JPEG_PNG_WEBP,
  )
  const bannerCrop = useImageCrop(
    compressBanner,
    async (file) => { const r = await uploadBanner(file); setBannerPath(r.banner_path ?? null) },
    setSnackbar,
    JPEG_PNG,
  )
  const avatarCrop = useImageCrop(
    compressAvatar,
    async (file) => { const r = await uploadAvatar(file); setAvatarPath(r.avatar_path ?? null) },
    setSnackbar,
    JPEG_PNG,
  )
  const logoDarkCrop = useImageCrop(
    compressLogo,
    async (file) => { const r = await uploadLogoDark(file); setLogoDarkPath(r.logo_dark_path ?? null) },
    setSnackbar,
    JPEG_PNG_WEBP,
  )

  const openLogoPicker = useCallback(() => logoInputRef.current?.click(), [])
  const openBannerPicker = useCallback(() => bannerInputRef.current?.click(), [])
  const openAvatarPicker = useCallback(() => avatarInputRef.current?.click(), [])
  const openLogoDarkPicker = useCallback(() => logoDarkInputRef.current?.click(), [])

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
        setLogoPath(data.logo_path ?? null)
        setBannerPath(data.banner_path ?? null)
        setAvatarPath(data.avatar_path ?? null)
        setLogoDarkPath(data.logo_dark_path ?? null)
        setLinks((data.links as ProfileLink[]) || [])
      })
      .finally(() => setLoading(false))
  }, [])

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
        <Typography variant="h5" sx={{ fontWeight: 600, flexGrow: 1 }}>Profile</Typography>
        <SaveStatusLabel status={saveStatus} />
      </Box>

      <Grid container spacing={3} sx={{ mb: 3, alignItems: 'flex-start' }}>
        <Grid size={{ xs: 12, lg: 8 }}>
          {/* Hidden file inputs — live here to keep refs away from child render paths */}
          <input ref={logoInputRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={logoCrop.handleFileChange} />
          <input ref={bannerInputRef} type="file" accept="image/jpeg,image/png" style={{ display: 'none' }} onChange={bannerCrop.handleFileChange} />
          <input ref={avatarInputRef} type="file" accept="image/jpeg,image/png" style={{ display: 'none' }} onChange={avatarCrop.handleFileChange} />
          <input ref={logoDarkInputRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={logoDarkCrop.handleFileChange} />

          <ProfileIdentityCard
            form={form}
            isAdmin={isAdmin}
            editing={editingIdentity}
            onToggleEditing={() => setEditingIdentity((v) => !v)}
            onChange={handleChange}
            logo={{ path: logoPath, uploading: logoCrop.uploading, onUploadClick: isAdmin ? openLogoPicker : undefined }}
            logoDark={{ path: logoDarkPath, uploading: logoDarkCrop.uploading, onUploadClick: isAdmin ? openLogoDarkPicker : undefined }}
            banner={{ path: bannerPath, uploading: bannerCrop.uploading, onUploadClick: isAdmin ? openBannerPicker : undefined }}
            avatar={{ path: avatarPath, uploading: avatarCrop.uploading, onUploadClick: isAdmin ? openAvatarPicker : undefined }}
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
        open={logoCrop.cropOpen}
        imageSrc={logoCrop.cropSrc}
        title="Crop band logo"
        onConfirm={logoCrop.handleCropConfirm}
        onCancel={logoCrop.handleCropCancel}
      />
      <ImageCropDialog
        open={logoDarkCrop.cropOpen}
        imageSrc={logoDarkCrop.cropSrc}
        title="Crop dark logo"
        onConfirm={logoDarkCrop.handleCropConfirm}
        onCancel={logoDarkCrop.handleCropCancel}
      />
      <ImageCropDialog
        open={bannerCrop.cropOpen}
        imageSrc={bannerCrop.cropSrc}
        title="Crop profile banner"
        aspect={820 / 360}
        onConfirm={bannerCrop.handleCropConfirm}
        onCancel={bannerCrop.handleCropCancel}
      />
      <ImageCropDialog
        open={avatarCrop.cropOpen}
        imageSrc={avatarCrop.cropSrc}
        title="Crop profile picture"
        aspect={1}
        onConfirm={avatarCrop.handleCropConfirm}
        onCancel={avatarCrop.handleCropCancel}
      />
    </Box>
  )
}
