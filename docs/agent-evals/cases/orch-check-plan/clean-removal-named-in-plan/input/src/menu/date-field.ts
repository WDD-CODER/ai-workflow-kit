import { SharedDateField } from '../shared/date-field'

export function mountMenuDate(host: HTMLElement, onPick: (d: Date) => void) {
  const field = new SharedDateField()
  field.onChange(onPick)
  host.appendChild(field.element)
}
