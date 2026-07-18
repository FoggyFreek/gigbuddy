import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getStoredSession,
  storeSession,
  exchangeHandoff,
  getEditorPage,
  saveDraft,
  getPreview,
  publishPage,
  refreshContent,
} from './api.js'
import WidgetStack from './WidgetStack.jsx'
import StatsPanel from './StatsPanel.jsx'
import { LINK_ICON_COMPONENTS } from './icons.jsx'

const ICON_OPTIONS = Object.keys(LINK_ICON_COMPONENTS)

function newId() {
  return crypto.randomUUID()
}

function moveItem(list, index, delta) {
  const target = index + delta
  if (target < 0 || target >= list.length) return list
  const next = [...list]
  const [item] = next.splice(index, 1)
  next.splice(target, 0, item)
  return next
}

// ---------- per-widget editors ----------

function SongWidgetEditor({ widget, songs, onChange }) {
  return (
    <select
      value={widget.songId}
      onChange={(e) => onChange({ ...widget, songId: Number(e.target.value) })}
    >
      {songs.map((song) => (
        <option key={song.id} value={song.id}>
          {song.title}
          {song.artist ? ` — ${song.artist}` : ''}
        </option>
      ))}
    </select>
  )
}

function GigsWidgetEditor({ widget, onChange }) {
  return (
    <div className="widget-fields">
      <input
        placeholder="Title (Upcoming Gigs)"
        value={widget.title || ''}
        onChange={(e) => onChange({ ...widget, title: e.target.value })}
      />
      <label className="inline-field">
        Max gigs
        <input
          type="number"
          min="1"
          max="50"
          value={widget.limit}
          onChange={(e) => onChange({ ...widget, limit: Number(e.target.value) || 10 })}
        />
      </label>
    </div>
  )
}

function MerchWidgetEditor({ widget, products, onChange }) {
  const included = new Map(widget.items.map((item) => [item.productId, item]))
  const toggle = (productId) => {
    const items = included.has(productId)
      ? widget.items.filter((item) => item.productId !== productId)
      : [...widget.items, { productId, imageUrl: null, badge: null }]
    onChange({ ...widget, items })
  }
  const updateItem = (productId, patch) => {
    onChange({
      ...widget,
      items: widget.items.map((item) => (item.productId === productId ? { ...item, ...patch } : item)),
    })
  }
  return (
    <div className="widget-fields">
      <input
        placeholder="Title (e.g. Album CDs and LPs)"
        value={widget.title || ''}
        onChange={(e) => onChange({ ...widget, title: e.target.value })}
      />
      <input
        placeholder="Shop URL the items link to (optional)"
        value={widget.shopUrl || ''}
        onChange={(e) => onChange({ ...widget, shopUrl: e.target.value || null })}
      />
      <ul className="merch-editor-list">
        {products.map((product) => {
          const item = included.get(product.id)
          return (
            <li key={product.id}>
              <label className="inline-field">
                <input type="checkbox" checked={!!item} onChange={() => toggle(product.id)} />
                {product.name}
              </label>
              {item && (
                <div className="merch-item-fields">
                  <input
                    placeholder="Image URL (optional)"
                    value={item.imageUrl || ''}
                    onChange={(e) => updateItem(product.id, { imageUrl: e.target.value || null })}
                  />
                  <input
                    placeholder="Badge (e.g. NEW)"
                    maxLength={20}
                    value={item.badge || ''}
                    onChange={(e) => updateItem(product.id, { badge: e.target.value || null })}
                  />
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function LinkWidgetEditor({ widget, onChange }) {
  return (
    <div className="widget-fields">
      <input
        placeholder="Label"
        value={widget.label || ''}
        onChange={(e) => onChange({ ...widget, label: e.target.value })}
      />
      <input
        placeholder="https://…"
        value={widget.url || ''}
        onChange={(e) => onChange({ ...widget, url: e.target.value })}
      />
      <input
        placeholder="Sublabel (optional)"
        value={widget.sublabel || ''}
        onChange={(e) => onChange({ ...widget, sublabel: e.target.value || null })}
      />
      <input
        placeholder="Thumbnail image URL (optional)"
        value={widget.imageUrl || ''}
        onChange={(e) => onChange({ ...widget, imageUrl: e.target.value || null })}
      />
      <label className="inline-field">
        Icon
        <select value={widget.icon} onChange={(e) => onChange({ ...widget, icon: e.target.value })}>
          {ICON_OPTIONS.map((icon) => (
            <option key={icon} value={icon}>{icon}</option>
          ))}
        </select>
      </label>
    </div>
  )
}

function widgetSummary(widget, content) {
  switch (widget.type) {
    case 'song': {
      const song = (content.songs || []).find((s) => s.id === widget.songId)
      return `Song · ${song ? song.title : 'missing song'}`
    }
    case 'gigs':
      return `Gigs · ${widget.title || 'Upcoming Gigs'}`
    case 'merch':
      return `Merch · ${widget.title || `${widget.items.length} products`}`
    case 'link':
      return `Link · ${widget.label || widget.url}`
    default:
      return widget.type
  }
}

function WidgetEditor({ widget, content, onChange }) {
  switch (widget.type) {
    case 'song':
      return <SongWidgetEditor widget={widget} songs={content.songs || []} onChange={onChange} />
    case 'gigs':
      return <GigsWidgetEditor widget={widget} onChange={onChange} />
    case 'merch':
      return <MerchWidgetEditor widget={widget} products={content.products || []} onChange={onChange} />
    case 'link':
      return <LinkWidgetEditor widget={widget} onChange={onChange} />
    default:
      return null
  }
}

// ---------- editor page ----------

export default function Editor() {
  const [session, setSession] = useState(null)
  const [page, setPage] = useState(null)
  const [layout, setLayout] = useState(null)
  const [tab, setTab] = useState('build')
  const [preview, setPreview] = useState(null)
  const [fatal, setFatal] = useState(null)
  const [saveState, setSaveState] = useState('saved')
  const [publishedAt, setPublishedAt] = useState(null)
  const [openWidget, setOpenWidget] = useState(null)

  const layoutRef = useRef(null)
  const sessionRef = useRef(null)
  const timerRef = useRef(null)

  // Enter the editor: exchange a fresh handoff token from the URL fragment,
  // or resume the stored session.
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const gbtoken = hash.get('gbtoken')
    const boot = async () => {
      try {
        if (gbtoken) {
          const { session: token, page: loaded } = await exchangeHandoff(gbtoken)
          window.history.replaceState(null, '', window.location.pathname)
          storeSession(token)
          sessionRef.current = token
          setSession(token)
          setPage(loaded)
          setLayout(loaded.draftLayout)
          layoutRef.current = loaded.draftLayout
          setPublishedAt(loaded.publishedAt)
          return
        }
        const stored = getStoredSession()
        if (!stored) {
          setFatal('Open the editor from GigBuddy (Profile → Edit link page).')
          return
        }
        const loaded = await getEditorPage(stored)
        sessionRef.current = stored
        setSession(stored)
        setPage(loaded)
        setLayout(loaded.draftLayout)
        layoutRef.current = loaded.draftLayout
        setPublishedAt(loaded.publishedAt)
      } catch (err) {
        setFatal(err.message)
      }
    }
    boot()
  }, [])

  const doSave = useCallback(async () => {
    if (!layoutRef.current || !sessionRef.current) return
    setSaveState('saving')
    try {
      await saveDraft(sessionRef.current, layoutRef.current)
      setSaveState('saved')
    } catch (err) {
      setSaveState(err.status === 401 ? 'expired' : 'error')
    }
  }, [])

  const applyLayout = useCallback((next) => {
    layoutRef.current = next
    setLayout(next)
    setSaveState('dirty')
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(doSave, 800)
  }, [doSave])

  const flushSave = useCallback(async () => {
    clearTimeout(timerRef.current)
    await doSave()
  }, [doSave])

  useEffect(() => () => clearTimeout(timerRef.current), [])

  if (fatal) return <div className="page-status">{fatal}</div>
  if (!page || !layout) return <div className="page-status" aria-busy="true" />

  const content = page.content || {}

  // ---------- layout operations (all immutable) ----------

  const updateSection = (sectionId, patch) => {
    applyLayout({
      ...layout,
      sections: layout.sections.map((s) => (s.id === sectionId ? { ...s, ...patch } : s)),
    })
  }

  const addSection = () => {
    applyLayout({ ...layout, sections: [...layout.sections, { id: newId(), title: null, widgets: [] }] })
  }

  const removeSection = (sectionId) => {
    applyLayout({ ...layout, sections: layout.sections.filter((s) => s.id !== sectionId) })
  }

  const moveSection = (index, delta) => {
    applyLayout({ ...layout, sections: moveItem(layout.sections, index, delta) })
  }

  const addWidget = (section, widget) => {
    updateSection(section.id, { widgets: [...section.widgets, widget] })
    setOpenWidget(widget.id)
  }

  const buildWidget = (section, type) => {
    switch (type) {
      case 'song': {
        const song = (content.songs || [])[0]
        if (!song) return
        addWidget(section, { id: newId(), type: 'song', songId: song.id })
        break
      }
      case 'gigs':
        addWidget(section, { id: newId(), type: 'gigs', title: 'Upcoming Gigs', limit: 10 })
        break
      case 'merch': {
        const items = (content.products || []).map((p) => ({ productId: p.id, imageUrl: null, badge: null }))
        if (!items.length) return
        addWidget(section, { id: newId(), type: 'merch', title: null, shopUrl: null, items })
        break
      }
      case 'link':
        addWidget(section, { id: newId(), type: 'link', label: '', url: '', sublabel: null, imageUrl: null, icon: 'globe' })
        break
    }
  }

  const publish = async () => {
    await flushSave()
    try {
      const result = await publishPage(sessionRef.current)
      setPublishedAt(result.publishedAt)
    } catch (err) {
      setSaveState(err.status === 401 ? 'expired' : 'error')
    }
  }

  const openPreview = async () => {
    await flushSave()
    try {
      setPreview(await getPreview(sessionRef.current))
      setTab('preview')
    } catch (err) {
      setSaveState(err.status === 401 ? 'expired' : 'error')
    }
  }

  const refresh = async () => {
    try {
      const loaded = await refreshContent(sessionRef.current)
      setPage(loaded)
    } catch {
      /* keep the current snapshot */
    }
  }

  const saveLabel = {
    saved: 'All changes saved',
    dirty: 'Unsaved changes…',
    saving: 'Saving…',
    error: 'Save failed — retrying on next change',
    expired: 'Session expired — reopen from GigBuddy',
  }[saveState]

  return (
    <div className="editor">
      <header className="editor-header">
        <div>
          <h1>{content.band?.name || page.slug} — link page</h1>
          <span className="save-state">{saveLabel}</span>
        </div>
        <div className="editor-actions">
          <button className="btn" onClick={refresh}>Refresh content</button>
          <button className="btn" onClick={openPreview}>Preview</button>
          <button className="btn btn-primary" onClick={publish}>
            {publishedAt ? 'Publish changes' : 'Publish'}
          </button>
        </div>
      </header>
      <nav className="editor-tabs">
        <button className={tab === 'build' ? 'active' : ''} onClick={() => setTab('build')}>Build</button>
        <button className={tab === 'preview' ? 'active' : ''} onClick={openPreview}>Preview</button>
        <button className={tab === 'stats' ? 'active' : ''} onClick={() => setTab('stats')}>Statistics</button>
      </nav>
      {publishedAt && tab === 'build' && (
        <p className="published-note">
          Live at <a href={page.publicUrl} target="_blank" rel="noopener noreferrer">{page.publicUrl}</a>
          {' '}(last published {new Date(publishedAt).toLocaleString()})
        </p>
      )}

      {tab === 'build' && (
        <div className="editor-sections">
          {layout.sections.map((section, sectionIndex) => (
            <div key={section.id} className="editor-section">
              <div className="editor-section-head">
                <input
                  className="section-title-input"
                  placeholder="Section title (optional)"
                  value={section.title || ''}
                  onChange={(e) => updateSection(section.id, { title: e.target.value || null })}
                />
                <div className="row-actions">
                  <button onClick={() => moveSection(sectionIndex, -1)} disabled={sectionIndex === 0} aria-label="Move section up">↑</button>
                  <button onClick={() => moveSection(sectionIndex, 1)} disabled={sectionIndex === layout.sections.length - 1} aria-label="Move section down">↓</button>
                  <button onClick={() => removeSection(section.id)} aria-label="Delete section">✕</button>
                </div>
              </div>
              <ul className="editor-widgets">
                {section.widgets.map((widget, widgetIndex) => (
                  <li key={widget.id} className="editor-widget">
                    <div className="editor-widget-row">
                      <button
                        className="widget-summary"
                        onClick={() => setOpenWidget(openWidget === widget.id ? null : widget.id)}
                      >
                        {widgetSummary(widget, content)}
                      </button>
                      <div className="row-actions">
                        <button
                          onClick={() => updateSection(section.id, { widgets: moveItem(section.widgets, widgetIndex, -1) })}
                          disabled={widgetIndex === 0}
                          aria-label="Move widget up"
                        >↑</button>
                        <button
                          onClick={() => updateSection(section.id, { widgets: moveItem(section.widgets, widgetIndex, 1) })}
                          disabled={widgetIndex === section.widgets.length - 1}
                          aria-label="Move widget down"
                        >↓</button>
                        <button
                          onClick={() => updateSection(section.id, { widgets: section.widgets.filter((w) => w.id !== widget.id) })}
                          aria-label="Delete widget"
                        >✕</button>
                      </div>
                    </div>
                    {openWidget === widget.id && (
                      <WidgetEditor
                        widget={widget}
                        content={content}
                        onChange={(next) =>
                          updateSection(section.id, {
                            widgets: section.widgets.map((w) => (w.id === widget.id ? next : w)),
                          })
                        }
                      />
                    )}
                  </li>
                ))}
              </ul>
              <div className="add-widget-row">
                <span>Add:</span>
                <button onClick={() => buildWidget(section, 'song')} disabled={!content.songs?.length}>Song</button>
                <button onClick={() => buildWidget(section, 'gigs')}>Gigs</button>
                <button onClick={() => buildWidget(section, 'merch')} disabled={!content.products?.length}>Merch</button>
                <button onClick={() => buildWidget(section, 'link')}>Link</button>
              </div>
            </div>
          ))}
          <button className="btn add-section" onClick={addSection}>+ Add section</button>
        </div>
      )}

      {tab === 'preview' && preview && (
        <div className="preview-frame">
          <div className="preview-note">This is exactly what visitors see.</div>
          <div className="public-page">
            <WidgetStack page={preview} />
          </div>
        </div>
      )}

      {tab === 'stats' && <StatsPanel session={session} />}
    </div>
  )
}
