import type React from 'react'

/**
 * Logo NEXUS — hình lục giác chứa chữ N nối các đỉnh.
 * Tự vẽ cho dự án, không dùng lại tài sản của Codex/OpenAI.
 */
export function NexusLogo({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2.75 20 7.4v9.2L12 21.25 4 16.6V7.4z" strokeWidth="1.6" opacity="0.55" />
      <path d="M8.6 16.2V7.8l6.8 8.4V7.8" strokeWidth="2.1" />
      <circle cx="8.6" cy="7.8" r="0.7" fill="currentColor" stroke="none" />
      <circle cx="15.4" cy="16.2" r="0.7" fill="currentColor" stroke="none" />
    </svg>
  )
}
