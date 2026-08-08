import { Users } from 'lucide-react'
import { StatCard } from '@/components/stat-card'
import { tileUnavailableMessage } from '@/features/dashboard/logic'
import { useEntities } from '@/hooks/api'

const COUNT_ONLY_PAGE = { pageIndex: 0, pageSize: 1 }

// F14.3 (monitored-users half): reuses F10.1's `/api/entities?type=User`
// listing -- the same "just want the envelope's `total`" trick
// `AttacksInRangeTile` (F8.3) already uses, a `pageSize: 1` request purely
// to read the exact count. Honest consequence inherited from F10.1: this
// is a cold-storage view (an entity with only currently-active,
// not-yet-pruned edges has no `Entity` node yet), not a live headcount.
export function MonitoredUsersTile() {
  const users = useEntities(COUNT_ONLY_PAGE, 'User')
  const count = users.isSuccess ? users.total : null

  return (
    <StatCard
      label="Monitored Users"
      icon={Users}
      loading={users.isLoading}
      unavailable={
        !users.isLoading && count === null
          ? tileUnavailableMessage(users.error, 'Unable to load user count')
          : undefined
      }
      value={count}
    />
  )
}
