import type React from 'react'
import { useEffect, useRef, useState } from 'react'

/** "Show Pet" kiểu Codex: overlay nhỏ, kéo được, không chặn thao tác. */
export function Pet({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [pos, setPos] = useState({ x: 24, y: 0 })
  const drag = useRef<{ dx: number; dy: number } | null>(null)

  useEffect(() => {
    setPos({ x: 24, y: window.innerHeight - 140 })
    const move = (event: MouseEvent): void => {
      if (!drag.current) return
      setPos({ x: event.clientX - drag.current.dx, y: event.clientY - drag.current.dy })
    }
    const up = (): void => {
      drag.current = null
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [])

  return (
    <div
      role="img"
      aria-label="Pet"
      onDoubleClick={onClose}
      onMouseDown={(event) => {
        drag.current = { dx: event.clientX - pos.x, dy: event.clientY - pos.y }
      }}
      style={{ left: pos.x, top: pos.y }}
      className="fixed z-[60] cursor-grab select-none rounded-full bg-[var(--bg-elevated)] p-2 text-[22px] shadow-[var(--shadow-overlay)] active:cursor-grabbing"
      title="Kéo để di chuyển · nhấp đúp để ẩn"
    >
      🐣
    </div>
  )
}
