import { Route, Routes } from 'react-router-dom'
import AppShell from './components/AppShell.jsx'
import RequireAuth from './components/RequireAuth.jsx'
import RequireAdmin from './components/RequireAdmin.jsx'
import AvailabilityPage from './components/AvailabilityPage.jsx'
import GigsPage from './components/GigsPage.jsx'
import ProfilePage from './components/ProfilePage.jsx'
import RehearsalsPage from './components/RehearsalsPage.jsx'
import TasksPage from './components/TasksPage.jsx'
import LoginPage from './pages/LoginPage.jsx'
import PendingApprovalPage from './pages/PendingApprovalPage.jsx'
import MembersPage from './pages/MembersPage.jsx'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/pending" element={<PendingApprovalPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<ProfilePage />} />
          <Route path="/gigs" element={<GigsPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/rehearsals" element={<RehearsalsPage />} />
          <Route path="/availability" element={<AvailabilityPage />} />
          <Route element={<RequireAdmin />}>
            <Route path="/members" element={<MembersPage />} />
          </Route>
        </Route>
      </Route>
    </Routes>
  )
}
