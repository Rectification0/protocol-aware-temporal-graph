import { useMemo, useState } from 'react'
import type { ColumnDef, PaginationState } from '@tanstack/react-table'
import { Link } from 'react-router-dom'
import { DataTable } from '@/components/data-table'
import { SearchBar } from '@/components/search-bar'
import { investigationPath } from '@/config/routes'
import { useEntities } from '@/hooks/api'

// Backend max page size (entities.py) -- see that router's own doc
// comment for what "seen" means here (Neo4j cold storage, not a live
// count of everything in the active graph).
const SAMPLE_PAGE: PaginationState = { pageIndex: 0, pageSize: 500 }

const columns: ColumnDef<string, unknown>[] = [
  {
    id: 'entityId',
    header: 'User',
    cell: ({ row }) => (
      <Link
        to={investigationPath(row.original)}
        className="font-mono text-sm text-primary underline-offset-2 hover:underline"
      >
        {row.original}
      </Link>
    ),
  },
]

// F10.1: every `User:*` entity Neo4j cold storage has a record for,
// client-side-searched (F5.7) -- the backend has no text-search query
// param, and a few hundred entity ids is small enough that filtering the
// already-fetched sample is simpler than adding one.
export function Component() {
  const entities = useEntities(SAMPLE_PAGE, 'User')
  const [search, setSearch] = useState('')

  const filteredRows = useMemo(
    () => entities.rows.filter((id) => id.toLowerCase().includes(search.toLowerCase())),
    [entities.rows, search],
  )

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Users</h1>
      <p className="text-sm text-muted-foreground">
        Every <code>User:*</code> entity with at least one pruned edge on record -- an entity with
        only currently-active (not-yet-pruned) edges hasn't reached cold storage yet and won't
        appear here.
      </p>
      <SearchBar
        value={search}
        onChange={setSearch}
        placeholder="Search users..."
        className="max-w-sm"
      />
      <DataTable
        columns={columns}
        data={filteredRows}
        loading={entities.isLoading}
        emptyMessage={
          entities.isError ? 'Unable to load users.' : 'No users match the current search.'
        }
        getRowId={(id) => id}
      />
    </section>
  )
}
