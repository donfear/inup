import { vi } from 'vitest'

export function hoisted<T extends Record<string, unknown>>(factory: () => T): T {
  return vi.hoisted(factory)
}
