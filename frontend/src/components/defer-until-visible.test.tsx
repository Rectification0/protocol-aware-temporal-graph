import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeferUntilVisible } from '@/components/defer-until-visible'

type IOCallback = (entries: Partial<IntersectionObserverEntry>[]) => void

function installFakeIntersectionObserver() {
  const instances: { callback: IOCallback; disconnect: ReturnType<typeof vi.fn> }[] = []
  class FakeIntersectionObserver {
    disconnect = vi.fn()
    callback: IOCallback
    constructor(callback: IOCallback) {
      this.callback = callback
      instances.push(this)
    }
    observe() {}
  }
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
  return instances
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('DeferUntilVisible (F16.8)', () => {
  it('renders the placeholder until the slot nears the viewport, then the content', () => {
    const observers = installFakeIntersectionObserver()
    render(
      <DeferUntilVisible placeholder={<p>placeholder</p>}>
        <p>real content</p>
      </DeferUntilVisible>,
    )
    expect(screen.getByText('placeholder')).toBeInTheDocument()
    expect(screen.queryByText('real content')).not.toBeInTheDocument()

    act(() => observers[0].callback([{ isIntersecting: false }]))
    expect(screen.queryByText('real content')).not.toBeInTheDocument()

    act(() => observers[0].callback([{ isIntersecting: true }]))
    expect(screen.getByText('real content')).toBeInTheDocument()
    expect(screen.queryByText('placeholder')).not.toBeInTheDocument()
    expect(observers[0].disconnect).toHaveBeenCalled()
  })

  it('does not mount (or let fetch) the children before they are visible', () => {
    installFakeIntersectionObserver()
    const mounted = vi.fn()
    function Child() {
      mounted()
      return null
    }
    render(
      <DeferUntilVisible placeholder={null}>
        <Child />
      </DeferUntilVisible>,
    )

    expect(mounted).not.toHaveBeenCalled()
  })

  it('renders the content immediately where IntersectionObserver is unavailable', () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    render(
      <DeferUntilVisible placeholder={<p>placeholder</p>}>
        <p>real content</p>
      </DeferUntilVisible>,
    )

    expect(screen.getByText('real content')).toBeInTheDocument()
  })
})
