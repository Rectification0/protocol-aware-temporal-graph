import { Pencil } from 'lucide-react'
import { useId, useState } from 'react'
import { getErrorMessage } from '@/api/client'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

// Frontend Backlog FB.1: one inline-editable threshold value. Flow is
// display -> edit (client-validated against the API's own bounds) ->
// explicit confirmation (this retunes live detection) -> save; a server
// rejection is shown inline and keeps the input open. When `editable` is
// false (writes disabled on the API) it's just the formatted value.

export interface ThresholdEditorProps {
  /** Formatted current value, e.g. "48.0h". */
  display: string
  /** What the input starts with when editing, e.g. "48". */
  initialInput: string
  unit: string
  /** Accessible name, e.g. "SMB half-life". */
  label: string
  editable: boolean
  validate: (raw: string) => string | null
  /** Confirmation sentence for a valid `raw`. */
  describeChange: (raw: string) => string
  onSave: (raw: string) => Promise<unknown>
}

export function ThresholdEditor({
  display,
  initialInput,
  unit,
  label,
  editable,
  validate,
  describeChange,
  onSave,
}: ThresholdEditorProps) {
  const inputId = useId()
  const [editing, setEditing] = useState(false)
  const [raw, setRaw] = useState(initialInput)
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  if (!editable) return <span>{display}</span>

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-1.5">
        {display}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label={`Edit ${label}`}
          onClick={() => {
            setRaw(initialInput)
            setServerError(null)
            setEditing(true)
          }}
        >
          <Pencil className="size-3.5" />
        </Button>
      </span>
    )
  }

  const validationError = validate(raw)
  const unchanged = raw.trim() === initialInput.trim()
  const errorId = `${inputId}-error`
  const shownError = serverError ?? (unchanged ? null : validationError)

  async function save() {
    setSaving(true)
    setServerError(null)
    try {
      await onSave(raw)
      setEditing(false)
    } catch (error) {
      setServerError(getErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <label htmlFor={inputId} className="sr-only">
          {label} ({unit})
        </label>
        <Input
          id={inputId}
          value={raw}
          inputMode="decimal"
          onChange={(event) => {
            setRaw(event.target.value)
            setServerError(null)
          }}
          aria-invalid={shownError !== null}
          aria-describedby={shownError ? errorId : undefined}
          className="h-7 w-24 font-mono text-xs"
          autoFocus
        />
        <span className="text-xs text-muted-foreground">{unit}</span>
        <Button
          type="button"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={saving || unchanged || validationError !== null}
          onClick={() => setConfirming(true)}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={saving}
          onClick={() => setEditing(false)}
        >
          Cancel
        </Button>
      </div>
      {shownError && (
        <p id={errorId} role="alert" className="text-xs text-status-error">
          {shownError}
        </p>
      )}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Change ${label}?`}
        description={`${describeChange(raw)} This retunes live detection: config/*.yaml is updated and the running pipeline picks it up within seconds. The change is audited under your analyst name.`}
        confirmLabel="Apply change"
        onConfirm={() => void save()}
      />
    </div>
  )
}
