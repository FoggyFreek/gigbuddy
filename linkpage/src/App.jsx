import PublicPage from './PublicPage.jsx'
import Editor from './Editor.jsx'
import Privacy from './Privacy.jsx'

// Path-based routing without a router: three fixed routes and the catch-all
// band slug. Navigation is full page loads — fine for a link page.
export default function App() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/'
  if (path === '/edit') return <Editor />
  if (path === '/privacy') return <Privacy />
  if (path === '/') {
    return (
      <div className="page-status">
        This is a GigBuddy band link page server. Open a band&apos;s page via its own address.
      </div>
    )
  }
  const slug = decodeURIComponent(path.slice(1)).toLowerCase()
  return <PublicPage slug={slug} />
}
