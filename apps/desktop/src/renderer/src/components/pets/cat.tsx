import type React from 'react'
import { Eyes, Mouth, PetSvg } from './face'
import type { PetProps } from './types'

export function CatPet({ state, size }: PetProps): React.JSX.Element {
  return (
    <PetSvg state={state} size={size} style={{ color: '#7c4a1e' }}>
      <path
        d="M14 22 L18 6 L30 14 Z"
        fill="#f5a94b"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <path
        d="M50 22 L46 6 L34 14 Z"
        fill="#f5a94b"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <path d="M17.5 17.5 L20 9 L27.5 14.5 Z" fill="#ffd9b3" />
      <path d="M46.5 17.5 L44 9 L36.5 14.5 Z" fill="#ffd9b3" />
      <rect
        x="9"
        y="16"
        width="46"
        height="38"
        rx="16"
        fill="#f5a94b"
        stroke="currentColor"
        strokeWidth="2.2"
      />
      <Eyes mood={state} cy={33} spacing={8.5} />
      <path
        d="M32 38.5 l-2.2 2.6 h4.4 Z"
        fill="#ff8fa3"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <Mouth mood={state} cy={45} cx={32} />
      <path
        d="M6 35 l8 -1 M6 41 l8 1 M58 35 l-8 -1 M58 41 l-8 1"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </PetSvg>
  )
}
