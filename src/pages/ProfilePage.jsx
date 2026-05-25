import { useCallback, useEffect, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import Grid from '@mui/material/Grid'
import Paper from '@mui/material/Paper'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import Typography from '@mui/material/Typography'
import Snackbar from '@mui/material/Snackbar'
import useDebouncedSave from '../hooks/useDebouncedSave.js'
import { useAuth } from '../contexts/authContext.js'
import { useProfile } from '../contexts/profileContext.js'
import BandMembersSection from '../components/BandMembersSection.jsx'
import ImageCropDialog from '../components/ImageCropDialog.jsx'
import { createLink, deleteLink, getProfile, updateProfile, uploadLogo } from '../api/profile.js'
import { compressLogo } from '../utils/compressImage.js'
import { EMPTY_FORM, profileToForm } from '../components/profile/profileForm.js'
import ProfileIdentityCard from '../components/profile/ProfileIdentityCard.jsx'
import ProfileSocialsTab from '../components/profile/ProfileSocialsTab.jsx'
import ProfileLinksTab from '../components/profile/ProfileLinksTab.jsx'
import ProfileFinancialsTab from '../components/profile/ProfileFinancialsTab.jsx'
import SaveStatusLabel from '../components/SaveStatusLabel.jsx'

export default function ProfilePage() {
  const { user } = useAuth()
  const isAdmin = user?.isSuperAdmin || user?.activeTenantRole === 'tenant_admin'

  const [form, setForm] = useState(EMPTY_FORM)
  const [logoPath, setLogoPath] = useState(null)
  const [logoUploading, setLogoUploading] = useState(false)
  const [logoCropOpen, setLogoCropOpen] = useState(false)
  const [logoCropSrc, setLogoCropSrc] = useState(null)
  const [links, setLinks] = useState([])
  const [loading, setLoading] = useState(true)
  const [newLink, setNewLink] = useState({ label: '', url: '' })
  const [adding, setAdding] = useState(false)
  const [copiedField, setCopiedField] = useState(null)
  const [editingIdentity, setEditingIdentity] = useState(false)
  const [editingSocials, setEditingSocials] = useState(false)
  const [editingFinancials, setEditingFinancials] = useState(false)
  const [activeTab, setActiveTab] = useState('socials')
  const [snackbar, setSnackbar] = useState(null)
  const logoInputRef = useRef(null)
  const { setBandName } = useProfile()

  function handleCopy(field, text) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedField(field)
      setTimeout(() => setCopiedField((c) => (c === field ? null : c)), 1500)
    }).catch(() => {})
  }

  const saveFn = useCallback(async (patch) => { await updateProfile(patch) }, [])
  const { schedule, status: saveStatus } = useDebouncedSave(saveFn)

  useEffect(() => {
    getProfile()
      .then((data) => {
        setForm(profileToForm(data))
        setLogoPath(data.logo_path || null)
        setLinks(data.links || [])
      })
      .finally(() => setLoading(false))
  }, [])

  function handleLogoFileChange(e) {
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

  async function handleLogoCropConfirm(blob) {
    setLogoCropOpen(false)
    if (logoCropSrc) URL.revokeObjectURL(logoCropSrc)
    setLogoCropSrc(null)
    setLogoUploading(true)
    try {
      const compressed = await compressLogo(blob)
      const { logo_path } = await uploadLogo(compressed)
      setLogoPath(logo_path)
    } catch (err) {
      setSnackbar(err.message || 'Upload failed')
    } finally {
      setLogoUploading(false)
    }
  }

  function handleLogoCropCancel() {
    setLogoCropOpen(false)
    if (logoCropSrc) URL.revokeObjectURL(logoCropSrc)
    setLogoCropSrc(null)
  }

  function handleChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
    if (field === 'band_name') setBandName(value)
    schedule({ [field]: value })
  }

  async function handleAddLink() {
    if (!newLink.label.trim() || !newLink.url.trim() || adding) return
    setAdding(true)
    try {
      const created = await createLink({ label: newLink.label.trim(), url: newLink.url.trim() })
      setLinks((prev) => [...prev, created])
      setNewLink({ label: '', url: '' })
    } finally {
      setAdding(false)
    }
  }

  async function handleDeleteLink(id) {
    await deleteLink(id)
    setLinks((prev) => prev.filter((l) => l.id !== id))
  }

  function handleLinkChange(id, patch) {
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
        <Typography variant="h5" fontWeight={600} sx={{ flexGrow: 1 }}>Profile</Typography>
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
            logoPath={logoPath}
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
              onChange={(_e, v) => setActiveTab(v)}
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
                copiedField={copiedField}
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
