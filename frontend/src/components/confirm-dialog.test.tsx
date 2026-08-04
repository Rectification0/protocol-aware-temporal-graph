import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from './confirm-dialog'

describe('ConfirmDialog', () => {
  it('renders nothing when closed', () => {
    render(
      <ConfirmDialog open={false} onOpenChange={vi.fn()} title="Log out?" onConfirm={vi.fn()} />,
    )

    expect(screen.queryByText('Log out?')).not.toBeInTheDocument()
  })

  it('renders the title and description when open', () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title="Log out?"
        description="You will need to log in again."
        onConfirm={vi.fn()}
      />,
    )

    expect(screen.getByText('Log out?')).toBeInTheDocument()
    expect(screen.getByText('You will need to log in again.')).toBeInTheDocument()
  })

  it('calls onConfirm and closes when confirmed', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Acknowledge alert?"
        confirmLabel="Acknowledge"
        onConfirm={onConfirm}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Acknowledge' }))

    expect(onConfirm).toHaveBeenCalledOnce()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('closes without confirming when cancelled', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <ConfirmDialog open onOpenChange={onOpenChange} title="Log out?" onConfirm={onConfirm} />,
    )

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onConfirm).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
