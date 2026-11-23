import type React from 'react'
import { Eyes, Mouth, PetSvg } from './face'
import type { PetProps } from './types'

export function RobotPet({ state, size }: PetProps): React.JSX.Element {
  const glow = state === 'success' ? '#34d399' : state === 'error' ? '#f87171' : '#60a5fa'
  return (
    <PetSvg state={state} size={size} style={{ color: '#1e293b' }}>
      <line
        x1="32"
        y1="2"
        x2="32"
        y2="10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="32" cy="4" r="2.6" fill={glow} stroke="currentColor" strokeWidth="1.6" />
      <rect
        x="8"
        y="16"
        width="7"
        height="14"
        rx="2"
        fill="#94a3b8"
        stroke="currentColor"
        strokeWidth="2"
      />
      <rect
        x="49"
        y="16"
        width="7"
        height="14"
        rx="2"
        fill="#94a3b8"
        stroke="currentColor"
        strokeWidth="2"
      />
      <rect
        x="15"
        y="11"
        width="34"
        height="40"
        rx="9"
        fill="#cbd5e1"
        stroke="currentColor"
        strokeWidth="2.2"
      />
      <rect x="21" y="18" width="22" height="15" rx="4" fill="#0f172a" />
      <g style={{ color: glow }}>
        <Eyes mood={state} cy={25.5} spacing={4.6} cx={32} />
      </g>
      <Mouth mood={state} cy={42} cx={32} width={5} />
    </PetSvg>
  )
}
