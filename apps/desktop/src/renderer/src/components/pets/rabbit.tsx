import type React from 'react'
import { Eyes, Mouth, PetSvg } from './face'
import type { PetProps } from './types'

export function RabbitPet({ state, size }: PetProps): React.JSX.Element {
  return (
    <PetSvg state={state} size={size} style={{ color: '#4a5568' }}>
      <rect
        x="19"
        y="2"
        width="9"
        height="22"
        rx="4.5"
        fill="#eef2f7"
        stroke="currentColor"
        strokeWidth="2"
      />
      <rect
        x="36"
        y="2"
        width="9"
        height="22"
        rx="4.5"
        fill="#eef2f7"
        stroke="currentColor"
        strokeWidth="2"
      />
      <rect x="21.6" y="6" width="3.8" height="13" rx="1.9" fill="#ffc2d1" />
      <rect x="38.6" y="6" width="3.8" height="13" rx="1.9" fill="#ffc2d1" />
      <rect
        x="9"
        y="20"
        width="46"
        height="36"
        rx="16"
        fill="#eef2f7"
        stroke="currentColor"
        strokeWidth="2.2"
      />
      <Eyes mood={state} cy={35} spacing={8.5} />
      <circle cx="32" cy="43" r="1.4" fill="#ff8fa3" />
      <Mouth mood={state} cy={47} cx={32} />
    </PetSvg>
  )
}
