import type { SecurityScoreOut } from '@/types/api'

// F0.12: a `/api/security/score` response for component tests, with the
// backend's three components; override any field per test.
export function securityScoreFixture(overrides: Partial<SecurityScoreOut> = {}): SecurityScoreOut {
  return {
    score: 72.4,
    band: 'fair',
    unavailable_reason: null,
    pipeline_status: 'active',
    snapshot_age_seconds: 3,
    computed_at: 1_800_000_000,
    window_seconds: 86_400,
    formula_version: '1',
    components: [
      {
        key: 'detections',
        label: 'Motif detections',
        penalty: 15.74,
        max_penalty: 50,
        detail:
          '1 detection(s) in the window (0 acknowledged, 0 dismissed as false positives), weighted count 1.00',
        provisional: false,
        inputs: { detections: 1, counted: 1, acknowledged: 0, weighted_count: 1 },
      },
      {
        key: 'response_backlog',
        label: 'Response backlog',
        penalty: 5,
        max_penalty: 20,
        detail: 'Oldest unacknowledged detection is 60 min old',
        provisional: false,
        inputs: { oldest_unacknowledged_age_seconds: 3600 },
      },
      {
        key: 'anomalous_entities',
        label: 'Anomalous entities',
        penalty: 6.86,
        max_penalty: 30,
        detail:
          '2 of 175 entities scored in the window have |score| > 6 (untrained model: provisional)',
        provisional: true,
        inputs: { scored_entities: 175, anomalous_entities: 2, share: 0.0114 },
      },
    ],
    inputs_truncated: false,
    ...overrides,
  }
}
