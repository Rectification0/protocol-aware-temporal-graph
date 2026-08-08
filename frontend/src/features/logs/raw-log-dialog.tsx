import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { LogRow } from '@/features/logs/logic'

// F11.3: "view raw log entry" -- the full NDJSON record F0.8's endpoint
// already returns, pretty-printed. This *is* the raw record (audit.py's
// own docstring: "the audit trail, not raw ingested Sysmon/Windows
// events" -- see F11.1's UI copy in `LogsPage.tsx`), not a second,
// re-derived view of it.
export function RawLogDialog({
  row,
  onOpenChange,
}: {
  row: LogRow | null
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={row !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Raw log record</DialogTitle>
          <DialogDescription>
            {row
              ? `${row.type} -- logged at ${new Date(row.timestamp * 1000).toLocaleString()}`
              : null}
          </DialogDescription>
        </DialogHeader>
        <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-4 text-xs">
          {row ? JSON.stringify(row.record, null, 2) : ''}
        </pre>
      </DialogContent>
    </Dialog>
  )
}
