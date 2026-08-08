import { useMemo, useState } from 'react'
import type { PaginationState } from '@tanstack/react-table'
import { DataTable } from '@/components/data-table'
import { FilterBar, type FilterChipData } from '@/components/filter-bar'
import { SearchBar } from '@/components/search-bar'
import { TimeRangeFilter } from '@/components/time-range-filter'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { createLogColumns } from '@/features/logs/columns'
import {
  logRowKey,
  logsToCsv,
  logsToJson,
  matchesLogFilters,
  motifResetEventToAuditRecord,
  toLogRow,
  type LogRow,
} from '@/features/logs/logic'
import { RawLogDialog } from '@/features/logs/raw-log-dialog'
import { useAuditLog } from '@/hooks/api'
import { useLiveStreamStore } from '@/store/liveStreamStore'
import { useTimeRangeStore } from '@/store/timeRangeStore'
import type { AuditRecordType } from '@/types/api'

const ALL_VALUE = 'all'
const TYPE_OPTIONS: AuditRecordType[] = ['prune', 'motif_reset']
const TYPE_LABEL: Record<AuditRecordType, string> = { prune: 'Prune', motif_reset: 'Motif reset' }

function downloadFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

// Milestone F11 (Log Explorer): F0.8's audit trail (prune + motif-reset
// records) -- explicitly the audit trail, not raw ingested Sysmon/Windows
// events (audit.py's own docstring; no raw-event store exists anywhere in
// this repo, per F11.1's line). Search/type/entity filtering and
// pagination (F11.1/F11.2/F11.6) all run server-side against `audit.py`'s
// `read_records()`, which already returns an exact `total` (a full file
// scan per request). Live updates (F11.7) are deliberately NOT a silent
// auto-refresh: `useAuditLog`'s own polling is turned off here
// (`liveStream.ts`'s 'prune' handler also no longer invalidates this
// query, for the same reason), and new records instead accumulate in a
// dismissible "N new" banner sourced from `useLiveStreamStore`'s event
// feed until the analyst chooses to load them.
export function Component() {
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 })
  const [type, setType] = useState<AuditRecordType | null>(null)
  const [entity, setEntity] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [rawLogRow, setRawLogRow] = useState<LogRow | null>(null)
  const range = useTimeRangeStore((state) => state.range)

  const auditLog = useAuditLog(
    pagination,
    {
      since: range.start,
      until: range.end,
      type: type ?? undefined,
      entity: entity ?? undefined,
      q: query || undefined,
    },
    { refetchInterval: false },
  )

  const rows = useMemo(() => auditLog.rows.map((record) => toLogRow(record)), [auditLog.rows])
  const knownKeys = useMemo(() => new Set(rows.map((row) => row.key)), [rows])

  const liveEvents = useLiveStreamStore((state) => state.events)
  const newRows = useMemo(() => {
    // Before the page's first successful fetch, `dataUpdatedAt` is 0 --
    // treating every already-buffered store event (up to 200, possibly
    // from well before this page mounted) as "new" would flash a
    // misleading count. Nothing counts as new until there's a real
    // baseline fetch to compare against.
    if (!auditLog.dataUpdatedAt) return []
    const criteria = { type, entity, query, start: range.start, end: range.end }
    const seen = new Set<string>()
    const result: LogRow[] = []
    for (const event of liveEvents) {
      if (event.receivedAt <= auditLog.dataUpdatedAt) continue
      const record =
        event.type === 'prune'
          ? event.data
          : event.type === 'motif_reset'
            ? motifResetEventToAuditRecord(event.data)
            : null
      if (!record) continue
      const key = logRowKey(record)
      if (knownKeys.has(key) || seen.has(key)) continue
      if (!matchesLogFilters(record, criteria)) continue
      seen.add(key)
      result.push(toLogRow(record, true))
    }
    return result
  }, [liveEvents, auditLog.dataUpdatedAt, knownKeys, type, entity, query, range.start, range.end])

  function loadNewRecords() {
    setPagination((p) => ({ ...p, pageIndex: 0 }))
    void auditLog.refetch()
  }

  const activeChips: FilterChipData[] = [
    type && { id: 'type', label: `Type: ${TYPE_LABEL[type]}`, onRemove: () => setType(null) },
    entity && { id: 'entity', label: `Entity: ${entity}`, onRemove: () => setEntity(null) },
  ].filter((chip): chip is FilterChipData => Boolean(chip))

  const displayRows = [...newRows, ...rows]

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Logs</h1>
      <p className="text-sm text-muted-foreground">
        The prune/motif-reset audit trail (NFR5) -- not raw ingested Sysmon/Windows events. No
        raw-event store exists in this repo; a source event's identity survives only as the opaque{' '}
        <code>raw_event_id</code> reference carried on the edge that produced it.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <SearchBar
          value={query}
          onChange={(value) => {
            setQuery(value)
            setPagination((p) => ({ ...p, pageIndex: 0 }))
          }}
          placeholder="Search logs..."
          className="w-64"
        />
        <Input
          value={entity ?? ''}
          onChange={(event) => {
            setEntity(event.target.value || null)
            setPagination((p) => ({ ...p, pageIndex: 0 }))
          }}
          placeholder="Filter by entity id..."
          className="h-9 w-56"
        />
        <Select
          value={type ?? ALL_VALUE}
          onValueChange={(value) => {
            setType(value === ALL_VALUE ? null : (value as AuditRecordType))
            setPagination((p) => ({ ...p, pageIndex: 0 }))
          }}
        >
          <SelectTrigger className="h-9 w-40">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>All types</SelectItem>
            {TYPE_OPTIONS.map((option) => (
              <SelectItem key={option} value={option}>
                {TYPE_LABEL[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <TimeRangeFilter />
      </div>

      <FilterBar
        filters={activeChips}
        onClearAll={() => {
          setType(null)
          setEntity(null)
        }}
      />

      {newRows.length > 0 && (
        <div className="flex items-center justify-between rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm">
          <span>
            {newRows.length} new log {newRows.length === 1 ? 'event' : 'events'} since this page was
            loaded.
          </span>
          <Button type="button" size="sm" onClick={loadNewRecords}>
            Refresh
          </Button>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={rows.length === 0}
          onClick={() => downloadFile('audit-log.csv', logsToCsv(rows), 'text/csv')}
        >
          Export CSV
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={rows.length === 0}
          onClick={() => downloadFile('audit-log.json', logsToJson(rows), 'application/json')}
        >
          Export JSON
        </Button>
        <span className="text-xs text-muted-foreground">
          Exports the current filtered page ({rows.length} row{rows.length === 1 ? '' : 's'}), not
          every page of the filtered result.
        </span>
      </div>

      <DataTable
        columns={createLogColumns(setRawLogRow)}
        data={displayRows}
        loading={auditLog.isLoading}
        emptyMessage="No log records match the current filters."
        getRowId={(row) => row.key}
        pageCount={auditLog.pageCount}
        pagination={pagination}
        onPaginationChange={setPagination}
      />

      <RawLogDialog row={rawLogRow} onOpenChange={(open) => !open && setRawLogRow(null)} />
    </section>
  )
}
