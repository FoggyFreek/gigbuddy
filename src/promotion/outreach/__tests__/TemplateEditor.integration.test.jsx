import { useCallback, useRef } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it, vi } from 'vitest'
import { createAppTheme } from '../../../theme.ts'
import useDebouncedSave from '../../../hooks/useDebouncedSave.ts'
import TemplateEditor from '../components/TemplateEditor.tsx'
import { OUTREACH_DEFAULTS } from '../defaults/index.ts'

const richTemplate = OUTREACH_DEFAULTS.find((entry) => entry.key === 'venue-booking-pitch-en')

function EditorHarness() {
  const editorRef = useRef(null)
  const save = useCallback(async () => editorRef.current?.getSerializedContent(), [])
  const { schedule } = useDebouncedSave(save, 10)

  return (
    <ThemeProvider theme={createAppTheme('light')}>
      <TemplateEditor
        ref={editorRef}
        content={richTemplate.doc}
        fields={[]}
        onUpdate={schedule}
      />
    </ThemeProvider>
  )
}

describe('TemplateEditor save integration', () => {
  it('does not enter a render loop while rapid color updates are sampled and serialized', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { container } = render(<EditorHarness />)
    const colorInputs = container.querySelectorAll('input[type="color"]')
    const colorInput = colorInputs.item(colorInputs.length - 1)

    expect(colorInput).not.toBeNull()
    for (let index = 0; index < 50; index += 1) {
      fireEvent.change(colorInput, { target: { value: `#12${index.toString(16).padStart(4, '0')}` } })
    }
    const previewButton = screen.getByRole('button', { name: 'Preview' })
    fireEvent.click(previewButton)
    expect(previewButton).toHaveAttribute('aria-pressed', 'true')
    await new Promise((resolve) => setTimeout(resolve, 350))

    expect(screen.getByTitle('Preview')).toBeInTheDocument()
    expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining('Maximum update depth exceeded'))
    consoleError.mockRestore()
  })

  it('serializes a library social icon with its merge-enabled link', async () => {
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <TemplateEditor
          content={{ type: 'doc', content: [{ type: 'paragraph' }] }}
          fields={[{
            key: 'band.instagram_handle', token: '{{band.instagram_handle}}', label: 'Instagram',
            scope: 'band', block: false, sample: 'current-handle',
          }]}
          images={[{
            key: 'instagram', category: 'social', available: true,
            src: 'https://app.test/icons/socials/instagram.png',
            whiteSrc: 'https://app.test/icons/socials/instagram-white.png',
            href: 'https://instagram.com/{{band.instagram_handle}}',
            defaultWidth: '32', defaultHeight: '32',
          }]}
          locale="en"
          onUpdate={vi.fn()}
        />
      </ThemeProvider>,
    )

    fireEvent.click(screen.getByRole('tab', { name: 'Images' }))
    fireEvent.click(screen.getByRole('button', { name: 'Instagram' }))
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))

    await waitFor(() => {
      const html = screen.getByTitle('Preview').getAttribute('srcdoc')
      expect(html).toContain('instagram.png')
      expect(html).toContain('https://instagram.com/current-handle')
    })
  })
})
