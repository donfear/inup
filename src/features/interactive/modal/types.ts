export type ModalSectionBehavior = 'pinned' | 'body' | 'status'

export interface ModalSection {
  key: string
  rows: string[]
  required?: boolean
  behavior?: ModalSectionBehavior
}

export type InfoModalTab = 'info' | 'usedBy'
