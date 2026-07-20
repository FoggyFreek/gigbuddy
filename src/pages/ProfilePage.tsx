import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import Grid from '@mui/material/Grid'
import Paper from '@mui/material/Paper'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import Typography from '@mui/material/Typography'
import Snackbar from '@mui/material/Snackbar'
import useDebouncedSave from '../hooks/useDebouncedSave.ts'
import { useImageUpload, JPEG_PNG_WEBP } from '../hooks/useImageCrop.ts'
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
import { usePermissions } from '../hooks/usePermissions.ts'
import PlanningReadOnlyAlert from '../components/PlanningReadOnlyAlert.tsx'

interface ProfileLink {
  id?: Id
  label?: string
  url?: string
  sort_order?: number
}

export default function ProfilePage() {
  const { t } = useTranslation('profile')
  const { user } = useAuth()
  const { canWritePlanning } = usePermissions()
  const isAdmin = user?.isSuperAdmin || user?.activeTenantRole === 'tenant_admin'

  const [form, setForm] = useState<ProfileForm>(EMPTY_FORM)
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
  const { setBandName, setVatSettings } = useProfile()

  const logo = useImageUpload({
    compress: compressLogo,
    upload: async (file) => (await uploadLogo(file)).logo_path ?? null,
    onError: setSnackbar, allowedTypes: JPEG_PNG_WEBP,
    accept: 'image/jpeg,image/png,image/webp',
    title: t($ => $.crop.logo), canEdit: isAdmin,
  })
  const logoDark = useImageUpload({
    compress: compressLogo,
    upload: async (file) => (await uploadLogoDark(file)).logo_dark_path ?? null,
    onError: setSnackbar, allowedTypes: JPEG_PNG_WEBP,
    accept: 'image/jpeg,image/png,image/webp',
    title: t($ => $.crop.logoDark), canEdit: isAdmin,
  })
  const banner = useImageUpload({
    compress: compressBanner,
    upload: async (file) => (await uploadBanner(file)).banner_path ?? null,
    onError: setSnackbar, allowedTypes: JPEG_PNG_WEBP,
    accept: 'image/jpeg,image/png,image/webp',
    title: t($ => $.crop.banner), aspect: 820 / 360, canEdit: isAdmin,
  })
  const avatar = useImageUpload({
    compress: compressAvatar,
    upload: async (file) => (await uploadAvatar(file)).avatar_path ?? null,
    onError: setSnackbar, allowedTypes: JPEG_PNG_WEBP,
    accept: 'image/jpeg,image/png,image/webp',
    title: t($ => $.crop.avatar), aspect: 1, canEdit: isAdmin,
  })
  const imageSlots = [logo, logoDark, banner, avatar]

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
        logo.setPath(data.logo_path ?? null)
        banner.setPath(data.banner_path ?? null)
        avatar.setPath(data.avatar_path ?? null)
        logoDark.setPath(data.logo_dark_path ?? null)
        setLinks((data.links as ProfileLink[]) || [])
      })
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleChange(field: string, value: unknown) {
    if (!canWritePlanning) return
    setForm((prev) => ({ ...prev, [field]: value }))
    if (field === 'band_name') setBandName(String(value))
    if (field === 'vat_country') setVatSettings(String(value), Number(form.tax_percentage))
    if (field === 'tax_percentage') setVatSettings(form.vat_country, Number(value))
    schedule({ [field]: value } as Partial<ProfileForm>)
  }

  async function handleAddLink() {
    if (!canWritePlanning) return
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
    if (!canWritePlanning) return
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
        <Typography variant="h5" sx={{ fontWeight: 600, flexGrow: 1 }}>{t($ => $.title)}</Typography>
        {canWritePlanning && <SaveStatusLabel status={saveStatus} />}
      </Box>

      <PlanningReadOnlyAlert canWrite={canWritePlanning} />

      <Grid container spacing={3} sx={{ mb: 3, alignItems: 'flex-start' }}>
        <Grid size={{ xs: 12, lg: 8 }}>
          {/* Hidden file inputs — live here to keep refs away from child render paths */}
          {imageSlots.map((slot) => (
            <input
              key={slot.title}
              ref={slot.inputRef}
              type="file"
              accept={slot.accept}
              style={{ display: 'none' }}
              onChange={slot.handleFileChange}
            />
          ))}

          <ProfileIdentityCard
            form={form}
            isAdmin={isAdmin}
            editing={canWritePlanning && editingIdentity}
            canEdit={canWritePlanning}
            onToggleEditing={() => setEditingIdentity((v) => !v)}
            onChange={handleChange}
            logo={logo.cardProps}
            logoDark={logoDark.cardProps}
            banner={banner.cardProps}
            avatar={avatar.cardProps}
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
              <Tab value="socials" label={t($ => $.tabs.socials)} />
              <Tab value="links" label={t($ => $.tabs.links)} />
              <Tab value="financials" label={t($ => $.tabs.financials)} />
            </Tabs>

            {activeTab === 'socials' && (
              <ProfileSocialsTab
                form={form}
                editing={canWritePlanning && editingSocials}
                canEdit={canWritePlanning}
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
                canEdit={canWritePlanning}
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

      {imageSlots.map((slot) => (
        <ImageCropDialog
          key={slot.title}
          open={slot.cropOpen}
          imageSrc={slot.cropSrc}
          title={slot.title}
          aspect={slot.aspect}
          onConfirm={slot.handleCropConfirm}
          onCancel={slot.handleCropCancel}
        />
      ))}
    </Box>
  )
}
