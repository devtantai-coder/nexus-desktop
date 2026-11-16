import type React from 'react'

/** Logo Claude: 12 tia toả tròn, tô theo currentColor. */
export function ClaudeMark({
  size = 18,
  className,
}: {
  size?: number
  className?: string
}): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden className={className}>
      {Array.from({ length: 12 }, (_, index) => (
        <rect
          key={index}
          x="11.05"
          y="1.6"
          width="1.9"
          height="7.4"
          rx="0.95"
          fill="currentColor"
          transform={`rotate(${index * 30} 12 12)`}
        />
      ))}
    </svg>
  )
}
