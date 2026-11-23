import type React from 'react'
import { useEffect } from 'react'
import { useAppStore } from '../../kernel'
import { DEFAULT_PET_ID, findMiniPet } from './registry'
import type { PetMood } from './types'

const MOOD_LABEL: Record<PetMood, string> = {
  idle: 'đang nghỉ',
  thinking: 'đang làm việc…',
  waiting: 'chờ bạn duyệt',
  success: 'xong rồi!',
  error: 'có lỗi xảy ra',
}

/** Bạn đồng hành hiển thị góc dưới-phải; mood dẫn xuất từ trạng thái agent trong store. */
export function MiniPet(): React.JSX.Element | null {
  const show = useAppStore((state) => state.settings['appearance.pet'] === true)
  const selectedId = String(
    useAppStore((state) => state.settings['appearance.pet.id'] ?? DEFAULT_PET_ID),
  )
  const petMood = useAppStore((state) => state.petMood)
  const approvals = useAppStore((state) => state.approvals)
  const live = useAppStore((state) => state.live)
  const loopTicks = useAppStore((state) => state.loopTicks)
  const sendingSessionId = useAppStore((state) => state.sendingSessionId)
  const setPetMood = useAppStore((state) => state.setPetMood)

  const transient = petMood === 'success' || petMood === 'error' ? petMood : null
  const busy =
    sendingSessionId !== null || Object.keys(live).length > 0 || Object.keys(loopTicks).length > 0
  const mood: PetMood =
    approvals.length > 0 ? 'waiting' : (transient ?? (busy ? 'thinking' : 'idle'))

  useEffect(() => {
    if (petMood !== 'success' && petMood !== 'error') return
    const timer = setTimeout(() => {
      if (useAppStore.getState().petMood === petMood) setPetMood('idle')
    }, 6_000)
    return () => clearTimeout(timer)
  }, [petMood, setPetMood])

  if (!show) return null
  const pet = findMiniPet(selectedId)
  const Pet = pet.Component
  return (
    <div
      role="img"
      aria-label={`${pet.name} — ${MOOD_LABEL[mood]}`}
      title={`${pet.name} — ${MOOD_LABEL[mood]}`}
      data-mini-pet={pet.id}
      data-mood={mood}
      className="mini-pet pointer-events-none fixed bottom-5 right-5 z-50 select-none text-[var(--text)]"
    >
      <Pet state={mood} size={56} />
    </div>
  )
}
