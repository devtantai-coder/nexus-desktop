# UI Design Spec

Direction: Claude Desktop minimalism × Codex Desktop workflow. Neutral, quiet, developer-dense,
desktop-native feeling. No SaaS dashboards, no gradients, no card soup, no heavy animation.

## Layout

```
┌─ TitleBar (drag region, workspace name, window controls) ───────────────────┐
├──────────────┬───────────────────────────────────────┬─────────────────────┤
│ Sidebar      │ Main workspace                        │ Inspector           │
│ 240–360px    │ Home / Chat / Coding workspace        │ 300–480px           │
│ collapsible  │                                       │ collapsible         │
├──────────────┴───────────────────────────────────────┴─────────────────────┤
│ Status bar: agent state · model · provider · git branch · tokens           │
└────────────────────────────────────────────────────────────────────────────┘
```

Panels resize by drag handles (min/max clamped) and persist width/collapsed state.

## Sidebar

Header: logo mark, workspace switcher, new task, search. Navigation: Home, Chats, Projects, Agents,
Code Sessions, History. Project area: recent/open projects. Bottom: Settings, Model Manager, profile.
Selected state = subtle filled background + left accent hairline; hover = 4% overlay; tooltips on
icon-only controls; context menus on sessions/projects.

## Home

Centered: wordmark, "What are we building today?", composer, six quick actions
(Open Project, Start Coding, Analyze Codebase, Fix Bugs, Refactor Project, Write Tests, Explain Code),
then a compact recent-activity list. No charts.

## Conversation

Single column, max ~760px. Messages are typographic blocks, not cards. Streaming text with a caret,
markdown + syntax highlighted code, copy button per block, expandable tool-call rows
(name, args summary, duration, status, output), message actions (retry, edit, copy, continue).
Reasoning shown in a collapsible "thinking" block.

## Composer

Auto-resizing multiline, send/stop, attach files, drag-drop, paste images, model selector, agent mode
selector (Ask/Plan/Code/Agent/Review/Debug), permission selector, context chips, shortcut hints.
Every control is wired to real behaviour; no inert buttons.

## Coding workspace

Center: task header (title, state, duration), execution plan checklist, agent timeline (steps, tool
calls, approvals), changed-files list with stats, final summary. Inspector tabs: Plan, Activity,
Changes (diff), Terminal, Context (token usage per section).

## Review / diff

File list with added/removed counts and status chips; inline and side-by-side Monaco diff; accept /
reject / revert per file and per hunk; open-in-editor; explicit "agent authored" badge.

## Settings

General, Appearance, Language, Models, Providers, API Keys, Agent, Permissions, Workspace, Terminal,
Git, Notifications, Shortcuts, Storage, About. Two-pane layout, instant apply, persisted.

## Tokens

| Token          | Light     | Dark      |
| -------------- | --------- | --------- |
| `--bg`         | `#FFFFFF` | `#191919` |
| `--bg-sidebar` | `#F8F8F6` | `#1D1D1D` |
| `--bg-surface` | `#F5F5F3` | `#242424` |
| `--text`       | `#242424` | `#EEEEEE` |
| `--text-muted` | `#777777` | `#999999` |
| `--border`     | `#E8E8E5` | `#333333` |
| `--accent`     | `#303030` | `#E5E5E5` |

Status colors are desaturated (success/warn/danger) and never used as large fills. Accent color is
user-customizable; font size (13–16px base) and density (compact/comfortable) are settings.

## Typography

Inter / Geist / system-ui stack; JetBrains Mono for code and terminal. Scale: 11 (meta), 12 (label),
13 (body-small), 14 (body), 16 (section), 20 (title), 28 (display). Vietnamese diacritics must render
correctly at every size — no condensed replacement fonts.

## Motion

150–200 ms ease-out for panels, 8 px fade/slide for overlays. No springy or looping animations.
Streaming text and the agent timeline are the only continuously moving elements.

## Accessibility

Visible keyboard focus rings, ARIA labels on icon buttons, keyboard-navigable menus, contrast ≥ 4.5:1
for body text, reduced-motion support, resizable panels with keyboard fallback.
