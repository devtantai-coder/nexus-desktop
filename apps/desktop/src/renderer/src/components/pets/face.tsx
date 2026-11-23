import type React from 'react'
import type { PetMood, PetProps } from './types'

/** Primitives dùng chung: mắt theo mood, miệng theo mood. */

export function Eyes({
  mood,
  cy,
  spacing,
  cx = 32,
  look = 'center',
}: {
  mood: PetMood
  cy: number
  spacing: number
  cx?: number
  look?: 'center' | 'up'
}): React.JSX.Element {
  const left = cx - spacing
  const right = cx + spacing
  const pupilDy = look === 'up' ? -1.6 : 0
  switch (mood) {
    case 'success':
      return (
        <>
          <path
            d={`M ${left - 2.4} ${cy + 0.4} q 2.4 -2.6 4.8 0`}
            stroke="currentColor"
            strokeWidth="1.6"
            fill="none"
            strokeLinecap="round"
          />
          <path
            d={`M ${right - 2.4} ${cy + 0.4} q 2.4 -2.6 4.8 0`}
            stroke="currentColor"
            strokeWidth="1.6"
            fill="none"
            strokeLinecap="round"
          />
        </>
      )
    case 'error':
      return (
        <>
          <path
            d={`M ${left - 2} ${cy - 2} l 4 4 M ${left + 2} ${cy - 2} l -4 4`}
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <path
            d={`M ${right - 2} ${cy - 2} l 4 4 M ${right + 2} ${cy - 2} l -4 4`}
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </>
      )
    case 'waiting':
      return (
        <>
          <circle cx={left} cy={cy} r="2.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx={right} cy={cy} r="2.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx={left} cy={cy} r="0.9" fill="currentColor" />
          <circle cx={right} cy={cy} r="0.9" fill="currentColor" />
        </>
      )
    default:
      return (
        <>
          <circle cx={left} cy={cy + pupilDy} r="1.7" fill="currentColor" />
          <circle cx={right} cy={cy + pupilDy} r="1.7" fill="currentColor" />
        </>
      )
  }
}

export function Mouth({
  mood,
  cy,
  cx = 32,
  width = 7,
}: {
  mood: PetMood
  cy: number
  cx?: number
  width?: number
}): React.JSX.Element {
  switch (mood) {
    case 'success':
      return (
        <path
          d={`M ${cx - width} ${cy - 1.5} q ${width} ${width + 2.5} ${width * 2} 0`}
          stroke="currentColor"
          strokeWidth="1.7"
          fill="none"
          strokeLinecap="round"
        />
      )
    case 'error':
      return (
        <path
          d={`M ${cx - width} ${cy + 1.5} q ${width / 2} -3 ${width} 0 t ${width} 0`}
          stroke="currentColor"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
        />
      )
    case 'waiting':
      return (
        <ellipse
          cx={cx}
          cy={cy + 0.5}
          rx="2"
          ry="2.4"
          stroke="currentColor"
          strokeWidth="1.4"
          fill="none"
        />
      )
    case 'thinking':
      return (
        <line
          x1={cx - width}
          y1={cy}
          x2={cx + width}
          y2={cy}
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      )
    default:
      return (
        <path
          d={`M ${cx - 4} ${cy} q 4 3 8 0`}
          stroke="currentColor"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
        />
      )
  }
}

export function PetSvg({
  state,
  size = 56,
  className,
  style,
  children,
}: PetProps & {
  className?: string
  style?: React.CSSProperties
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role="img"
      aria-hidden
      className={`pet-${state} ${className ?? ''}`}
      style={style}
    >
      {children}
    </svg>
  )
}
