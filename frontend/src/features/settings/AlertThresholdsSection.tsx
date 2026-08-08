import { getErrorMessage } from '@/api/client'
import { EmptyState } from '@/components/empty-state'
import { ListSkeleton } from '@/components/skeletons'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  formatHalfLife,
  formatLambda,
  formatMotifSteps,
  formatWindowSeconds,
} from '@/features/settings/logic'
import { useMotifConfig, useProtocolConfig } from '@/hooks/api'

// F15.5: read-only display of `config/protocols.yaml`/`config/motifs.yaml`
// via F0.9's `/api/config/protocols`/`/api/config/motifs`. No write path --
// today those files are hand-edited + `ProtocolDecayRegistry.reload()`/
// `MotifRegistry.reload()` (docs/operational-runbook.md); an editable UI
// is explicitly a separate, larger follow-up per this line's own note, not
// built speculatively here.
export function AlertThresholdsSection() {
  const protocols = useProtocolConfig()
  const motifs = useMotifConfig()

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-2 text-sm font-medium">
          Protocol decay (&lambda;<sub>p</sub>)
        </h3>
        {protocols.isLoading ? (
          <ListSkeleton rows={3} />
        ) : protocols.isError ? (
          <EmptyState title="Unavailable" description={getErrorMessage(protocols.error)} />
        ) : !protocols.data || protocols.data.length === 0 ? (
          <EmptyState title="No protocols configured" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Protocol</TableHead>
                <TableHead>
                  &lambda;<sub>p</sub>
                </TableHead>
                <TableHead>Half-life</TableHead>
                <TableHead>Description</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {protocols.data.map((protocol) => (
                <TableRow key={protocol.protocol}>
                  <TableCell className="font-medium">{protocol.protocol}</TableCell>
                  <TableCell className="font-mono">{formatLambda(protocol.lambda_p)}</TableCell>
                  <TableCell>{formatHalfLife(protocol.half_life_hours)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {protocol.description ?? '--'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium">Motif library</h3>
        {motifs.isLoading ? (
          <ListSkeleton rows={2} />
        ) : motifs.isError ? (
          <EmptyState title="Unavailable" description={getErrorMessage(motifs.error)} />
        ) : !motifs.data || motifs.data.length === 0 ? (
          <EmptyState title="No motifs configured" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Window</TableHead>
                <TableHead>Steps</TableHead>
                <TableHead>Description</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {motifs.data.map((motif) => (
                <TableRow key={motif.name}>
                  <TableCell className="font-medium">{motif.name}</TableCell>
                  <TableCell>{formatWindowSeconds(motif.window_seconds)}</TableCell>
                  <TableCell>{formatMotifSteps(motif.steps.length)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {motif.description ?? '--'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}
