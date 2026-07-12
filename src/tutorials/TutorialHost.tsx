import { useNavigate } from 'react-router-dom'
import { useActiveTutorial } from './useActiveTutorial.ts'

// Renders the currently-active tutorial's card (or nothing). Mounted once inside
// AppShell so tutorials can surface on any in-app route. The card itself is a
// self-contained overlay (Dialog); the host only wires dismiss/accept.
export default function TutorialHost() {
  const navigate = useNavigate()
  const { active, dismiss } = useActiveTutorial()
  if (!active) return null
  const { key, Card } = active
  return (
    <Card
      onDismiss={() => dismiss(key)}
      onAccept={(to) => { dismiss(key); navigate(to) }}
    />
  )
}
