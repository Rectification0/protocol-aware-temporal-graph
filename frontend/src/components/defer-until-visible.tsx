import { useEffect, useRef, useState, type ReactNode } from 'react'

// F16.8: mounts `children` only once its slot scrolls near the viewport,
// rendering `placeholder` (sized like the real content, so nothing jumps)
// until then. For below-the-fold sections whose components fetch their own
// data -- e.g. Analytics' Visualizations -- deferring the mount defers
// their queries and chart rendering too, not just the paint. Once shown it
// stays mounted; scrolling away doesn't tear it down.
//
// Without `IntersectionObserver` (jsdom; very old browsers) it renders
// `children` immediately -- degrading to plain eager rendering, never to
// content that can't appear.

export interface DeferUntilVisibleProps {
  children: ReactNode
  placeholder: ReactNode
  /** How far before entering the viewport to start mounting. */
  rootMargin?: string
}

export function DeferUntilVisible({
  children,
  placeholder,
  rootMargin = '200px',
}: DeferUntilVisibleProps) {
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined')
  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (visible || !sentinelRef.current) return undefined
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin },
    )
    observer.observe(sentinelRef.current)
    return () => observer.disconnect()
  }, [visible, rootMargin])

  if (visible) return <>{children}</>
  return (
    <div ref={sentinelRef} data-testid="deferred-placeholder">
      {placeholder}
    </div>
  )
}
