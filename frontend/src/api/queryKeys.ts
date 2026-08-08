// Centralized TanStack Query key factory (tasks.md F4.2) -- every hook in
// `src/hooks/api/` builds its key from here so cache invalidation (F4.6's
// live-stream dispatch included) targets the exact same keys queries were
// registered under, rather than each caller inventing its own array shape.

export const queryKeys = {
  metricsSnapshot: () => ['metrics', 'snapshot'] as const,
  entityScores: (params: { limit: number; offset: number; start?: number; end?: number }) =>
    ['scores', 'entities', params] as const,
  entityScore: (entityId: string) => ['scores', 'entities', entityId] as const,
  motifCompletions: (params: {
    limit: number
    offset: number
    motifName?: string
    chainKey?: string
    start?: number
    end?: number
  }) => ['motifs', 'completions', params] as const,
  motifResets: (params: { limit: number; offset: number }) => ['motifs', 'resets', params] as const,
  motifFeedback: (params: { limit: number; offset: number }) =>
    ['motifs', 'feedback', params] as const,
  entityForensics: (entityId: string, start: number, end: number) =>
    ['forensics', 'entity', entityId, start, end] as const,
  prunedEdge: (edgeId: string) => ['forensics', 'edge', edgeId] as const,
  protocolConfig: () => ['config', 'protocols'] as const,
  motifConfig: () => ['config', 'motifs'] as const,
  auditLog: (params: { limit: number; offset: number; since?: number; type?: string }) =>
    ['audit', 'log', params] as const,
  health: () => ['health'] as const,
  // F8.4: no params -- there is exactly one "latest" report file.
  pilotReport: () => ['pilot', 'latest-report'] as const,
  entities: (params: { type?: string; limit: number; offset: number }) =>
    ['entities', params] as const,
}
