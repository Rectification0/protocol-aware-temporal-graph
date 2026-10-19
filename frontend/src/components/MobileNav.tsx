import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Menu, ShieldHalf, X } from 'lucide-react'
import { useState } from 'react'
import { NavLinks } from '@/components/Sidebar'
import { Button } from '@/components/ui/button'

// F16.1: below the `md` breakpoint the 224px sidebar would take most of a
// phone screen, so navigation moves into a slide-in drawer opened from the
// Navbar. A Radix Dialog underneath gives focus trapping, Escape to close
// and focus returning to the menu button -- the keyboard/screen-reader
// behavior a hand-rolled drawer usually gets wrong (F16.3). Choosing a
// link closes the drawer.

export function MobileNav() {
  const [open, setOpen] = useState(false)

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="-ml-2 md:hidden"
          aria-label="Open navigation menu"
        >
          <Menu aria-hidden="true" />
        </Button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 md:hidden" />
        <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-border bg-background py-4 shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left motion-reduce:animate-none md:hidden">
          <div className="mb-3 flex items-center justify-between px-4">
            <DialogPrimitive.Title className="flex items-center gap-2 font-mono text-sm font-semibold">
              <ShieldHalf className="size-5 text-primary" aria-hidden="true" />
              T-GNN SOC Dashboard
            </DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <Button type="button" variant="ghost" size="icon" aria-label="Close navigation menu">
                <X aria-hidden="true" />
              </Button>
            </DialogPrimitive.Close>
          </div>
          <DialogPrimitive.Description className="sr-only">
            Choose a page to open.
          </DialogPrimitive.Description>
          <nav aria-label="Main navigation">
            <NavLinks onNavigate={() => setOpen(false)} />
          </nav>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
