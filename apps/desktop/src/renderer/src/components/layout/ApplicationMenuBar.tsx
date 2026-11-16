import type React from 'react'
import { useEffect, useId, useRef, useState } from 'react'
import {
  Check,
  PanelLeft,
  Moon,
  Sun,
  Monitor,
  Search,
  SquareTerminal,
  BookOpen,
  Command,
  Info,
  FolderOpen,
  FilePlus2,
  Settings,
} from 'lucide-react'
import { useAppStore } from '../../kernel'
import { newSession, openProject } from '../../lib/actions'

type MenuId = 'file' | 'edit' | 'view' | 'help'

interface MenuItem {
  id: string
  label: string
  shortcut?: string
  checked?: boolean
  separator?: false
  run: () => void
}

function Item({
  item,
  onClose,
}: {
  item: MenuItem | 'separator'
  onClose: () => void
}): React.JSX.Element {
  const shortcutId = useId()
  if (item === 'separator') {
    return <div role="separator" className="mx-2 my-1 h-px bg-[var(--border-subtle)]" />
  }
  return (
    <button
      type="button"
      role="menuitem"
      aria-describedby={item.shortcut ? shortcutId : undefined}
      onClick={() => {
        onClose()
        item.run()
      }}
      className="menu-row-codex"
    >
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.checked ? <Check size={13} className="shrink-0" /> : null}
      {item.shortcut ? (
        <span
          id={shortcutId}
          className="shrink-0 text-[11.5px] tabular-nums text-[var(--text-faint)]"
        >
          {item.shortcut}
        </span>
      ) : null}
    </button>
  )
}

export function ApplicationMenuBar(): React.JSX.Element {
  const [open, setOpen] = useState<MenuId | null>(null)
  const [justOpened, setJustOpened] = useState(false)
  const barRef = useRef<HTMLDivElement>(null)
  const theme = useAppStore((state) => state.theme)
  const setTheme = useAppStore((state) => state.setTheme)
  const toast = useAppStore((state) => state.toast)
  const bottomPanelEnabled = useAppStore((state) => state.settings['app.bottomPanel'] !== false)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(null)
    }
    const onClickAway = (event: MouseEvent): void => {
      if (barRef.current && !barRef.current.contains(event.target as Node)) setOpen(null)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('mousedown', onClickAway)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('mousedown', onClickAway)
    }
  }, [open])

  const exec = (command: string): void => {
    document.execCommand(command)
  }

  const toggleTheme = (value: 'light' | 'dark' | 'system'): void => {
    setTheme(value)
    if (value === 'system') {
      toast({ level: 'info', title: 'Theme: theo hệ thống' })
    }
  }

  const menus: Record<MenuId, Array<MenuItem | 'separator'>> = {
    file: [
      {
        id: 'new-chat',
        label: 'New chat',
        shortcut: 'Ctrl N',
        run: () => void newSession(),
      },
      {
        id: 'open-project',
        label: 'Open project…',
        shortcut: 'Ctrl O',
        run: () => void openProject(),
      },
      'separator',
      {
        id: 'settings',
        label: 'Settings…',
        shortcut: 'Ctrl ,',
        run: () => useAppStore.getState().navigate({ name: 'settings' }),
      },
      'separator',
      {
        id: 'close',
        label: 'Close window',
        run: () => window.close(),
      },
    ],
    edit: [
      { id: 'undo', label: 'Undo', shortcut: 'Ctrl Z', run: () => exec('undo') },
      { id: 'redo', label: 'Redo', shortcut: 'Ctrl Shift Z', run: () => exec('redo') },
      'separator',
      { id: 'cut', label: 'Cut', shortcut: 'Ctrl X', run: () => exec('cut') },
      { id: 'copy', label: 'Copy', shortcut: 'Ctrl C', run: () => exec('copy') },
      { id: 'paste', label: 'Paste', shortcut: 'Ctrl V', run: () => exec('paste') },
      { id: 'select-all', label: 'Select all', shortcut: 'Ctrl A', run: () => exec('selectAll') },
    ],
    view: [
      {
        id: 'toggle-sidebar',
        label: 'Toggle sidebar',
        shortcut: 'Ctrl B',
        run: () => useAppStore.getState().toggleSidebar(),
      },
      {
        id: 'toggle-terminal',
        label: 'Toggle terminal',
        shortcut: 'Ctrl J',
        run: () => window.dispatchEvent(new CustomEvent('nexus:toggle-bottom-panel')),
      },
      {
        id: 'command-palette',
        label: 'Command palette',
        shortcut: 'Ctrl K',
        run: () => useAppStore.getState().setPaletteOpen(true),
      },
      'separator',
      { id: 'light', label: 'Light theme', checked: theme === 'light', run: () => toggleTheme('light') },
      { id: 'dark', label: 'Dark theme', checked: theme === 'dark', run: () => toggleTheme('dark') },
      {
        id: 'system',
        label: 'System theme',
        checked: theme === 'system',
        run: () => toggleTheme('system'),
      },
    ],
    help: [
      {
        id: 'shortcuts',
        label: 'Keyboard shortcuts',
        shortcut: 'Ctrl K',
        run: () => useAppStore.getState().setPaletteOpen(true),
      },
      {
        id: 'documentation',
        label: 'NEXUS documentation',
        run: () =>
          toast({ level: 'info', title: 'NEXUS documentation', body: 'README.md trong repo này.' }),
      },
      'separator',
      {
        id: 'about',
        label: 'About NEXUS',
        run: () =>
          toast({
            level: 'info',
            title: 'NEXUS Desktop',
            body: 'AI coding agent desktop — giao diện theo Codex desktop.',
          }),
      },
    ],
  }

  const trigger = (id: MenuId, label: string): React.JSX.Element => (
    <button
      key={id}
      type="button"
      className="app-menu-item no-drag"
      data-open={open === id}
      aria-haspopup="menu"
      aria-expanded={open === id}
      onClick={() => {
        setOpen((current) => (current === id ? null : id))
        setJustOpened(true)
      }}
      onMouseEnter={() => {
        if (open && open !== id) {
          setOpen(id)
          setJustOpened(false)
        }
      }}
    >
      {label}
    </button>
  )

  return (
    <div
      ref={barRef}
      role="menubar"
      aria-label="Application menu"
      className="drag-region flex h-9 shrink-0 items-center gap-0.5 border-b border-[var(--border-subtle)] bg-[var(--bg-titlebar)] px-1.5 text-[13px]"
    >
      <button
        type="button"
        aria-label="Toggle sidebar"
        onClick={() => useAppStore.getState().toggleSidebar()}
        className="no-drag icon-btn-sm"
      >
        <PanelLeft size={15} strokeWidth={1.7} />
      </button>
      <div className="no-drag relative flex items-center">
        {trigger('file', 'File')}
        {trigger('edit', 'Edit')}
        {trigger('view', 'View')}
        {trigger('help', 'Help')}
        {open ? (
          <div
            role="menu"
            aria-label={open}
            className="absolute left-0 top-full z-50 mt-1 w-[260px] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-elevated)] p-1.5 shadow-[var(--shadow-menu)]"
            data-just-opened={justOpened}
          >
            {menus[open].map((item, index) =>
              item === 'separator' ? (
                <Item key={`sep-${index}`} item="separator" onClose={() => setOpen(null)} />
              ) : (
                <Item key={item.id} item={item} onClose={() => setOpen(null)} />
              ),
            )}
          </div>
        ) : null}
      </div>
      <div className="min-w-0 flex-1" />
      <button
        type="button"
        aria-label="Search"
        title="Command palette"
        onClick={() => useAppStore.getState().setPaletteOpen(true)}
        className="no-drag icon-btn-sm"
      >
        <Search size={15} strokeWidth={1.7} />
      </button>
      {currentIconButton(theme, setTheme)}
      {bottomPanelEnabled ? (
        <button
          type="button"
          aria-label="Toggle terminal"
          onClick={() => window.dispatchEvent(new CustomEvent('nexus:toggle-bottom-panel'))}
          className="no-drag icon-btn-sm"
        >
          <SquareTerminal size={15} strokeWidth={1.7} />
        </button>
      ) : null}
    </div>
  )

  function currentIconButton(
    value: 'light' | 'dark' | 'system',
    setter: (theme: 'light' | 'dark' | 'system') => void,
  ): React.JSX.Element {
    const Icon = value === 'dark' ? Moon : value === 'system' ? Monitor : Sun
    const next = value === 'light' ? 'dark' : value === 'dark' ? 'system' : 'light'
    return (
      <button
        type="button"
        aria-label={`Theme: ${value}`}
        title={`Theme: ${value} — click to switch`}
        onClick={() => setter(next)}
        className="no-drag icon-btn-sm"
      >
        <Icon size={15} strokeWidth={1.7} />
      </button>
    )
  }
}

/** File/Edit icons dùng trong menu — chỉ để gợi ý, không thay đổi hành vi. */
export const menuBarIcons = { FolderOpen, FilePlus2, Settings, BookOpen, Command, Info }
