import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuffer = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
  return Buffer.concat([length, typeBuffer, data, crc])
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4)
  const set = (x, y, r, g, b, a = 255) => {
    const index = (y * size + x) * 4
    rgba[index] = r
    rgba[index + 1] = g
    rgba[index + 2] = b
    rgba[index + 3] = a
  }
  const radius = size * 0.22
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = Math.max(radius - x, 0, x - (size - radius - 1))
      const dy = Math.max(radius - y, 0, y - (size - radius - 1))
      if (Math.hypot(dx, dy) > radius) continue
      const gradient = Math.round(28 + (y / size) * 12)
      set(x, y, gradient, gradient, gradient)
    }
  }
  const stroke = Math.max(4, Math.round(size * 0.075))
  const left = Math.round(size * 0.3)
  const right = Math.round(size * 0.7)
  const top = Math.round(size * 0.28)
  const bottom = Math.round(size * 0.72)
  for (let y = top; y < bottom; y += 1) {
    const progress = (y - top) / (bottom - top)
    const xDiagonal = Math.round(left + progress * (right - left - stroke))
    for (let t = 0; t < stroke; t += 1) {
      set(left + t, y, 238, 238, 238)
      set(right - stroke + t, y, 238, 238, 238)
      const x = Math.min(size - 1, Math.max(0, xDiagonal + t))
      set(x, y, 238, 238, 238)
    }
  }
  return encodePng(size, size, rgba)
}

const targets = [
  ['build/icon.png', 512],
  ['apps/desktop/build/icon.png', 512],
  ['apps/desktop/src/renderer/public/icon.png', 256],
]

for (const [path, size] of targets) {
  const absolute = resolve(path)
  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, drawIcon(size))
  console.log(`icon → ${path} (${size}px)`)
}
