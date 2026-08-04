import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router-dom'
import './index.css'
import { queryClient } from '@/api/queryClient'
import { router } from '@/router'
import { Toaster } from '@/components/ui/sonner'

// F1.5's provider now wraps F4.3/F4.4's configured client (retry policy +
// centralized toast/401 error handling) rather than a bare default one.

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      {/* F5.11: mounted once at the app root; call toast() from
          @/components/toast anywhere afterward. */}
      <Toaster />
    </QueryClientProvider>
  </StrictMode>,
)
