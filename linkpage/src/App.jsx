import PublicPage from './PublicPage.jsx'
import Editor from './Editor.jsx'
import Privacy from './Privacy.jsx'

// Path-based routing without a router: three fixed routes and the catch-all
// band slug. A page path is one segment (main, /foo) or two (release,
// /foo/bar); the slug is the decoded path. Navigation is full page loads.
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
  const slug = path
    .slice(1)
    .split('/')
    .map(decodeURIComponent)
    .join('/')
    .toLowerCase()
  return <PublicPage slug={slug} />
}
