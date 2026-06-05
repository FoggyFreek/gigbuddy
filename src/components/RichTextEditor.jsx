import { useEffect, useRef } from 'react'
import PropTypes from 'prop-types'
import Box from '@mui/material/Box'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import Paper from '@mui/material/Paper'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import FormatBoldIcon from '@mui/icons-material/FormatBold'
import FormatItalicIcon from '@mui/icons-material/FormatItalic'
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted'
import FormatListNumberedIcon from '@mui/icons-material/FormatListNumbered'
import FormatUnderlinedIcon from '@mui/icons-material/FormatUnderlined'
import InsertLinkIcon from '@mui/icons-material/InsertLink'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'

function ToolbarButton({ title, onClick, active, children }) {
  return (
    <Tooltip title={title}>
      <IconButton
        size="small"
        onMouseDown={(e) => { e.preventDefault(); onClick() }}
        color={active ? 'primary' : 'default'}
        sx={{ borderRadius: 1 }}
      >
        {children}
      </IconButton>
    </Tooltip>
  )
}
ToolbarButton.propTypes = {
  title: PropTypes.string.isRequired,
  onClick: PropTypes.func.isRequired,
  active: PropTypes.bool,
  children: PropTypes.node,
}

function EditorToolbar({ editor }) {
  if (!editor) return null

  function handleLink() {
    const prev = editor.getAttributes('link').href || ''
    const url = window.prompt('URL', prev)
    if (url === null) return
    if (url === '') editor.chain().focus().unsetLink().run()
    else editor.chain().focus().setLink({ href: url }).run()
  }

  return (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 0.25,
        p: 0.5,
        borderBottom: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.default',
      }}
    >
      <ToolbarButton title="Bold" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
        <FormatBoldIcon fontSize="small" />
      </ToolbarButton>
      <ToolbarButton title="Italic" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <FormatItalicIcon fontSize="small" />
      </ToolbarButton>
      <ToolbarButton title="Underline" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <FormatUnderlinedIcon fontSize="small" />
      </ToolbarButton>
      <Divider orientation="vertical" flexItem sx={{ mx: 0.25 }} />
      <ToolbarButton title="Heading 2" active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
        <Typography variant="caption" fontWeight={700} sx={{ lineHeight: 1, px: 0.25 }}>H2</Typography>
      </ToolbarButton>
      <ToolbarButton title="Heading 3" active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
        <Typography variant="caption" fontWeight={700} sx={{ lineHeight: 1, px: 0.25 }}>H3</Typography>
      </ToolbarButton>
      <Divider orientation="vertical" flexItem sx={{ mx: 0.25 }} />
      <ToolbarButton title="Bullet list" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <FormatListBulletedIcon fontSize="small" />
      </ToolbarButton>
      <ToolbarButton title="Numbered list" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <FormatListNumberedIcon fontSize="small" />
      </ToolbarButton>
      <Divider orientation="vertical" flexItem sx={{ mx: 0.25 }} />
      <ToolbarButton title="Link" active={editor.isActive('link')} onClick={handleLink}>
        <InsertLinkIcon fontSize="small" />
      </ToolbarButton>
    </Box>
  )
}
EditorToolbar.propTypes = { editor: PropTypes.object }

// A reusable Tiptap rich-text editor (Material-styled), mirroring the email
// template editor. `initialHtml` seeds the content on mount; `onChange` receives
// the serialized HTML on every edit.
export default function RichTextEditor({ initialHtml = '', onChange, minHeight = 180 }) {
  const onChangeRef = useRef(onChange)
  useEffect(() => { onChangeRef.current = onChange }, [onChange])

  const editor = useEditor({
    extensions: [StarterKit.configure({ link: { openOnClick: false, autolink: true } })],
    content: initialHtml,
    onUpdate({ editor: e }) {
      onChangeRef.current?.(e.getHTML())
    },
  })

  return (
    <Paper
      variant="outlined"
      sx={{
        '& .ProseMirror': {
          minHeight,
          p: 1.5,
          outline: 'none',
          fontSize: '0.875rem',
          lineHeight: 1.6,
          '& p': { m: 0, mb: 1 },
          '& h2': { fontSize: '1.25rem', fontWeight: 700, mt: 1.5, mb: 0.5 },
          '& h3': { fontSize: '1rem', fontWeight: 700, mt: 1, mb: 0.5 },
          '& ul, & ol': { pl: 3, mb: 1 },
          '& a': { color: 'primary.main' },
        },
      }}
    >
      <EditorToolbar editor={editor} />
      <EditorContent editor={editor} />
    </Paper>
  )
}

RichTextEditor.propTypes = {
  initialHtml: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  minHeight: PropTypes.number,
}
