export type PetMood = 'idle' | 'thinking' | 'waiting' | 'success' | 'error'

export interface PetProps {
  state: PetMood
  size?: number
}

export interface MiniPetDefinition {
  id: string
  name: string
  description: string
  Component: React.ComponentType<PetProps>
}
