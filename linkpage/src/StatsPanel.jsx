import { useEffect, useState } from 'react'
import { getStats } from './api.js'

const RANGES = [7, 30, 90, 365]

function BarList({ title, rows, total }) {
  return (
    <div className="stats-block">
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p className="stats-empty">No data yet</p>
      ) : (
        <ul className="bar-list">
          {rows.map((row) => (
            <li key={row.key}>
              <span className="bar-label">{row.key}</span>
              <span className="bar-track">
                <span className="bar-fill" style={{ width: `${total ? Math.max((row.views / total) * 100, 2) : 0}%` }} />
              </span>
              <span className="bar-value">{row.views}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// Aggregate-only statistics: views by device class, source, and country.
export default function StatsPanel({ session }) {
  const [days, setDays] = useState(30)
  const [stats, setStats] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    getStats(session, days)
      .then((data) => {
        if (!cancelled) setStats(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [session, days])

  if (error) return <div className="page-status">{error}</div>
  if (!stats) return <div className="page-status" aria-busy="true" />

  const maxDay = Math.max(...stats.byDay.map((d) => d.views), 1)

  return (
    <div className="stats-panel">
      <div className="stats-toolbar">
        {RANGES.map((range) => (
          <button key={range} className={days === range ? 'active' : ''} onClick={() => setDays(range)}>
            {range} days
          </button>
        ))}
      </div>
      {!stats.enabled && <p className="stats-empty">Statistics collection is disabled on this server.</p>}
      <div className="stats-tiles">
        <div className="stat-tile">
          <span className="stat-value">{stats.totalViews}</span>
          <span className="stat-label">Views</span>
        </div>
        <div className="stat-tile">
          <span className="stat-value">{stats.uniqueVisits}</span>
          <span className="stat-label">Est. unique visits</span>
        </div>
      </div>
      {stats.byDay.length > 0 && (
        <div className="stats-block">
          <h3>Views per day</h3>
          <div className="day-chart">
            {stats.byDay.map((d) => (
              <span
                key={d.day}
                className="day-bar"
                style={{ height: `${(d.views / maxDay) * 100}%` }}
                title={`${d.day}: ${d.views}`}
              />
            ))}
          </div>
        </div>
      )}
      <div className="stats-grid">
        <BarList title="Devices" rows={stats.byDevice} total={stats.totalViews} />
        <BarList title="Sources" rows={stats.bySource} total={stats.totalViews} />
        <BarList title="Countries" rows={stats.byCountry} total={stats.totalViews} />
      </div>
      <p className="stats-footnote">
        Anonymous and cookieless: device class, source and country only — no IPs, no personal data
        (see <a href="/privacy">privacy notice</a>).
      </p>
    </div>
  )
}
