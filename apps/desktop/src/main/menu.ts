import { Menu, app, shell, type MenuItemConstructorOptions } from 'electron'
import type { EventBus } from '@nexus/shared'

export function installMenu(events: EventBus, isDev: boolean): void {
  const isMac = process.platform === 'darwin'
  const command = (name: string) => () =>
    events.emit({ type: 'app.command', payload: { command: name } })

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.getName(),
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { label: 'Settings…', accelerator: 'Cmd+,', click: command('settings') },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Task', accelerator: 'CmdOrCtrl+N', click: command('new-task') },
        { label: 'Open Project…', accelerator: 'CmdOrCtrl+O', click: command('open-project') },
        { type: 'separator' },
        { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: command('settings') },
        ...(isMac ? [] : [{ type: 'separator' as const }, { role: 'quit' as const }]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Search', accelerator: 'CmdOrCtrl+K', click: command('search') },
        { label: 'Command Palette', accelerator: 'CmdOrCtrl+Shift+P', click: command('palette') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+B', click: command('toggle-sidebar') },
        {
          label: 'Toggle Inspector',
          accelerator: 'CmdOrCtrl+Shift+B',
          click: command('toggle-inspector'),
        },
        { label: 'Toggle Terminal', accelerator: 'CmdOrCtrl+J', click: command('toggle-terminal') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools', visible: isDev },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Documentation', click: () => void shell.openExternal('https://kilo.ai/docs') },
        { label: 'Open Main Log', click: command('open-logs') },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
