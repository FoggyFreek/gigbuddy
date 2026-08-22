import { createRef } from 'react'
import { act, createEvent, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAppTheme } from '../../../theme.ts'
import TemplateEditor from '../components/TemplateEditor.tsx'

const editorMocks = vi.hoisted(() => {
  const getJSON = vi.fn(() => ({ type: 'doc', content: [{ type: 'paragraph' }] }))
  const chainApi = {
    focus: vi.fn(),
    insertContent: vi.fn(),
    insertContentAt: vi.fn(),
    run: vi.fn(),
  }
  chainApi.focus.mockReturnValue(chainApi)
  chainApi.insertContent.mockReturnValue(chainApi)
  chainApi.insertContentAt.mockReturnValue(chainApi)
  chainApi.updateAttributes = vi.fn(() => chainApi)
  const editor = {
    commands: { blur: vi.fn() },
    getJSON,
    getAttributes: vi.fn(() => ({})),
    chain: vi.fn(() => chainApi),
    view: { posAtCoords: vi.fn(() => ({ pos: 7, inside: 1 })) },
  }
  return {
    composeReactEmail: vi.fn(async () => ({
      html: '<html><body>Hello {{contact.first_name}}</body></html>',
      text: 'Hello {{contact.first_name}}',
      unformattedHtml: '<html><body>Hello {{contact.first_name}}</body></html>',
    })),
    editor,
    chainApi,
    getJSON,
    imageExtension: { extend: vi.fn((config) => ({ ...config })) },
    onEditorUpdate: null,
    starterKitConfigure: vi.fn(() => ({})),
  }
})

vi.mock('@tiptap/react', () => ({
  EditorContext: { Provider: ({ children }) => children },
  EditorContent: ({ className }) => <div data-testid="email-editor" className={className} />,
  useEditor: (config) => {
    editorMocks.onEditorUpdate = config.onUpdate
    return editorMocks.editor
  },
  useCurrentEditor: () => ({ editor: editorMocks.editor }),
  useEditorState: ({ editor, selector }) => selector({ editor }),
}))

vi.mock('@tiptap/pm/state', () => ({
  PluginKey: class PluginKey {},
}))

vi.mock('@react-email/editor/core', () => ({
  composeReactEmail: editorMocks.composeReactEmail,
}))

vi.mock('@react-email/editor/ui', () => {
  const BubbleMenu = () => <div data-testid="bubble-menu" />
  BubbleMenu.LinkDefault = () => null
  BubbleMenu.Root = ({ children }) => <div data-testid="bubble-menu-root">{children}</div>
  BubbleMenu.Item = ({ name, isActive, onCommand, children }) => (
    <button type="button" aria-label={name} aria-pressed={isActive} onClick={onCommand}>{children}</button>
  )
  BubbleMenu.Separator = () => <hr />
  BubbleMenu.ImageToolbar = ({ children }) => <div data-testid="image-toolbar">{children}</div>
  BubbleMenu.ImageEditLink = () => null
  BubbleMenu.ImageUnlink = () => null
  BubbleMenu.ImageForm = () => null
  BubbleMenu.ButtonToolbar = ({ children }) => <div data-testid="button-toolbar">{children}</div>
  BubbleMenu.ButtonEditLink = () => null
  BubbleMenu.ButtonUnlink = () => null
  BubbleMenu.ButtonForm = () => null
  return {
    BubbleMenu,
    bubbleMenuTriggers: { node: () => () => true },
    AlignLeftIcon: () => null,
    AlignCenterIcon: () => null,
    AlignRightIcon: () => null,
    SlashCommand: () => <div data-testid="slash-command" />,
    defaultSlashCommands: [],
    Inspector: {
      Root: ({ children, ...props }) => <aside {...props}>{children}</aside>,
      Breadcrumb: () => <div data-testid="inspector-breadcrumb" />,
      Document: () => <div data-testid="inspector-document" />,
      Node: () => <div data-testid="inspector-node" />,
      Text: () => <div data-testid="inspector-text" />,
    },
  }
})

vi.mock('@react-email/editor/extensions', () => ({
  StarterKit: { configure: editorMocks.starterKitConfigure },
}))

vi.mock('@react-email/editor/plugins', () => ({
  EmailTheming: { configure: () => ({}) },
  useEditorImage: () => editorMocks.imageExtension,
}))

vi.mock('../editor/mergeFieldExtension.ts', () => ({ MergeBlock: {}, MergeField: {} }))

const imageOptions = [
  {
    key: 'avatar', category: 'branding', available: true,
    src: 'https://app.test/api/public/outreach/image/avatar?t=token',
    defaultWidth: '96', defaultHeight: '96',
  },
  {
    key: 'instagram', category: 'social', available: true,
    src: 'https://app.test/icons/socials/instagram.png',
    whiteSrc: 'https://app.test/icons/socials/instagram-white.png',
    href: 'https://instagram.com/{{band.instagram_handle}}',
    defaultWidth: '32', defaultHeight: '32',
  },
  {
    key: 'spotify', category: 'social', available: false,
    src: 'https://app.test/icons/socials/spotify.png',
    whiteSrc: 'https://app.test/icons/socials/spotify-white.png',
    href: 'https://open.spotify.com/artist/{{band.spotify_handle}}',
    defaultWidth: '32', defaultHeight: '32',
  },
]

function renderEditor(canWrite = true, fields = [], onUpdate = vi.fn(), ref, options = {}) {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <TemplateEditor
        ref={ref}
        content={{ type: 'doc', content: [] }}
        fields={fields}
        images={options.images ?? imageOptions}
        locale="en"
        canWrite={canWrite}
        onUpdate={onUpdate}
      />
    </ThemeProvider>,
  )
}

describe('TemplateEditor inspector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    editorMocks.getJSON.mockReturnValue({ type: 'doc', content: [{ type: 'paragraph' }] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('emits document JSON from the editor update callback', () => {
    const onUpdate = vi.fn()
    renderEditor(true, [], onUpdate)

    editorMocks.getJSON.mockReturnValue({ type: 'doc', content: [{ type: 'paragraph', attrs: { color: '#123456' } }] })
    act(() => { editorMocks.onEditorUpdate({ editor: editorMocks.editor }) })

    expect(onUpdate).toHaveBeenCalledWith({
      body_json: { type: 'doc', content: [{ type: 'paragraph', attrs: { color: '#123456' } }] },
    })
    expect(editorMocks.composeReactEmail).not.toHaveBeenCalled()
  })

  it('does not emit unchanged documents on every sample', () => {
    vi.useFakeTimers()
    const onUpdate = vi.fn()
    renderEditor(true, [], onUpdate)

    act(() => { vi.advanceTimersByTime(1_000) })

    expect(onUpdate).not.toHaveBeenCalled()
    expect(editorMocks.composeReactEmail).not.toHaveBeenCalled()
  })

  it('serializes HTML and text only when the debounced save requests them', async () => {
    const ref = createRef()
    renderEditor(true, [], vi.fn(), ref)

    await expect(ref.current.getSerializedContent()).resolves.toEqual({
      body_json: { type: 'doc', content: [{ type: 'paragraph' }] },
      body_html: '<html><body>Hello {{contact.first_name}}</body></html>',
      body_text: 'Hello {{contact.first_name}}',
    })
    expect(editorMocks.composeReactEmail).toHaveBeenCalledOnce()
  })

  it('exposes the current JSON so navigation can flush changes between samples', () => {
    const ref = createRef()
    renderEditor(true, [], vi.fn(), ref)

    expect(ref.current.getCurrentJson()).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] })
    expect(editorMocks.composeReactEmail).not.toHaveBeenCalled()
  })

  it('renders the complete contextual design inspector for editable templates', () => {
    renderEditor()

    expect(screen.getByRole('complementary', { name: 'Design properties' })).toHaveClass('gb-template-editor-inspector')
    expect(screen.getByTestId('inspector-breadcrumb')).toBeInTheDocument()
    expect(screen.getByTestId('inspector-document')).toBeInTheDocument()
    expect(screen.getByTestId('inspector-node')).toBeInTheDocument()
    expect(screen.getByTestId('inspector-text')).toBeInTheDocument()
  })

  it('configures StarterKit alignment attributes for editable email nodes', () => {
    renderEditor()

    expect(editorMocks.starterKitConfigure).toHaveBeenCalledWith(expect.objectContaining({
      AlignmentAttribute: {
        types: expect.arrayContaining(['heading', 'paragraph', 'image', 'button', 'columnsColumn']),
        alignments: ['left', 'center', 'right'],
      },
    }))
  })

  it('aligns the selected image via the image bubble menu', async () => {
    const user = userEvent.setup()
    renderEditor()

    const alignCenterButtons = within(screen.getByTestId('image-toolbar')).getAllByRole('button', { name: 'Align center' })
    await user.click(alignCenterButtons[0])

    expect(editorMocks.chainApi.updateAttributes).toHaveBeenCalledWith('image', { alignment: 'center' })
    expect(editorMocks.chainApi.run).toHaveBeenCalled()
  })

  it('aligns the selected button via the button bubble menu', async () => {
    const user = userEvent.setup()
    renderEditor()

    const alignRightButton = within(screen.getByTestId('button-toolbar')).getByRole('button', { name: 'Align right' })
    await user.click(alignRightButton)

    expect(editorMocks.chainApi.updateAttributes).toHaveBeenCalledWith('button', { alignment: 'right' })
    expect(editorMocks.chainApi.run).toHaveBeenCalled()
  })

  it('maps the inspector field background to the active dark theme', () => {
    const darkTheme = createAppTheme('dark')
    render(
      <ThemeProvider theme={darkTheme}>
        <TemplateEditor
          content={{ type: 'doc', content: [] }}
          fields={[]}
          onUpdate={vi.fn()}
        />
      </ThemeProvider>,
    )

    expect(document.documentElement.style.getPropertyValue('--re-input-bg')).toBe(darkTheme.palette.background.paper)
    expect(document.documentElement.style.getPropertyValue('--re-color-scheme')).toBe('')
  })

  it('does not expose editing controls in read-only mode', () => {
    renderEditor(false)

    expect(screen.queryByRole('complementary', { name: 'Design properties' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('bubble-menu')).not.toBeInTheDocument()
  })

  it('docks merge fields vertically beside the editor', () => {
    renderEditor(true, [
      { key: 'contact.first_name', label: 'First name', block: false },
      { key: 'venue.address', label: 'Venue address', block: true },
    ])

    const dock = screen.getByRole('complementary', { name: 'Merge fields' })
    expect(dock).toHaveClass('gb-merge-fields-dock')
    expect(dock.querySelector('.gb-merge-fields-list')).toContainElement(screen.getByRole('button', { name: 'First name' }))
    expect(screen.getByRole('button', { name: '#Venue address' })).toHaveAttribute('draggable', 'true')
  })

  it('inserts branding images and the selected social color as standard image nodes', async () => {
    const user = userEvent.setup()
    renderEditor()

    await user.click(screen.getByRole('tab', { name: 'Images' }))
    await user.click(screen.getByRole('button', { name: 'Band avatar' }))
    expect(editorMocks.chainApi.insertContent).toHaveBeenLastCalledWith({
      type: 'image',
      attrs: expect.objectContaining({
        src: 'https://app.test/api/public/outreach/image/avatar?t=token',
        alt: 'Band avatar',
        width: '96',
        height: '96',
      }),
    })

    await user.click(screen.getByRole('button', { name: 'White' }))
    await user.click(screen.getByRole('button', { name: 'Instagram' }))
    expect(editorMocks.chainApi.insertContent).toHaveBeenLastCalledWith({
      type: 'image',
      attrs: expect.objectContaining({
        src: 'https://app.test/icons/socials/instagram-white.png',
        href: 'https://instagram.com/{{band.instagram_handle}}',
        width: '32',
        height: '32',
      }),
    })
  })

  it('keeps unconfigured image options visible but disabled', async () => {
    const user = userEvent.setup()
    renderEditor()

    await user.click(screen.getByRole('tab', { name: 'Images' }))
    expect(screen.getByRole('button', { name: 'Spotify' })).toBeDisabled()
    expect(screen.getByText('Configure in Profile')).toBeInTheDocument()
  })

  it('inserts a dragged library image at the editor drop position', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(screen.getByRole('tab', { name: 'Images' }))
    const values = new Map()
    const dataTransfer = {
      types: ['application/x-gigbuddy-template-image'],
      effectAllowed: '',
      dropEffect: '',
      setData: vi.fn((type, value) => values.set(type, value)),
      getData: vi.fn((type) => values.get(type) ?? ''),
    }

    fireEvent.dragStart(screen.getByRole('button', { name: 'Instagram' }), { dataTransfer })
    const canvas = screen.getByTestId('email-editor-canvas')
    const dropEvent = createEvent.drop(canvas)
    Object.defineProperties(dropEvent, {
      clientX: { value: 80 },
      clientY: { value: 160 },
      dataTransfer: { value: dataTransfer },
    })
    fireEvent(canvas, dropEvent)

    expect(editorMocks.chainApi.insertContentAt).toHaveBeenCalledWith(7, {
      type: 'image',
      attrs: expect.objectContaining({
        src: 'https://app.test/icons/socials/instagram.png',
        href: 'https://instagram.com/{{band.instagram_handle}}',
      }),
    })
  })

  it('inserts a dragged merge field directly at the editor drop position', () => {
    renderEditor(true, [{ key: 'contact.first_name', label: 'First name', block: false }])
    const values = new Map()
    const dataTransfer = {
      types: ['application/x-gigbuddy-merge-field'],
      effectAllowed: '',
      dropEffect: '',
      setData: vi.fn((type, value) => values.set(type, value)),
      getData: vi.fn((type) => values.get(type) ?? ''),
    }

    fireEvent.dragStart(screen.getByRole('button', { name: 'First name' }), { dataTransfer })
    expect(editorMocks.chainApi.insertContent).not.toHaveBeenCalled()

    const canvas = screen.getByTestId('email-editor-canvas')
    fireEvent.dragOver(canvas, { dataTransfer })
    const dropEvent = createEvent.drop(canvas)
    Object.defineProperties(dropEvent, {
      clientX: { value: 120 },
      clientY: { value: 240 },
      dataTransfer: { value: dataTransfer },
    })
    fireEvent(canvas, dropEvent)

    expect(editorMocks.editor.view.posAtCoords).toHaveBeenCalledWith({ left: 120, top: 240 })
    expect(editorMocks.chainApi.insertContentAt).toHaveBeenCalledWith(7, {
      type: 'mergeField',
      attrs: { fieldKey: 'contact.first_name' },
    })
    expect(editorMocks.chainApi.run).toHaveBeenCalled()
  })

  it('switches between the live editor and a merged HTML preview', async () => {
    const user = userEvent.setup()
    renderEditor(true, [{ key: 'contact.first_name', label: 'First name', sample: 'Ada', block: false }])

    expect(screen.getByTestId('email-editor')).toBeVisible()
    expect(screen.queryByTitle('Preview')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Preview' }))

    expect(screen.getByTitle('Preview')).toHaveAttribute('srcdoc', expect.stringContaining('Hello Ada'))
    expect(screen.getByTestId('email-editor')).not.toBeVisible()
    expect(screen.getByTestId('email-editor').closest('.gb-template-editor-shell')).toHaveClass('gb-template-editor-shell--hidden')

    await user.click(screen.getByRole('button', { name: 'Edit' }))

    expect(screen.queryByTitle('Preview')).not.toBeInTheDocument()
    expect(screen.getByTestId('email-editor')).toBeVisible()
    expect(screen.getByTestId('email-editor').closest('.gb-template-editor-shell')).not.toHaveClass('gb-template-editor-shell--hidden')
  })

  it('switches to preview immediately while email HTML is still being composed', async () => {
    let finishComposition
    editorMocks.composeReactEmail.mockImplementationOnce(() => new Promise((resolve) => {
      finishComposition = resolve
    }))
    const user = userEvent.setup()
    renderEditor()

    await user.click(screen.getByRole('button', { name: 'Preview' }))

    expect(screen.getByRole('button', { name: 'Preview' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    expect(screen.getByTestId('email-editor')).not.toBeVisible()

    await act(async () => {
      finishComposition({
        html: '<html><body>Ready</body></html>',
        text: 'Ready',
        unformattedHtml: '<html><body>Ready</body></html>',
      })
    })

    expect(screen.getByTitle('Preview')).toHaveAttribute('srcdoc', expect.stringContaining('Ready'))
  })
})
