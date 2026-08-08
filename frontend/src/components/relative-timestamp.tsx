import { formatDistanceToNowStrict } from 'date-fns'

// Shared by F9's Detection Matrix and F10's Investigation timeline --
// both render a unix-seconds timestamp as "X ago" with the absolute time
// available on hover, so this was extracted rather than duplicated a
// second time.
export function RelativeTimestamp({ seconds }: { seconds: number }) {
  const date = new Date(seconds * 1000)
  return (
    <span title={date.toLocaleString()}>
      {formatDistanceToNowStrict(date, { addSuffix: true })}
    </span>
  )
}
