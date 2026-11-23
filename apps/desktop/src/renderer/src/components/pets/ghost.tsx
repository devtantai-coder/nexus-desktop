import type React from 'react'
import { Eyes, Mouth, PetSvg } from './face'
import type { PetProps } from './types'

export function GhostPet({ state, size }: PetProps): React.JSX.Element {
  return (
    <PetSvg state={state} size={size} style={{ color: '#475569' }}>
      <path
        d="M12 54V28a20 20 0 0 1 40 0v26l-6.4-5.6-6.6 5.6-7-5.8-6.8 5.8-6.6-5.6Z"
        fill="#f1f5f9"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <Eyes mood={state} cy={30} spacing={8} />
      <Mouth mood={state} cy={40} cx={32} />
    </PetSvg>
  )
}
