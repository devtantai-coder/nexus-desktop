import type React from 'react'
import { Eyes, Mouth, PetSvg } from './face'
import type { PetProps } from './types'

export function BlobPet({ state, size }: PetProps): React.JSX.Element {
  return (
    <PetSvg state={state} size={size} style={{ color: '#0c4a6e' }}>
      <path
        d="M32 8c11 0 19 7.6 19 17.4 0 4 .6 6.4 2.6 9.8 2.4 4-1.6 8.8-7.2 8.8-3.4 0-5-1.4-8-1.4s-4.6 1.4-8 1.4c-5.6 0-9.6-4.8-7.2-8.8 2-3.4 2.6-5.8 2.6-9.8C13 15.6 21 8 32 8Z"
        fill="#7dd3fc"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <Eyes mood={state} cy={30} spacing={8} />
      <Mouth mood={state} cy={41} cx={32} />
      <circle cx="22" cy="36.5" r="2.1" fill="#fda4af" opacity="0.85" />
      <circle cx="42" cy="36.5" r="2.1" fill="#fda4af" opacity="0.85" />
    </PetSvg>
  )
}
