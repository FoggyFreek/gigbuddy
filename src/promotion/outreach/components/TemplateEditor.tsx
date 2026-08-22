import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState, type DragEvent } from 'react'
import EditIcon from '@mui/icons-material/Edit'
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined'
import VisibilityIcon from '@mui/icons-material/Visibility'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import { alpha, useTheme } from '@mui/material/styles'
import { composeReactEmail } from '@react-email/editor/core'
import '@react-email/editor/themes/default.css'
import './TemplateEditor.css'
import { StarterKit, type StarterKitOptions } from '@react-email/editor/extensions'
import { EmailTheming, useEditorImage } from '@react-email/editor/plugins'
import {
  AlignCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  BubbleMenu,
  bubbleMenuTriggers,
  defaultSlashCommands,
  Inspector,
  SlashCommand,
} from '@react-email/editor/ui'
import { PluginKey } from '@tiptap/pm/state'
import { EditorContent, EditorContext, useCurrentEditor, useEditor, useEditorState } from '@tiptap/react'
import DOMPurify from 'dompurify'
import { useTranslation } from 'react-i18next'
import { mergeBlocks, mergeTokens, normalizeTokenCase } from '../../../../shared/outreachMerge.js'
import { useThemeMode } from '../../../contexts/themeModeContext.ts'
import type { OutreachField, OutreachImageOption } from '../outreachTemplates.ts'
import { withImageAlignment } from '../editor/alignedImageExtension.tsx'
import { MergeBlock, MergeField } from '../editor/mergeFieldExtension.ts'

interface Props {
  content: Record<string, unknown>
  fields: OutreachField[]
  images?: OutreachImageOption[]
  locale?: 'nl' | 'en'
  previewSubject?: string
  canWrite?: boolean
  onUpdate: (value: { body_json: Record<string, unknown> }) => void
}

type EditorMode = 'edit' | 'preview'
type DockTab = 'fields' | 'images'
type SocialColor = 'black' | 'white'

export interface SerializedTemplateContent {
  body_json: Record<string, unknown>
  body_html: string
  body_text: string
}

export interface TemplateEditorRef {
  getSerializedContent: () => Promise<SerializedTemplateContent | null>
  getCurrentJson: () => Record<string, unknown> | null
}

const MERGE_FIELD_MIME = 'application/x-gigbuddy-merge-field'
const TEMPLATE_IMAGE_MIME = 'application/x-gigbuddy-template-image'
const TEMPLATE_ALIGNMENT_TYPES = [
  'heading',
  'paragraph',
  'image',
  'blockquote',
  'bulletList',
  'orderedList',
  'listItem',
  'button',
  'table',
  'tableRow',
  'tableCell',
  'tableHeader',
  'columnsColumn',
]
const TEMPLATE_ALIGNMENTS = ['left', 'center', 'right'] as const
const ALIGNMENT_ICONS = {
  left: AlignLeftIcon,
  center: AlignCenterIcon,
  right: AlignRightIcon,
} as const
const IMAGE_BUBBLE_MENU_KEY = new PluginKey('gigbuddyImageBubbleMenu')
const BUTTON_BUBBLE_MENU_KEY = new PluginKey('gigbuddyButtonBubbleMenu')

const rejectImageUpload = async () => {
  throw new Error('Direct image uploads are not supported')
}

function TemplateImageBubbleMenu() {
  const { editor } = useCurrentEditor()
  const { t } = useTranslation('outreach')
  const alignment = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => String(currentEditor?.getAttributes('image').alignment ?? 'center'),
  })
  const hasLink = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => Boolean(currentEditor?.getAttributes('image').href),
  })

  if (!editor) return null

  return (
    <BubbleMenu.Root trigger={bubbleMenuTriggers.node('image')} pluginKey={IMAGE_BUBBLE_MENU_KEY} placement="top">
      <BubbleMenu.ImageToolbar>
        {TEMPLATE_ALIGNMENTS.map((value) => {
          const Icon = ALIGNMENT_ICONS[value]
          return (
            <BubbleMenu.Item
              key={value}
              name={t($ => $.editor.alignment[value])}
              isActive={alignment === value}
              onCommand={() => editor.chain().focus().updateAttributes('image', { alignment: value }).run()}
            >
              <Icon />
            </BubbleMenu.Item>
          )
        })}
        <BubbleMenu.Separator />
        <BubbleMenu.ImageEditLink />
        {hasLink && <BubbleMenu.ImageUnlink />}
      </BubbleMenu.ImageToolbar>
      <BubbleMenu.ImageForm />
    </BubbleMenu.Root>
  )
}

function TemplateButtonBubbleMenu() {
  const { editor } = useCurrentEditor()
  const { t } = useTranslation('outreach')
  const alignment = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => String(currentEditor?.getAttributes('button').alignment ?? 'left'),
  })
  const hasLink = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => {
      const href = currentEditor?.getAttributes('button').href
      return Boolean(href) && href !== '#'
    },
  })

  if (!editor) return null

  return (
    <BubbleMenu.Root trigger={bubbleMenuTriggers.node('button')} pluginKey={BUTTON_BUBBLE_MENU_KEY} placement="top">
      <BubbleMenu.ButtonToolbar>
        {TEMPLATE_ALIGNMENTS.map((value) => {
          const Icon = ALIGNMENT_ICONS[value]
          return (
            <BubbleMenu.Item
              key={value}
              name={t($ => $.editor.alignment[value])}
              isActive={alignment === value}
              onCommand={() => editor.chain().focus().updateAttributes('button', { alignment: value }).run()}
            >
              <Icon />
            </BubbleMenu.Item>
          )
        })}
        <BubbleMenu.Separator />
        <BubbleMenu.ButtonEditLink />
        {hasLink && <BubbleMenu.ButtonUnlink />}
      </BubbleMenu.ButtonToolbar>
      <BubbleMenu.ButtonForm />
    </BubbleMenu.Root>
  )
}

function mergeFieldContent(field: Pick<OutreachField, 'block' | 'key' | 'label'>) {
  return field.block
    ? { type: 'mergeBlock', attrs: { fieldKey: field.key, label: field.label } }
    : { type: 'mergeField', attrs: { fieldKey: field.key } }
}

function parseDraggedField(value: string): Pick<OutreachField, 'block' | 'key' | 'label'> | null {
  try {
    const field = JSON.parse(value) as Partial<OutreachField>
    if (typeof field.key !== 'string' || typeof field.label !== 'string' || typeof field.block !== 'boolean') return null
    return { block: field.block, key: field.key, label: field.label }
  } catch {
    return null
  }
}

function parseDraggedImage(value: string): Record<string, unknown> | null {
  try {
    const image = JSON.parse(value) as { type?: unknown; attrs?: unknown }
    if (image.type !== 'image' || !image.attrs || typeof image.attrs !== 'object') return null
    const src = (image.attrs as Record<string, unknown>).src
    if (typeof src !== 'string' || !src.startsWith('http')) return null
    return image as Record<string, unknown>
  } catch {
    return null
  }
}

const TemplateEditor = forwardRef<TemplateEditorRef, Readonly<Props>>(function TemplateEditor(
  { content, fields, images = [], locale = 'nl', previewSubject, canWrite = true, onUpdate },
  forwardedRef,
) {
  const theme = useTheme()
  const { mode } = useThemeMode()
  const { t } = useTranslation('outreach')
  const [editorMode, setEditorMode] = useState<EditorMode>('edit')
  const [dockTab, setDockTab] = useState<DockTab>('fields')
  const [socialColor, setSocialColor] = useState<SocialColor>('black')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewSourceHtml, setPreviewSourceHtml] = useState('')
  const baseImageExtension = useEditorImage({ uploadImage: rejectImageUpload })
  const imageExtension = useMemo(() => withImageAlignment(baseImageExtension), [baseImageExtension])

  const previewValues = useMemo(() => ({
    fields: Object.fromEntries(fields.filter((field) => !field.block).map((field) => [field.key, field.sample || `{{${field.key}}}`])),
    blocks: Object.fromEntries(fields.filter((field) => field.block).map((field) => [field.key, `<div style="border:1px dashed #888;padding:12px">${field.label}</div>`])),
  }), [fields])
  const previewHtml = useMemo(() => DOMPurify.sanitize(
    mergeBlocks(mergeTokens(previewSourceHtml, previewValues.fields, { escape: true }), previewValues.blocks),
  ), [previewSourceHtml, previewValues])
  const resolvedPreviewSubject = useMemo(
    () => previewSubject ? mergeTokens(previewSubject, previewValues.fields) : '',
    [previewSubject, previewValues],
  )

  // React Email places some floating UI outside the editor's immediate DOM.
  // Set its documented variables at the root while this editor is mounted so
  // bubble menus, slash commands, selectors, and inspectors all follow the
  // resolved GigBuddy theme (mode, variant, and tenant accent).
  useEffect(() => {
    const root = document.documentElement
    const variables = {
      '--re-bg': theme.palette.background.paper,
      '--re-input-bg': theme.palette.background.paper,
      '--re-bg-active': theme.palette.action.selected,
      '--re-bg-hover': theme.palette.action.hover,
      '--re-border': theme.palette.divider,
      '--re-text': theme.palette.text.primary,
      '--re-text-muted': theme.palette.text.secondary,
      '--re-hover': theme.palette.action.hover,
      '--re-active': theme.palette.action.selected,
      '--re-pressed': alpha(theme.palette.primary.main, mode === 'dark' ? 0.24 : 0.12),
      '--re-separator': theme.palette.divider,
      '--re-radius': `${theme.shape.borderRadius}px`,
      '--re-radius-sm': `${Math.max(Number(theme.shape.borderRadius) - 2, 2)}px`,
      '--re-shadow': theme.shadows[8],
      '--re-danger': theme.palette.error.main,
      '--re-danger-hover': alpha(theme.palette.error.main, 0.12),
      '--re-tooltip-bg': theme.palette.text.primary,
      '--re-tooltip-text': theme.palette.background.paper,
    }
    const previous = Object.fromEntries(Object.keys(variables).map((name) => [name, root.style.getPropertyValue(name)]))
    for (const [name, value] of Object.entries(variables)) root.style.setProperty(name, value)
    return () => {
      for (const [name, value] of Object.entries(previous)) {
        if (value) root.style.setProperty(name, value)
        else root.style.removeProperty(name)
      }
    }
  }, [mode, theme])
  const extensions = useMemo(() => {
    const common: Partial<StarterKitOptions> = {
      CodeBlockPrism: false,
      Code: false,
      AlignmentAttribute: {
        types: TEMPLATE_ALIGNMENT_TYPES,
        alignments: [...TEMPLATE_ALIGNMENTS],
      },
      TwoColumns: {},
      ThreeColumns: {},
      FourColumns: {},
      ColumnsColumn: {},
      Button: {},
    }
    return [
      StarterKit.configure(common),
      EmailTheming.configure({ theme: 'basic' }),
      MergeField,
      MergeBlock,
      imageExtension,
    ]
  }, [imageExtension])

  const editor = useEditor({
    extensions,
    content,
    editable: canWrite,
    immediatelyRender: false,
    onUpdate: ({ editor: updatedEditor }) => {
      if (!canWrite) return
      onUpdate({ body_json: updatedEditor.getJSON() as Record<string, unknown> })
    },
  }, [extensions, canWrite])
  const editorContextValue = useMemo(() => ({ editor }), [editor])

  const getCurrentJson = useCallback((): Record<string, unknown> | null => {
    return editor ? editor.getJSON() as Record<string, unknown> : null
  }, [editor])

  const getSerializedContent = useCallback(async (): Promise<SerializedTemplateContent | null> => {
    if (!editor) return null
    const email = await composeReactEmail({ editor })
    // The plain-text pass uppercases heading content, so a merge field placed in
    // a heading would serialize as {{INVOICE.NUMBER}} and never resolve.
    return {
      body_json: editor.getJSON() as Record<string, unknown>,
      body_html: normalizeTokenCase(email.html),
      body_text: normalizeTokenCase(email.text),
    }
  }, [editor])

  const editorHandle = useMemo<TemplateEditorRef>(
    () => ({ getCurrentJson, getSerializedContent }),
    [getCurrentJson, getSerializedContent],
  )
  useImperativeHandle(forwardedRef, () => editorHandle, [editorHandle])

  async function switchMode(nextMode: EditorMode | null) {
    if (!nextMode || nextMode === editorMode) return
    setEditorMode(nextMode)
    if (nextMode !== 'preview') {
      setPreviewLoading(false)
      return
    }
    if (!editor) return
    editor.commands.blur()
    setPreviewLoading(true)
    try {
      const email = await composeReactEmail({ editor })
      setPreviewSourceHtml(email.html)
    } catch {
      setPreviewSourceHtml('')
    } finally {
      setPreviewLoading(false)
    }
  }

  function insertField(field: OutreachField) {
    if (!canWrite) return
    if (!editor) return
    editor.chain().focus().insertContent(mergeFieldContent(field)).run()
  }

  function startFieldDrag(event: DragEvent<HTMLButtonElement>, field: OutreachField) {
    if (!canWrite) return
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData(MERGE_FIELD_MIME, JSON.stringify({
      block: field.block,
      key: field.key,
      label: field.label,
    }))
  }

  function imageContent(image: OutreachImageOption) {
    const src = image.category === 'social' && socialColor === 'white' ? image.whiteSrc ?? image.src : image.src
    return {
      type: 'image',
      attrs: {
        src,
        alt: t($ => $.editor.images.items[image.key], { lng: locale }),
        width: image.defaultWidth,
        height: image.defaultHeight,
        alignment: 'center',
        href: image.href ?? null,
      },
    }
  }

  function insertImage(image: OutreachImageOption) {
    if (!canWrite || !image.available || !editor) return
    editor.chain().focus().insertContent(imageContent(image)).run()
  }

  function startImageDrag(event: DragEvent<HTMLButtonElement>, image: OutreachImageOption) {
    if (!canWrite || !image.available) return
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData(TEMPLATE_IMAGE_MIME, JSON.stringify(imageContent(image)))
  }

  function allowEditorDrop(event: DragEvent<HTMLElement>) {
    if (!canWrite || !event.dataTransfer.types.some((type) => type === MERGE_FIELD_MIME || type === TEMPLATE_IMAGE_MIME)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  function dropEditorItem(event: DragEvent<HTMLElement>) {
    if (!canWrite || !editor) return
    const field = parseDraggedField(event.dataTransfer.getData(MERGE_FIELD_MIME))
    const image = parseDraggedImage(event.dataTransfer.getData(TEMPLATE_IMAGE_MIME))
    const draggedContent = field ? mergeFieldContent(field) : image
    if (!draggedContent) return
    const position = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })
    if (!position) return
    event.preventDefault()
    editor.chain().focus().insertContentAt(position.pos, draggedContent).run()
  }

  return (
    <Stack spacing={1.5}>
      <ToggleButtonGroup
        exclusive
        size="small"
        value={editorMode}
        onChange={(_, nextMode: EditorMode | null) => { void switchMode(nextMode) }}
        aria-label={t($ => $.editor.mode)}
        sx={{ alignSelf: 'center' }}
      >
        <ToggleButton value="edit" aria-label={t($ => $.editor.edit)}>
          <EditIcon fontSize="small" sx={{ mr: 0.75 }} />{t($ => $.editor.edit)}
        </ToggleButton>
        <ToggleButton value="preview" aria-label={t($ => $.editor.preview)}>
          <VisibilityIcon fontSize="small" sx={{ mr: 0.75 }} />{t($ => $.editor.preview)}
        </ToggleButton>
      </ToggleButtonGroup>
      {editorMode === 'edit' && !canWrite && <Chip label="Read-only: your role cannot edit this template" sx={{ alignSelf: 'flex-start' }} />}
      <Paper variant="outlined" sx={{
        p: 2,
        '& .ProseMirror': { minHeight: 420, outline: 'none' },
        '& .gb-merge-field': {
          bgcolor: 'primary.main',
          color: 'primary.contrastText',
          borderRadius: 0,
          fontFamily: 'Consolas, "Courier New", monospace',
          px: 0.5,
        },
        '& .gb-merge-block': {
          border: '1px dashed',
          borderColor: 'primary.main',
          borderRadius: 0,
          fontFamily: 'Consolas, "Courier New", monospace',
          p: 1,
          my: 1,
        },
      }}>
        <Box
          className={`gb-template-editor-shell${editorMode === 'preview' ? ' gb-template-editor-shell--hidden' : ''}`}
          hidden={editorMode === 'preview'}
        >
          <Box
            component="aside"
            className="gb-merge-fields-dock"
            aria-label={dockTab === 'fields' ? t($ => $.editor.images.mergeFields) : t($ => $.editor.images.title)}
          >
            <Tabs
              value={dockTab}
              onChange={(_, value: DockTab) => setDockTab(value)}
              variant="fullWidth"
              aria-label={t($ => $.editor.images.library)}
              sx={{ mb: 1 }}
            >
              <Tab value="fields" label={t($ => $.editor.images.mergeFields)} />
              <Tab value="images" label={t($ => $.editor.images.title)} />
            </Tabs>
            {dockTab === 'fields' && (
              <Box className="gb-merge-fields-list">
                {fields.map((field) => (
                  <Button
                    key={field.key}
                    size="small"
                    variant="outlined"
                    draggable={canWrite}
                    onDragStart={(event) => startFieldDrag(event, field)}
                    onClick={() => insertField(field)}
                    disabled={!canWrite}
                    sx={{ justifyContent: 'flex-start', textAlign: 'left' }}
                  >
                    {field.block ? '#' : ''}{field.label}
                  </Button>
                ))}
              </Box>
            )}
            {dockTab === 'images' && (
              <Stack spacing={1.5}>
                <Typography variant="subtitle2">{t($ => $.editor.images.branding)}</Typography>
                <Box className="gb-template-image-grid">
                  {images.filter((image) => image.category === 'branding').map((image) => {
                    const label = t($ => $.editor.images.items[image.key])
                    return (
                      <Button
                        key={image.key}
                        className="gb-template-image-tile"
                        aria-label={label}
                        draggable={canWrite && image.available}
                        disabled={!canWrite || !image.available}
                        onDragStart={(event) => startImageDrag(event, image)}
                        onClick={() => insertImage(image)}
                      >
                        {image.available
                          ? <Box component="img" src={image.src} alt="" />
                          : <ImageOutlinedIcon aria-hidden="true" sx={{ width: '3rem', height: '3rem' }} />}
                        <Typography variant="caption">{label}</Typography>
                        {!image.available && <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t($ => $.editor.images.configure)}</Typography>}
                      </Button>
                    )
                  })}
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                  <Typography variant="subtitle2">{t($ => $.editor.images.social)}</Typography>
                  <ToggleButtonGroup
                    exclusive
                    size="small"
                    value={socialColor}
                    onChange={(_, value: SocialColor | null) => { if (value) setSocialColor(value) }}
                    aria-label={t($ => $.editor.images.color)}
                  >
                    <ToggleButton value="black">{t($ => $.editor.images.black)}</ToggleButton>
                    <ToggleButton value="white">{t($ => $.editor.images.white)}</ToggleButton>
                  </ToggleButtonGroup>
                </Box>
                <Box className={`gb-template-image-grid${socialColor === 'white' ? ' gb-template-image-grid--white' : ''}`}>
                  {images.filter((image) => image.category === 'social').map((image) => {
                    const label = t($ => $.editor.images.items[image.key])
                    const src = socialColor === 'white' ? image.whiteSrc ?? image.src : image.src
                    return (
                      <Button
                        key={image.key}
                        className="gb-template-image-tile"
                        aria-label={label}
                        draggable={canWrite && image.available}
                        disabled={!canWrite || !image.available}
                        onDragStart={(event) => startImageDrag(event, image)}
                        onClick={() => insertImage(image)}
                      >
                        <Box component="img" src={src} alt="" />
                        <Typography variant="caption">{label}</Typography>
                        {!image.available && <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t($ => $.editor.images.configure)}</Typography>}
                      </Button>
                    )
                  })}
                </Box>
              </Stack>
            )}
          </Box>
          <EditorContext.Provider value={editorContextValue}>
            <Box
              className="gb-template-editor-canvas"
              data-testid="email-editor-canvas"
              onDragOver={allowEditorDrop}
              onDrop={dropEditorItem}
            >
              <EditorContent editor={editor} />
              {canWrite && editor && <>
                <BubbleMenu hideWhenActiveNodes={['button', 'image']} hideWhenActiveMarks={['link']} />
                <BubbleMenu.LinkDefault />
                <TemplateButtonBubbleMenu />
                <TemplateImageBubbleMenu />
                <SlashCommand items={defaultSlashCommands} />
              </>}
            </Box>
            {canWrite && editor && (
              <Inspector.Root className="gb-template-editor-inspector" aria-label={t($ => $.editor.designProperties)}>
                <Inspector.Breadcrumb />
                <Inspector.Document />
                <Inspector.Node />
                <Inspector.Text />
              </Inspector.Root>
            )}
          </EditorContext.Provider>
        </Box>
        {editorMode === 'preview' && (
          <Stack spacing={1}>
            {resolvedPreviewSubject && <Typography variant="subtitle2">{resolvedPreviewSubject}</Typography>}
            {previewLoading
              ? <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 650 }}><CircularProgress /></Box>
              : <Box
                  component="iframe"
                  title={t($ => $.editor.preview)}
                  sandbox=""
                  srcDoc={previewHtml}
                  sx={{ width: '100%', height: 650, border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}
                />}
          </Stack>
        )}
      </Paper>
    </Stack>
  )
})

export default TemplateEditor
