import type { PaginationState } from '@tanstack/react-table'
import { getErrorMessage } from '@/api/client'
import { EmptyState } from '@/components/empty-state'
import { LoadErrorNotice } from '@/components/load-error-notice'
import { RelativeTimestamp } from '@/components/relative-timestamp'
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
  describeConfigChange,
  formatHalfLife,
  formatLambda,
  formatMotifSteps,
  formatWindowSeconds,
  halfLifeHoursToLambda,
  lambdaToHalfLifeHours,
  validateHalfLifeInput,
  validateWindowMinutesInput,
} from '@/features/settings/logic'
import { ThresholdEditor } from '@/features/settings/ThresholdEditor'
import {
  useConfigCapabilities,
  useConfigChanges,
  useMotifConfig,
  useProtocolConfig,
  useUpdateMotifWindow,
  useUpdateProtocolLambda,
} from '@/hooks/api'
import { useAuthStore } from '@/store/authStore'

// F15.5: the protocol decay / motif config driving detection, via F0.9's
// `/api/config/*`. Frontend Backlog FB.1 made the two tuning values
// editable -- a protocol's half-life (λ_p = ln 2 / half-life) and a motif's
// window -- but only when the API instance opts in
// (`API_CONFIG_WRITES_ENABLED`, read via `/api/config/capabilities`);
// otherwise this stays exactly the read-only view it was, with a caption
// saying why. Writes go to config/*.yaml (still the source of truth) and
// the running pipeline hot-reloads them; each is audited (`/changes`).

const RECENT_CHANGES: PaginationState = { pageIndex: 0, pageSize: 10 }

function trimNumber(value: number): string {
  return String(Number(value.toPrecision(4)))
}

export function AlertThresholdsSection() {
  const protocols = useProtocolConfig()
  const motifs = useMotifConfig()
  const capabilities = useConfigCapabilities()
  const updateProtocol = useUpdateProtocolLambda()
  const updateMotif = useUpdateMotifWindow()
  const analyst = useAuthStore((state) => state.session?.analyst ?? null)

  const bounds = capabilities.data
  const editable = Boolean(bounds?.writes_enabled)

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">
        {capabilities.isLoading
          ? 'Checking whether this API accepts edits…'
          : editable
            ? 'Editable: changes are written to config/protocols.yaml / config/motifs.yaml, picked up by the running pipeline within seconds, and recorded under your analyst name.'
            : capabilities.isError
              ? `Read-only: couldn't check whether edits are allowed (${getErrorMessage(capabilities.error)}).`
              : 'Read-only: edits are disabled on this API instance. An operator can enable them with API_CONFIG_WRITES_ENABLED=true (docs/deployment.md).'}
      </p>

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
                <TableHead>Half-life</TableHead>
                <TableHead>
                  &lambda;<sub>p</sub>
                </TableHead>
                <TableHead>Description</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {protocols.data.map((protocol) => {
                const hours = protocol.half_life_hours ?? lambdaToHalfLifeHours(protocol.lambda_p)
                return (
                  <TableRow key={protocol.protocol}>
                    <TableCell className="font-medium">{protocol.protocol}</TableCell>
                    <TableCell>
                      <ThresholdEditor
                        label={`${protocol.protocol} half-life`}
                        display={formatHalfLife(hours)}
                        initialInput={trimNumber(hours)}
                        unit="hours"
                        editable={editable}
                        validate={(raw) => (bounds ? validateHalfLifeInput(raw, bounds) : null)}
                        describeChange={(raw) =>
                          `${protocol.protocol}'s half-life goes from ${formatHalfLife(hours)} to ${formatHalfLife(Number(raw))} (λ_p ${formatLambda(protocol.lambda_p)} → ${formatLambda(halfLifeHoursToLambda(Number(raw)))}).`
                        }
                        onSave={(raw) =>
                          updateProtocol.mutateAsync({
                            protocol: protocol.protocol,
                            lambda_p: halfLifeHoursToLambda(Number(raw)),
                            analyst,
                          })
                        }
                      />
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {formatLambda(protocol.lambda_p)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {protocol.description ?? '--'}
                    </TableCell>
                  </TableRow>
                )
              })}
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
                  <TableCell>
                    <ThresholdEditor
                      label={`${motif.name} window`}
                      display={formatWindowSeconds(motif.window_seconds)}
                      initialInput={trimNumber(motif.window_seconds / 60)}
                      unit="minutes"
                      editable={editable}
                      validate={(raw) => (bounds ? validateWindowMinutesInput(raw, bounds) : null)}
                      describeChange={(raw) =>
                        `${motif.name}'s window goes from ${formatWindowSeconds(motif.window_seconds)} to ${formatWindowSeconds(Number(raw) * 60)}; chains already in progress keep their current deadline.`
                      }
                      onSave={(raw) =>
                        updateMotif.mutateAsync({
                          name: motif.name,
                          window_seconds: Math.round(Number(raw) * 60),
                          analyst,
                        })
                      }
                    />
                  </TableCell>
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

      {editable && <RecentConfigChanges />}
    </div>
  )
}

function RecentConfigChanges() {
  const changes = useConfigChanges(RECENT_CHANGES)

  return (
    <div>
      <h3 className="mb-2 text-sm font-medium">Recent changes</h3>
      <LoadErrorNotice
        failures={[changes.isError && { label: 'Change history', error: changes.error }]}
      />
      {changes.isLoading ? (
        <ListSkeleton rows={2} />
      ) : changes.rows.length === 0 && !changes.isError ? (
        <p className="text-sm text-muted-foreground">No dashboard edits yet.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {changes.rows.map((change) => (
            <li
              key={change.id ?? `${change.target}-${change.changed_at}`}
              className="flex flex-wrap gap-x-2"
            >
              <span>{describeConfigChange(change)}</span>
              <span className="text-muted-foreground">
                by {change.changed_by ?? 'unknown analyst'},{' '}
                <RelativeTimestamp seconds={change.changed_at} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
