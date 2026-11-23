import { CatPet } from './cat'
import { RabbitPet } from './rabbit'
import { BlobPet } from './blob'
import { RobotPet } from './robot'
import { GhostPet } from './ghost'
import { DuckPet } from './duck'
import type { MiniPetDefinition } from './types'

/** Registry kiểu plugin: thêm pet mới = thêm file + 1 entry ở đây. */
export const MINI_PETS: MiniPetDefinition[] = [
  { id: 'cat', name: 'Mèo Nâu', description: 'Bạn đồng hành quẫy tai', Component: CatPet },
  { id: 'rabbit', name: 'Thỏ Trắng', description: 'Tai dài dịu dàng', Component: RabbitPet },
  { id: 'blob', name: 'Khối Mềm', description: 'Giọt nước mát lạnh', Component: BlobPet },
  { id: 'robot', name: 'Rô-bốt Mini', description: 'Mắt đổi màu theo mood', Component: RobotPet },
  { id: 'ghost', name: 'Ma Nhỏ', description: 'Lơ lửng dịu dàng', Component: GhostPet },
  { id: 'duck', name: 'Vịt Vàng', description: 'Kêu cạp cạp trong đầu', Component: DuckPet },
]

export const DEFAULT_PET_ID = 'cat'

export function findMiniPet(id: string | null | undefined): MiniPetDefinition {
  return MINI_PETS.find((pet) => pet.id === id) ?? (MINI_PETS[0] as MiniPetDefinition)
}
