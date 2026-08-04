import { useId, useState, type FormEvent } from 'react'
import { ShieldHalf } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { env } from '@/config/env'
import { ROUTES } from '@/config/routes'
import { useAuthStore } from '@/store/authStore'

interface LoginLocationState {
  from?: string
}

export function Component() {
  const [analyst, setAnalyst] = useState('')
  const login = useAuthStore((state) => state.login)
  const navigate = useNavigate()
  const location = useLocation()
  const inputId = useId()

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = analyst.trim()
    if (!trimmed) return

    login(trimmed)
    const from = (location.state as LoginLocationState | null)?.from ?? ROUTES.home
    navigate(from, { replace: true })
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <ShieldHalf className="mb-2 size-8 text-primary" />
          <CardTitle>Log in</CardTitle>
          <CardDescription>
            {env.mockAuthEnabled
              ? "Mock authentication (tasks.md F3.4) — enter any name to continue as that analyst; there's no password, since no real credential store exists yet."
              : 'T-GNN SOC Dashboard'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {env.mockAuthEnabled ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor={inputId}>Analyst name</Label>
                <Input
                  id={inputId}
                  value={analyst}
                  onChange={(event) => setAnalyst(event.target.value)}
                  autoComplete="username"
                  autoFocus
                />
              </div>
              <Button type="submit" className="w-full">
                Log in
              </Button>
            </form>
          ) : (
            // F3.4: until F0.11 ships real backend auth, disabling the
            // mock-auth bypass leaves the app with no way to log in at
            // all -- that's the honest state (per tasks.md's "do not
            // build a real credential store client-side"), not a bug to
            // work around here.
            <p className="text-sm text-muted-foreground">
              Real authentication isn&apos;t available yet (tasks.md F0.11 is a documented backend
              gap), and the mock-auth bypass is disabled (
              <code className="font-mono">VITE_MOCK_AUTH_ENABLED=false</code>).
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
