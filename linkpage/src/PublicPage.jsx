import { useCallback, useEffect, useState } from 'react'
import { getPublicPage, sendView, sendClick } from './api.js'
import WidgetStack from './WidgetStack.jsx'

function utmSourceFromLocation() {
  return new URLSearchParams(window.location.search).get('utm_source')
}

// The visitor-facing page. Sets no cookies and stores nothing on the device;
// the single view beacon carries only the referrer/utm_source already known
// to the browser (see PRIVACY.md).
export default function PublicPage({ slug }) {
  const [page, setPage] = useState(null)
  const [status, setStatus] = useState('loading')

  useEffect(() => {
    let cancelled = false
    getPublicPage(slug)
      .then((data) => {
        if (cancelled) return
        setPage(data)
        setStatus('ready')
        document.title = data.release?.title
          ? `${data.release.title} — ${data.release.artist || 'Listen'}`
          : data.band?.name
            ? `${data.band.name} — Links`
            : 'Band Links'
        sendView(slug, { referrer: document.referrer, utmSource: utmSourceFromLocation() })
      })
      .catch((err) => {
        if (!cancelled) setStatus(err.status === 404 ? 'notfound' : 'error')
      })
    return () => {
      cancelled = true
    }
  }, [slug])

  const onLinkClick = useCallback(
    (target) => {
      sendClick(slug, target, { referrer: document.referrer, utmSource: utmSourceFromLocation() })
    },
    [slug],
  )

  if (status === 'loading') return <div className="page-status" aria-busy="true" />
  if (status === 'notfound') {
    return <div className="page-status">This page doesn&apos;t exist (or isn&apos;t published yet).</div>
  }
  if (status === 'error') return <div className="page-status">Something went wrong — try again later.</div>

  return (
    <div className="public-page">
      <WidgetStack page={page} onLinkClick={onLinkClick} />
      <footer className="page-footer">
        <span>Anonymous, cookieless visit statistics only.</span>
        <a href="/privacy">Privacy</a>
      </footer>
    </div>
  )
}
