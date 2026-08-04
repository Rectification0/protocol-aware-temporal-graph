// F5.11: toast notification system. `Toaster` (src/components/ui/sonner.tsx)
// is mounted once in src/main.tsx; `toast(...)` can be called from anywhere
// afterward. Re-exported from this fixed internal path so callers import
// `@/components/toast` consistently rather than reaching into the `sonner`
// package directly.
export { toast } from 'sonner'
