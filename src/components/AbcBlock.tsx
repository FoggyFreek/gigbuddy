import { useEffect, useRef } from 'react'
import Box from '@mui/material/Box'

// Engraves an embedded ABC notation block ({start_of_abc}…{end_of_abc}) into a
// musical staff via abcjs. abcjs mutates the DOM, so rendering happens in an
// effect (not during render); it's imported dynamically so its weight only
// loads for charts that actually contain ABC. The resulting SVG is self-
// contained, so it prints correctly when the viewer clones this DOM.
interface AbcBlockProps {
  abc: string
}

export default function AbcBlock({ abc }: Readonly<AbcBlockProps>) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false
    const el = ref.current
    if (!el) return
    import('abcjs').then(({ renderAbc }) => {
      if (cancelled || !ref.current) return
      renderAbc(ref.current, abc, { responsive: 'resize', paddingtop: 0, paddingbottom: 0, paddingleft: 0 })
    })
    return () => { cancelled = true; el.innerHTML = '' }
  }, [abc])

  return <Box className="cp-abc" ref={ref} sx={{ mb: 2, '& svg': { maxWidth: '100%', height: 'auto' } }} />
}
