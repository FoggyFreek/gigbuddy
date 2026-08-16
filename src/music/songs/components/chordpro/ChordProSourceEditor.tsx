import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import MenuItem from '@mui/material/MenuItem'
import MenuList from '@mui/material/MenuList'
import Paper from '@mui/material/Paper'
import Popper from '@mui/material/Popper'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'

import { MONO_FONT } from '../../chordpro.ts'

const BLOCK_SNIPPETS = {
  abc: 'X:1\nM:4/4\nL:1/4\nK:C\nC D E F |',
  tab: 'e|--0--------------|\nB|----3------------|\nG|---2-------------|\nD|-----------------|\nA|-----------------|\nE|-----------------|',
  grid: '|| C . . . | F . . . | G . . . | C . . . ||',
} as const

const DIRECTIVES = [
  { name: 'title', aliases: ['t'], argument: true, descriptionKey: 'title' },
  { name: 'subtitle', aliases: ['st'], argument: true, descriptionKey: 'subtitle' },
  { name: 'artist', argument: true, descriptionKey: 'artist' },
  { name: 'composer', argument: true, descriptionKey: 'composer' },
  { name: 'lyricist', argument: true, descriptionKey: 'lyricist' },
  { name: 'album', argument: true, descriptionKey: 'album' },
  { name: 'year', argument: true, descriptionKey: 'year' },
  { name: 'copyright', argument: true, descriptionKey: 'copyright' },
  { name: 'key', argument: true, descriptionKey: 'key' },
  { name: 'capo', argument: true, descriptionKey: 'capo' },
  { name: 'tempo', argument: true, descriptionKey: 'tempo' },
  { name: 'time', argument: true, descriptionKey: 'time' },
  { name: 'duration', argument: true, descriptionKey: 'duration' },
  { name: 'meta', argument: true, descriptionKey: 'meta' },
  { name: 'comment', aliases: ['c'], argument: true, descriptionKey: 'comment' },
  { name: 'comment_box', aliases: ['cb'], argument: true, descriptionKey: 'commentBox' },
  { name: 'comment_italic', aliases: ['ci'], argument: true, descriptionKey: 'commentItalic' },
  { name: 'highlight', argument: true, descriptionKey: 'highlight' },
  { name: 'chorus', argument: true, descriptionKey: 'chorus' },
  { name: 'start_of_verse', aliases: ['sov'], argument: true, block: 'verse', descriptionKey: 'startVerse' },
  { name: 'end_of_verse', aliases: ['eov'], descriptionKey: 'endVerse' },
  { name: 'start_of_chorus', aliases: ['soc'], argument: true, block: 'chorus', descriptionKey: 'startChorus' },
  { name: 'end_of_chorus', aliases: ['eoc'], descriptionKey: 'endChorus' },
  { name: 'start_of_bridge', aliases: ['sob'], argument: true, block: 'bridge', descriptionKey: 'startBridge' },
  { name: 'end_of_bridge', aliases: ['eob'], descriptionKey: 'endBridge' },
  { name: 'start_of_tab', aliases: ['sot'], argument: true, block: 'tab', snippet: BLOCK_SNIPPETS.tab, descriptionKey: 'startTab' },
  { name: 'end_of_tab', aliases: ['eot'], descriptionKey: 'endTab' },
  { name: 'start_of_grid', aliases: ['sog'], argument: true, block: 'grid', snippet: BLOCK_SNIPPETS.grid, descriptionKey: 'startGrid' },
  { name: 'end_of_grid', aliases: ['eog'], descriptionKey: 'endGrid' },
  { name: 'start_of_abc', argument: true, block: 'abc', snippet: BLOCK_SNIPPETS.abc, descriptionKey: 'startAbc' },
  { name: 'end_of_abc', descriptionKey: 'endAbc' },
  { name: 'start_of_textblock', argument: true, block: 'textblock', descriptionKey: 'startTextblock' },
  { name: 'end_of_textblock', descriptionKey: 'endTextblock' },
  { name: 'columns', argument: true, descriptionKey: 'columns' },
  { name: 'column', aliases: ['col'], argument: true, descriptionKey: 'column' },
  { name: 'column_break', aliases: ['colb'], descriptionKey: 'columnBreak' },
  { name: 'new_page', aliases: ['np'], descriptionKey: 'newPage' },
  { name: 'new_physical_page', aliases: ['npp'], descriptionKey: 'newPhysicalPage' },
  { name: 'transpose', argument: true, descriptionKey: 'transpose' },
  { name: 'diagrams', argument: true, descriptionKey: 'diagrams' },
  { name: 'define', argument: true, descriptionKey: 'define' },
  { name: 'chord', argument: true, descriptionKey: 'chord' },
  { name: 'image', argument: true, descriptionKey: 'image' },
] as const

type Directive = (typeof DIRECTIVES)[number]

const SUGGESTION_ROW_HEIGHT = 48
const VISIBLE_SUGGESTIONS = 5
const MENU_LIST_PADDING = 16
const MENU_LIST_MAX_HEIGHT = SUGGESTION_ROW_HEIGHT * VISIBLE_SUGGESTIONS + MENU_LIST_PADDING

const CARET_MIRROR_PROPERTIES = [
  'border-bottom-width',
  'border-left-width',
  'border-right-width',
  'border-top-width',
  'box-sizing',
  'font-family',
  'font-size',
  'font-stretch',
  'font-style',
  'font-variant',
  'font-weight',
  'letter-spacing',
  'line-height',
  'overflow-wrap',
  'padding-bottom',
  'padding-left',
  'padding-right',
  'padding-top',
  'tab-size',
  'text-align',
  'text-indent',
  'text-transform',
  'word-break',
  'word-spacing',
] as const

interface Completion {
  start: number
  cursor: number
  query: string
}

interface CaretAnchor {
  contextElement: HTMLTextAreaElement
  getBoundingClientRect: () => DOMRect
}

interface Props {
  label: string
  value: string
  onChange: (value: string) => void
}

function completionAt(value: string, cursor: number): Completion | null {
  const lineStart = value.lastIndexOf('\n', cursor - 1) + 1
  const beforeCursor = value.slice(lineStart, cursor)
  const braceOffset = beforeCursor.lastIndexOf('{')
  if (braceOffset < 0) return null

  const query = beforeCursor.slice(braceOffset + 1)
  if (!/^[a-z0-9_]*$/i.test(query)) return null

  return { start: lineStart + braceOffset, cursor, query: query.toLowerCase() }
}

function directiveSyntax(directive: Directive): string {
  return 'argument' in directive ? `{${directive.name}: }` : `{${directive.name}}`
}

function insertionFor(directive: Directive): { text: string; caret: number } {
  const opening = directiveSyntax(directive)
  const body = 'snippet' in directive ? directive.snippet : ''
  const text = 'block' in directive
    ? `${opening}\n${body}\n{end_of_${directive.block}}`
    : opening

  return {
    text,
    caret: 'argument' in directive ? opening.length - 1 : opening.length,
  }
}

function matchesQuery(directive: Directive, query: string): boolean {
  if (directive.name.includes(query)) return true
  return 'aliases' in directive && directive.aliases.some((alias) => alias.includes(query))
}

function getCaretClientRect(textarea: HTMLTextAreaElement, cursor: number): DOMRect {
  const textareaRect = textarea.getBoundingClientRect()
  const computed = window.getComputedStyle(textarea)
  const mirror = document.createElement('div')
  const borderWidth = (Number.parseFloat(computed.borderLeftWidth) || 0) + (Number.parseFloat(computed.borderRightWidth) || 0)

  for (const property of CARET_MIRROR_PROPERTIES) {
    mirror.style.setProperty(property, computed.getPropertyValue(property))
  }
  mirror.style.position = 'fixed'
  mirror.style.visibility = 'hidden'
  mirror.style.pointerEvents = 'none'
  mirror.style.overflow = 'hidden'
  mirror.style.whiteSpace = 'pre-wrap'
  mirror.style.wordWrap = 'break-word'
  mirror.style.top = `${textareaRect.top}px`
  mirror.style.left = `${textareaRect.left}px`
  mirror.style.width = `${textarea.clientWidth + borderWidth}px`
  mirror.style.height = 'auto'
  mirror.textContent = textarea.value.slice(0, cursor)

  const marker = document.createElement('span')
  marker.textContent = '\u200b'
  mirror.appendChild(marker)
  document.body.appendChild(mirror)

  const markerRect = marker.getBoundingClientRect()
  const fontSize = Number.parseFloat(computed.fontSize) || 14
  const lineHeight = Number.parseFloat(computed.lineHeight) || fontSize * 1.5
  mirror.remove()

  return DOMRect.fromRect({
    x: markerRect.left - textarea.scrollLeft,
    y: markerRect.top - textarea.scrollTop,
    width: 1,
    height: lineHeight,
  })
}

function createCaretAnchor(textarea: HTMLTextAreaElement, cursor: number): CaretAnchor {
  return {
    contextElement: textarea,
    getBoundingClientRect: () => getCaretClientRect(textarea, cursor),
  }
}

export default function ChordProSourceEditor({ label, value, onChange }: Readonly<Props>) {
  const { t } = useTranslation('songs')
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const pendingCaret = useRef<number | null>(null)
  const selectedOptionRef = useRef<HTMLLIElement | null>(null)
  const [completion, setCompletion] = useState<Completion | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [caretAnchor, setCaretAnchor] = useState<CaretAnchor | null>(null)
  const listboxId = `${useId()}-chordpro-suggestions`

  const suggestions = completion
    ? DIRECTIVES.filter((directive) => matchesQuery(directive, completion.query))
    : []
  const menuOpen = suggestions.length > 0

  useLayoutEffect(() => {
    if (pendingCaret.current === null || !inputRef.current) return
    inputRef.current.focus()
    inputRef.current.setSelectionRange(pendingCaret.current, pendingCaret.current)
    pendingCaret.current = null
  }, [value])

  useLayoutEffect(() => {
    selectedOptionRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [selectedIndex])

  function refreshCompletion(nextValue: string, cursor: number, textarea = inputRef.current) {
    const nextCompletion = completionAt(nextValue, cursor)
    setCompletion(nextCompletion)
    setCaretAnchor(nextCompletion && textarea ? createCaretAnchor(textarea, cursor) : null)
    setSelectedIndex(0)
  }

  function handleChange(nextValue: string, cursor: number, textarea: HTMLTextAreaElement) {
    onChange(nextValue)
    refreshCompletion(nextValue, cursor, textarea)
  }

  function selectDirective(directive: Directive) {
    if (!completion) return
    const insertion = insertionFor(directive)
    const nextValue = `${value.slice(0, completion.start)}${insertion.text}${value.slice(completion.cursor)}`
    pendingCaret.current = completion.start + insertion.caret
    setCompletion(null)
    setCaretAnchor(null)
    setSelectedIndex(0)
    onChange(nextValue)
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!menuOpen) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelectedIndex((index) => (index + 1) % suggestions.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelectedIndex((index) => (index - 1 + suggestions.length) % suggestions.length)
    } else if (event.key === 'Tab') {
      event.preventDefault()
      selectDirective(suggestions[selectedIndex])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setCompletion(null)
    }
  }

  return (
    <Box sx={{ position: 'relative', height: '100%', minHeight: 0 }}>
      <TextField
        label={label}
        value={value}
        onChange={(event) => {
          const input = event.target as HTMLTextAreaElement
          handleChange(input.value, input.selectionStart ?? input.value.length, input)
        }}
        onKeyDown={handleKeyDown}
        onSelect={(event) => {
          const input = event.target as HTMLTextAreaElement
          refreshCompletion(value, input.selectionStart ?? value.length, input)
        }}
        onBlur={() => {
          setCompletion(null)
          setCaretAnchor(null)
        }}
        multiline
        fullWidth
        slotProps={{
          htmlInput: {
            ref: inputRef,
            spellCheck: false,
            role: 'combobox',
            'aria-autocomplete': 'list',
            'aria-controls': menuOpen ? listboxId : undefined,
            'aria-expanded': menuOpen,
            'aria-activedescendant': menuOpen ? `${listboxId}-${selectedIndex}` : undefined,
            onScroll: () => {
              if (completion && inputRef.current) {
                setCaretAnchor(createCaretAnchor(inputRef.current, completion.cursor))
              }
            },
            style: { fontFamily: MONO_FONT, fontSize: 14, lineHeight: 1.5, resize: 'none', overflow: 'auto' },
          },
        }}
        sx={{
          height: '100%',
          minHeight: 0,
          '& .MuiInputBase-root': { height: '100%', minHeight: 0, alignItems: 'stretch', boxSizing: 'border-box' },
          '& .MuiInputBase-inputMultiline, & textarea': {
            height: '100% !important',
            overflow: 'auto !important',
            resize: 'none',
            boxSizing: 'border-box',
          },
        }}
      />

      <Popper
        data-testid="chordpro-suggestion-popper"
        open={menuOpen && caretAnchor !== null}
        anchorEl={caretAnchor}
        placement="bottom-start"
        modifiers={[
          { name: 'offset', options: { offset: [0, 4] } },
          { name: 'flip', options: { fallbackPlacements: ['top-start'], padding: 8 } },
          { name: 'preventOverflow', options: { padding: 8 } },
        ]}
        sx={{ zIndex: (theme) => theme.zIndex.modal + 1 }}
      >
        <Paper
          elevation={8}
          sx={{ width: 520, maxWidth: 'calc(100vw - 16px)', overflow: 'hidden' }}
        >
          <MenuList
            id={listboxId}
            role="listbox"
            aria-label={t($ => $.viewer.autocomplete.label)}
            dense
            sx={{ maxHeight: `${MENU_LIST_MAX_HEIGHT}px`, overflowY: 'auto' }}
          >
            {suggestions.map((directive, index) => (
              <MenuItem
                id={`${listboxId}-${index}`}
                key={directive.name}
                ref={index === selectedIndex ? selectedOptionRef : undefined}
                role="option"
                selected={index === selectedIndex}
                aria-selected={index === selectedIndex}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectDirective(directive)}
                sx={{ alignItems: 'center', gap: 2, height: SUGGESTION_ROW_HEIGHT, minHeight: `${SUGGESTION_ROW_HEIGHT}px !important`, overflow: 'hidden' }}
              >
                <Typography component="code" variant="body2" sx={{ minWidth: 190, fontFamily: MONO_FONT, fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {directiveSyntax(directive)}
                </Typography>
                <Typography
                  variant="caption"
                  sx={{ color: 'text.secondary', overflow: 'hidden', display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2 }}
                >
                  {t($ => $.viewer.autocomplete.descriptions[directive.descriptionKey])}
                </Typography>
              </MenuItem>
            ))}
          </MenuList>
          <Typography variant="caption" sx={{ display: 'block', px: 2, py: 1, color: 'text.secondary', borderTop: '1px solid', borderColor: 'divider' }}>
            {t($ => $.viewer.autocomplete.keyboardHint)}
          </Typography>
        </Paper>
      </Popper>
    </Box>
  )
}
