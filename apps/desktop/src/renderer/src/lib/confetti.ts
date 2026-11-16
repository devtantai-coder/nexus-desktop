/** Confetti cannon kiểu Codex: DOM + CSS, không thư viện. */
export function fireConfetti(count = 80): void {
  const colors = ['#339cff', '#ff5c8a', '#ffd166', '#06d6a0', '#b388ff']
  const layer = document.createElement('div')
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999;overflow:hidden'
  document.body.appendChild(layer)
  for (let index = 0; index < count; index += 1) {
    const piece = document.createElement('span')
    const size = 6 + Math.random() * 6
    piece.style.cssText = `position:absolute;left:${Math.random() * 100}vw;top:-10px;width:${size}px;height:${size * 0.6}px;background:${colors[index % colors.length]};border-radius:1px;opacity:1;transform:rotate(${Math.random() * 360}deg)`
    layer.appendChild(piece)
    piece.animate(
      [
        { transform: `translateY(0) rotate(0deg)`, opacity: 1 },
        {
          transform: `translateY(${window.innerHeight + 40}px) rotate(${540 + Math.random() * 360}deg)`,
          opacity: 0,
        },
      ],
      { duration: 1800 + Math.random() * 1200, easing: 'cubic-bezier(.2,.6,.4,1)', delay: index * 8 },
    )
  }
  window.setTimeout(() => layer.remove(), 3600)
}
