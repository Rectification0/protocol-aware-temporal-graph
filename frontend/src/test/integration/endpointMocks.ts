import { vi } from 'vitest'

// F16.5: one `vi.fn()` per `@/api/endpoints` export. Deliberately imports
// nothing from the app -- see renderApp.tsx's header for why.
export function endpointMockFactory() {
  return {
    acknowledgeAlert: vi.fn(),
    getAlertResponseTime: vi.fn(),
    getEntityForensics: vi.fn(),
    getEntityScore: vi.fn(),
    getHealth: vi.fn(),
    getMetricsSnapshot: vi.fn(),
    getPilotReport: vi.fn(),
    getPrunedEdge: vi.fn(),
    listAuditLog: vi.fn(),
    listEntities: vi.fn(),
    listEntityScores: vi.fn(),
    listMotifCompletions: vi.fn(),
    listMotifConfig: vi.fn(),
    listMotifFeedback: vi.fn(),
    listMotifResets: vi.fn(),
    listProtocolConfig: vi.fn(),
    submitMotifFeedback: vi.fn(),
  }
}
