import { Component, type ErrorInfo, type ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'
import { EmptyState } from '@/components/empty-state'
import { Button } from '@/components/ui/button'

// F16.9: a per-panel error boundary, so one tile/chart/section throwing
// during render degrades to a contained "failed to load" card instead of
// propagating up to the route's `errorElement` and blanking the whole page.
// Complements F5.13's empty states: those cover a query that *returned*
// nothing (or an F0 `[BACKEND TODO]` gap); this covers a component that
// *crashed*. A failed fetch is not a crash -- TanStack Query surfaces it
// as `isError`, which each tile already renders as its own unavailable
// state -- so this only ever catches genuine render bugs.
//
// React still has no hook equivalent of `componentDidCatch`, hence a class.

export interface SectionErrorBoundaryProps {
  /** Human-readable panel name, shown in the fallback, e.g. "Threat trends". */
  label: string
  children: ReactNode
  className?: string
  /**
   * Clears a caught error when this value changes -- e.g. the route param
   * on a page whose panels stay mounted across navigations, so a crash on
   * one entity doesn't stick to the next.
   */
  resetKey?: unknown
  /** Replaces the default card, for slots too small for it (e.g. the Navbar). */
  fallback?: (props: { error: Error; reset: () => void }) => ReactNode
}

interface SectionErrorBoundaryState {
  error: Error | null
}

export class SectionErrorBoundary extends Component<
  SectionErrorBoundaryProps,
  SectionErrorBoundaryState
> {
  state: SectionErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: unknown): SectionErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(
      `[SectionErrorBoundary] "${this.props.label}" crashed`,
      error,
      info.componentStack,
    )
  }

  componentDidUpdate(prevProps: SectionErrorBoundaryProps) {
    if (this.state.error && !Object.is(prevProps.resetKey, this.props.resetKey)) this.reset()
  }

  private reset = () => this.setState({ error: null })

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    if (this.props.fallback) return this.props.fallback({ error, reset: this.reset })

    return (
      <EmptyState
        icon={TriangleAlert}
        title={`${this.props.label} failed to load`}
        description={error.message || 'Unexpected error while rendering this panel.'}
        className={this.props.className}
        action={
          <Button type="button" variant="outline" size="sm" onClick={this.reset}>
            Retry
          </Button>
        }
      />
    )
  }
}
