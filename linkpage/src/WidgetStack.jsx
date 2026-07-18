// Visitor-facing rendering of a resolved page: band header + sections of
// widget cards. Used verbatim by the public page and the editor's
// preview-as-visitor mode, so preview can never drift from reality.
import {
  InstagramIcon,
  FacebookIcon,
  YoutubeIcon,
  TiktokIcon,
  SpotifyIcon,
  CalendarIcon,
  LINK_ICON_COMPONENTS,
} from './icons.jsx'

const SOCIALS = [
  { key: 'instagram', Icon: InstagramIcon, url: (h) => `https://instagram.com/${h}` },
  { key: 'facebook', Icon: FacebookIcon, url: (h) => `https://facebook.com/${h}` },
  { key: 'youtube', Icon: YoutubeIcon, url: (h) => `https://youtube.com/${h.startsWith('@') ? h : `@${h}`}` },
  { key: 'tiktok', Icon: TiktokIcon, url: (h) => `https://tiktok.com/${h.startsWith('@') ? h : `@${h}`}` },
  { key: 'spotify', Icon: SpotifyIcon, url: (h) => (h.includes('/') ? `https://open.spotify.com/${h}` : `https://open.spotify.com/artist/${h}`) },
]

function socialHref(social, handle) {
  const clean = handle.trim().replace(/^https?:\/\/[^/]+\//, '')
  return handle.startsWith('http') ? handle : social.url(clean)
}

function formatEur(cents) {
  return `€ ${(cents / 100).toFixed(2).replace('.', ',')}`
}

function formatGigDate(iso) {
  const date = new Date(`${iso}T12:00:00`)
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

function BandHeader({ band }) {
  if (!band) return null
  return (
    <header className="band-header">
      {band.logoUrl ? (
        <img className="band-avatar" src={band.logoUrl} alt={band.name || 'Band logo'} />
      ) : (
        <div className="band-avatar band-avatar-placeholder">{(band.name || '?').slice(0, 1)}</div>
      )}
      <h1 className="band-name">{band.name}</h1>
      {band.bio && <p className="band-bio">{band.bio}</p>}
      <div className="band-socials">
        {SOCIALS.filter((s) => band.socials?.[s.key]).map((s) => (
          <a
            key={s.key}
            className="social-link"
            href={socialHref(s, band.socials[s.key])}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={s.key}
          >
            <s.Icon size={30} />
          </a>
        ))}
      </div>
    </header>
  )
}

function SongWidget({ widget }) {
  const primary = widget.links[0]
  const extras = widget.links.slice(1)
  return (
    <div className="card song-card">
      <a className="song-main" href={primary.url} target="_blank" rel="noopener noreferrer">
        {widget.coverUrl ? (
          <img className="song-cover" src={widget.coverUrl} alt="" />
        ) : (
          <div className="song-cover song-cover-placeholder">♪</div>
        )}
        <span className="card-label">
          {widget.title}
          {widget.artist && <span className="card-sublabel">{widget.artist}</span>}
        </span>
      </a>
      {extras.length > 0 && (
        <div className="song-extra-links">
          {extras.map((link, i) => (
            <a key={i} className="pill" href={link.url} target="_blank" rel="noopener noreferrer">
              {link.label || 'Listen'}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

function GigsWidget({ widget }) {
  return (
    <details className="card gigs-card">
      <summary className="gigs-summary">
        <span className="card-icon"><CalendarIcon size={26} /></span>
        <span className="card-label">{widget.title}</span>
        <span className="gigs-chevron" aria-hidden="true">▾</span>
      </summary>
      {widget.gigs.length === 0 ? (
        <p className="gigs-empty">No upcoming gigs announced — check back soon.</p>
      ) : (
        <ul className="gigs-list">
          {widget.gigs.map((gig) => (
            <li key={gig.id} className="gig-row">
              <span className="gig-date">{formatGigDate(gig.date)}</span>
              <span className="gig-title">{gig.title}</span>
              {(gig.venue || gig.city) && (
                <span className="gig-venue">{[gig.venue, gig.city].filter(Boolean).join(', ')}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </details>
  )
}

function MerchProduct({ product, shopUrl }) {
  const body = (
    <>
      <div className="merch-image">
        {product.imageUrl ? <img src={product.imageUrl} alt="" /> : <span aria-hidden="true">♪</span>}
        {product.badge && <span className="merch-badge">{product.badge}</span>}
      </div>
      <span className="merch-name">{product.name}</span>
      <span className="merch-price">{formatEur(product.priceCents)}</span>
    </>
  )
  return shopUrl ? (
    <a className="merch-item" href={shopUrl} target="_blank" rel="noopener noreferrer">{body}</a>
  ) : (
    <div className="merch-item">{body}</div>
  )
}

function MerchWidget({ widget }) {
  return (
    <div className="card merch-card">
      {widget.title && <h3 className="merch-title">{widget.title}</h3>}
      <div className="merch-scroll">
        {widget.products.map((product) => (
          <MerchProduct key={product.id} product={product} shopUrl={widget.shopUrl} />
        ))}
      </div>
    </div>
  )
}

function LinkWidget({ widget }) {
  const Icon = LINK_ICON_COMPONENTS[widget.icon] || LINK_ICON_COMPONENTS.globe
  return (
    <a className="card link-card" href={widget.url} target="_blank" rel="noopener noreferrer">
      {widget.imageUrl ? (
        <img className="link-thumb" src={widget.imageUrl} alt="" />
      ) : (
        <span className="card-icon"><Icon size={26} /></span>
      )}
      <span className="card-label">
        {widget.label}
        {widget.sublabel && <span className="card-sublabel">{widget.sublabel}</span>}
      </span>
    </a>
  )
}

const WIDGETS = { song: SongWidget, gigs: GigsWidget, merch: MerchWidget, link: LinkWidget }

export default function WidgetStack({ page }) {
  return (
    <div className="stack">
      <BandHeader band={page.band} />
      {page.sections.map((section) => (
        <section key={section.id} className="stack-section">
          {section.title && <h2 className="section-title">{section.title}</h2>}
          {section.widgets.map((widget) => {
            const Widget = WIDGETS[widget.type]
            return Widget ? <Widget key={widget.id} widget={widget} /> : null
          })}
        </section>
      ))}
    </div>
  )
}
