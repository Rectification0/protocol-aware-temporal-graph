import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ApiConfigSection } from '@/features/settings/ApiConfigSection'
import { env } from '@/config/env'

describe('ApiConfigSection', () => {
  it('shows the configured base URL and mode, read-only', () => {
    render(<ApiConfigSection />)

    expect(screen.getByText(env.apiBaseUrl)).toBeInTheDocument()
    expect(screen.getByText(import.meta.env.MODE)).toBeInTheDocument()
    expect(screen.getByText(/not editable here/)).toBeInTheDocument()
  })
})
