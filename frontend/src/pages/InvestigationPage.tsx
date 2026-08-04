import { useParams } from 'react-router-dom'

export function Component() {
  const { entityId } = useParams<{ entityId: string }>()

  return (
    <section className="space-y-2">
      <h1 className="text-2xl font-semibold">Investigation: {entityId}</h1>
      <p className="text-sm text-muted-foreground">Placeholder -- built out in Milestone F10.</p>
    </section>
  )
}
