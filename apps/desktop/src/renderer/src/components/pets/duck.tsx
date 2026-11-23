import type React from 'react'
import { Eyes, PetSvg } from './face'
import type { PetProps } from './types'

export function DuckPet({ state, size }: PetProps): React.JSX.Element {
  return (
    <PetSvg state={state} size={size} style={{ color: '#713f12' }}>
      <circle cx="23" cy="11" r="3.2" fill="#fde047" stroke="currentColor" strokeWidth="1.8" />
      <rect
        x="9"
        y="12"
        width="46"
        height="34"
        rx="15"
        fill="#fde047"
        stroke="currentColor"
        strokeWidth="2.2"
      />
      <Eyes mood={state} cy={27} spacing={8.5} />
      <path
        d="M27 36 h10 l6 3.4 -6 3.4 h-10 Z"
        fill="#fb923c"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </PetSvg>
  )
}
