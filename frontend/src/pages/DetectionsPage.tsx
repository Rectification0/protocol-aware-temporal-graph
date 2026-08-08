import { useMemo, useState } from 'react'
import type { PaginationState } from '@tanstack/react-table'
import { DataTable } from '@/components/data-table'
import { FilterBar, type FilterChipData } from '@/components/filter-bar'
import type { FeedbackDisposition, ThreatSeverity } from '@/components/severity-badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { detectionColumns } from '@/features/detections/columns'
import {
  buildDetectionRows,
  EMPTY_DETECTION_FILTERS,
  filterDetectionRows,
  uniqueCategories,
  type DetectionFilters,
} from '@/features/detections/logic'
import { useEntityScores, useMotifCompletions, useMotifFeedback } from '@/hooks/api'

// F0's max page size for all three endpoints -- this page samples the
// most recent 500 motif completions, 500 T-GNN scores, and 500 feedback
// records, not an exhaustive history. Same honest-sampling posture F7/F8
// already established for the analytics page.
const SAMPLE_PAGE: PaginationState = { pageIndex: 0, pageSize: 500 }

const SEVERITY_OPTIONS: ThreatSeverity[] = ['critical', 'high', 'medium', 'low', 'info']
const DISPOSITION_OPTIONS: FeedbackDisposition[] = [
  'true_positive',
  'false_positive',
  'unconfirmed',
]
const DISPOSITION_LABEL: Record<FeedbackDisposition, string> = {
  true_positive: 'True positive',
  false_positive: 'False positive',
  unconfirmed: 'Unconfirmed',
}

const ALL_VALUE = 'all'

// Milestone F9 (Detection Matrix): merges F0.4's motif completions and
// F0.3's `trigger === "scheduled"` T-GNN deviation scores into one
// severity-ranked table (`features/detections/logic.ts`), covering both
// detection paths per tasks.md's F9.3 line -- matching `pilot.py`'s own
// two-path evaluation split.
export function Component() {
  const completions = useMotifCompletions(SAMPLE_PAGE)
  const scores = useEntityScores(SAMPLE_PAGE)
  const feedback = useMotifFeedback(SAMPLE_PAGE)
  const [filters, setFilters] = useState<DetectionFilters>(EMPTY_DETECTION_FILTERS)

  const isLoading = completions.isLoading || scores.isLoading || feedback.isLoading
  const rows = useMemo(
    () => buildDetectionRows(completions.rows, scores.rows, feedback.rows),
    [completions.rows, scores.rows, feedback.rows],
  )
  const categoryOptions = useMemo(() => uniqueCategories(rows), [rows])
  const filteredRows = useMemo(() => filterDetectionRows(rows, filters), [rows, filters])

  const activeChips: FilterChipData[] = [
    filters.severity && {
      id: 'severity',
      label: `Severity: ${filters.severity}`,
      onRemove: () => setFilters((f) => ({ ...f, severity: null })),
    },
    filters.disposition && {
      id: 'disposition',
      label: `Status: ${DISPOSITION_LABEL[filters.disposition]}`,
      onRemove: () => setFilters((f) => ({ ...f, disposition: null })),
    },
    filters.category && {
      id: 'category',
      label: `Category: ${filters.category}`,
      onRemove: () => setFilters((f) => ({ ...f, category: null })),
    },
  ].filter((chip): chip is FilterChipData => chip !== null)

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Detections</h1>
      <p className="text-sm text-muted-foreground">
        Sampled from the most recent {SAMPLE_PAGE.pageSize} motif completions and T-GNN deviation
        scores -- not an exhaustive history. Severity thresholds are provisional (tasks.md
        F9.1/F7.1), pending a real calibrated model (F0.12).
      </p>

      <FilterBar filters={activeChips} onClearAll={() => setFilters(EMPTY_DETECTION_FILTERS)}>
        <Select
          value={filters.severity ?? ALL_VALUE}
          onValueChange={(value) =>
            setFilters((f) => ({
              ...f,
              severity: value === ALL_VALUE ? null : (value as ThreatSeverity),
            }))
          }
        >
          <SelectTrigger className="h-8 w-40">
            <SelectValue placeholder="Severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>All severities</SelectItem>
            {SEVERITY_OPTIONS.map((severity) => (
              <SelectItem key={severity} value={severity}>
                {severity}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.disposition ?? ALL_VALUE}
          onValueChange={(value) =>
            setFilters((f) => ({
              ...f,
              disposition: value === ALL_VALUE ? null : (value as FeedbackDisposition),
            }))
          }
        >
          <SelectTrigger className="h-8 w-44">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>All statuses</SelectItem>
            {DISPOSITION_OPTIONS.map((disposition) => (
              <SelectItem key={disposition} value={disposition}>
                {DISPOSITION_LABEL[disposition]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.category ?? ALL_VALUE}
          onValueChange={(value) =>
            setFilters((f) => ({ ...f, category: value === ALL_VALUE ? null : value }))
          }
        >
          <SelectTrigger className="h-8 w-48">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>All categories</SelectItem>
            {categoryOptions.map((category) => (
              <SelectItem key={category} value={category}>
                {category}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterBar>

      <DataTable
        columns={detectionColumns}
        data={filteredRows}
        loading={isLoading}
        emptyMessage="No detections match the current filters."
        getRowId={(row) => row.id}
      />
    </section>
  )
}
