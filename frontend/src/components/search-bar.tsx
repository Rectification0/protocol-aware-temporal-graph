import { Search, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'

// F5.7: search bar (used by F11's Log Explorer, F10's user list). Debounces
// `onChange` (ui-ux-pro-max's debounce-throttle guidance for high-frequency
// input events -- avoids firing a search/API call on every keystroke)
// while keeping the input itself fully responsive (local state updates
// immediately, only the callback is delayed).

export interface SearchBarProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  debounceMs?: number
  className?: string
}

export function SearchBar({
  value,
  onChange,
  placeholder = 'Search...',
  debounceMs = 300,
  className,
}: SearchBarProps) {
  const [draft, setDraft] = useState(value)
  // Tracks the last-seen external `value` so a render-time comparison (not
  // an effect) can detect "the controlled value changed externally" (e.g.
  // a 'clear filters' action elsewhere) vs. "the user is typing" --
  // React's recommended pattern for adjusting state from a changed prop
  // without the extra render-then-effect-then-render cascade a
  // setState-in-effect would cause.
  const [lastExternalValue, setLastExternalValue] = useState(value)
  if (value !== lastExternalValue) {
    setLastExternalValue(value)
    setDraft(value)
  }

  useEffect(() => {
    if (draft === value) return
    const timeout = setTimeout(() => onChange(draft), debounceMs)
    return () => clearTimeout(timeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-debounce on draft changes, not on every onChange/value identity change
  }, [draft, debounceMs])

  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder={placeholder}
        className="pl-8 pr-8"
      />
      {draft && (
        <button
          type="button"
          onClick={() => setDraft('')}
          aria-label="Clear search"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  )
}
