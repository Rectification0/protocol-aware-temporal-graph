import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { type Theme, useThemeStore } from '@/store/themeStore'

const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
]

// F15.1: persisted theme preference (F15.6). See `themeStore.ts`'s own
// comment for why "Light" is a real, saved choice with no visible effect
// yet -- `:root`/`.dark` share the same verified-dark values today, and
// Milestone F16.2 is what would give light its own real, contrast-checked
// palette.
export function ThemeSection() {
  const theme = useThemeStore((state) => state.theme)
  const setTheme = useThemeStore((state) => state.setTheme)

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Label htmlFor="theme-select" className="w-32 text-muted-foreground">
          Theme
        </Label>
        <Select value={theme} onValueChange={(value) => setTheme(value as Theme)}>
          <SelectTrigger id="theme-select" className="h-8 w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {THEME_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {theme === 'light' && (
        <p className="text-xs text-muted-foreground">
          Saved, but has no visual effect yet -- this dashboard doesn't have a distinct light
          palette until Milestone F16.2 adds one (tasks.md).
        </p>
      )}
    </div>
  )
}
