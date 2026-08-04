import { ShieldQuestion } from 'lucide-react'
import { StatCard } from '@/components/stat-card'

// F6.1: company cybersecurity score tile. F0.12 (the backend aggregate
// formula) is a `[BACKEND TODO]` -- per this task's own instruction,
// built behind `StatCard.unavailable` (F5.13's empty-state pattern)
// rather than fabricating a number, and names the exact gap rather than
// a generic "coming soon".
export function CybersecurityScoreTile() {
  return (
    <StatCard
      label="Cybersecurity Score"
      icon={ShieldQuestion}
      unavailable="Not available yet -- depends on tasks.md F0.12 (the aggregate scoring formula hasn't been decided/built)."
    />
  )
}
