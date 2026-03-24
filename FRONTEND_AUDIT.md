# GhostLink Frontend Audit Report

**Date:** March 24, 2026
**Auditor:** Comprehensive frontend review — every component, style, animation, and interaction pattern
**Scope:** All 48 frontend source files across components, hooks, stores, and utilities
**Stack:** React 19 + TypeScript 5.9 + Tailwind CSS 4 + Zustand 5 + Framer Motion 11 + Vite 8

---

## 1. Architecture Overview

### Tech Stack
- **Framework:** React 19.2 with TypeScript 5.9
- **Styling:** Tailwind CSS 4.2 (via `@tailwindcss/vite`) + custom CSS properties + `color-mix()` functions
- **State:** Zustand 5 — single store (`chatStore.ts`) managing all app state
- **Animations:** Framer Motion 11.18 (installed but underutilized)
- **Markdown:** react-markdown 10 + remark-gfm + rehype-highlight
- **Virtualization:** @tanstack/react-virtual (installed but NOT used — manual slicing instead)
- **WebSocket:** Custom implementation (`lib/ws.ts`)
- **Build:** Vite 8 with React plugin

### File Structure (48 files)
- `src/App.tsx` — Main app shell with ChatFeed, ThinkingBubbles, RightPanel, MobilePanel
- `src/components/` — 44 components covering chat, agents, settings, modals, cards
- `src/hooks/` — 2 hooks (useWebSocket, useMentionAutocomplete)
- `src/stores/` — 1 Zustand store (chatStore.ts)
- `src/lib/` — 4 utility modules (api, ws, sounds, timeago)
- `src/types/` — 1 type definition file

---

## 2. Page & Layout Structure

### Desktop Layout
The app uses a fixed sidebar + main content layout:
- **Left rail** (56px/`w-14`): Fixed icon navigation — logo, chat, jobs, rules, settings, search, help, user avatar
- **Expandable channel panel** (200px): Slides out from rail on logo click — shows channels list + agent hierarchy
- **Main area**: Flexes with `lg:ml-14`, shrinks when right panel opens (`lg:mr-80`)
- **Right panel** (320px/`w-80`): Slides in for Jobs/Rules/Settings as fixed `glass-strong` overlay
- **Stats sidebar** (224px/`w-56`): Optional, shows on `xl:` screens when no right panel

### Mobile Layout
- **Fixed header** (56px/`h-14`): Hamburger menu + channel name + agent status dots
- **Mobile sidebar**: Full-screen overlay drawer for navigation
- **Mobile panels**: Full-screen overlay for Jobs/Rules/Settings with backdrop blur
- **Safe area support**: `env(safe-area-inset-*)` for notch devices

### Navigation Flow
1. Sidebar rail icons toggle between chat view and panels
2. Channel panel overlays on logo click, dismisses on outside click
3. Right panels have click-away backdrop for dismissal
4. `Ctrl+K` opens universal search modal
5. `Ctrl+1-9` switches channels, `Alt+Up/Down` cycles channels
6. `Escape` cascades: select mode → search → shortcuts → panels

---

## 3. Design System & Visual Language

### Color Palette
The app uses Material Design 3-inspired semantic tokens defined via CSS `@theme`:

**Dark mode (default):**
- Surface: `#08080f` (near-black with blue undertone)
- Surface container hierarchy: `#060609` → `#0d0d15` → `#111119` → `#1a1a26` → `#222230`
- Primary: `#a78bfa` (soft purple/violet)
- Secondary: `#38bdf8` (sky blue)
- Tertiary: `#fb923c` (warm orange)
- On-surface: `#e0dff0` (cool white)
- Outline: `#6e6980` / `#3a3548`
- Error: `#fca5a5`

**Light mode:**
- Surface: `#f5f5fa`
- Primary shifts to `#6d28d9` (deeper purple)
- Full variable overrides via `[data-theme="light"]`

**Theme presets (7 additional):**
- Cyberpunk — `#ff00ff`/`#00ffff`, sharp 4px radii, scanline ambient, reduced animation
- Terminal — `#00ff41`, monospace everything, 0px radii, CRT scanline bg
- Ocean — `#22d3ee`/`#34d399`, 20px radii, floaty slow animations
- Sunset — `#f97316`/`#e11d48`, warm gradient ambients
- Midnight, Rose Gold, Arctic (defined in types but not fully in CSS)

### Typography
- **Primary font:** Inter (300–900 weights from Google Fonts)
- **Mono font:** JetBrains Mono (referenced but not loaded from Google Fonts — potential issue)
- **Base size:** Adjustable via settings (`fontSize` applied to `documentElement`)
- **Scale:** Heavy use of `text-[10px]`, `text-[11px]`, `text-[12px]`, `text-xs`, `text-sm` — the app trends very small

### Spacing
- Consistent use of Tailwind spacing: `gap-1.5`, `gap-2`, `gap-3`, `px-3.5`, `py-2.5`
- Chat messages: `py-1.5` between messages, `px-4 lg:px-6` horizontal padding
- Cards/panels: `p-3` to `p-5` internal padding
- Good use of `min-w-0` and `truncate` for overflow handling

---

## 4. Current Animation & Motion

### What Exists (Good)

**CSS Keyframe Animations:**
- `ambient-drift` — 30s floating gradient background (elegant)
- `msg-slide-in` — Messages enter with translateY(12px) + scale(0.97) + blur(4px) → 0.35s ease
- `panel-slide-in` — Sidebar panels slide from right with translateX(20px)
- `panel-fade-in` — Scale(0.94) + blur(8px) entrance for modals
- `modal-enter` — Scale(0.92) + translateY(8px) + blur(8px) → 0.3s
- `agent-spin` — Conic gradient border rotation for thinking agents (with Firefox fallback)
- `thinking-pulse` — Pulsing box-shadow glow on thinking agent chips
- `tab-indicator` — scaleX(0→1) underline animation on active channel
- `stagger-in` — Defined but not explicitly used via CSS class

**Framer Motion Usage:**
- `ChatMessage` — `initial={{ opacity: 0, y: 10 }}` → `animate={{ opacity: 1, y: 0 }}` (basic)
- `EmptyState` — Scale 0.95→1 fade in
- `Skeleton` — Opacity pulse [0.3, 0.6, 0.3] at 1.5s
- `Toast` — Spring entrance (stiffness: 400, damping: 30) with exit to x:100

**CSS Transitions:**
- Global `button, a` transitions at 0.2s
- `button:active { transform: scale(0.97) }` — subtle press feedback
- Input focus: `box-shadow: 0 0 0 2px rgba(167, 139, 250, 0.15)`
- `.interactive-item:hover` — translateX(2px) slide
- `.bubble-glow:hover` — translateY(-1px) + box-shadow expansion
- `.liquid-glass:hover` — translateY(-2px) + scale(1.005) + border glow

### What's Missing (Needs Work)

1. **No page transition animations** — Switching channels, opening panels is instant
2. **No AnimatePresence on modals** — Modals snap-open via CSS, no exit animations
3. **No list stagger** — Messages, jobs, rules all appear simultaneously
4. **No skeleton loading states used in practice** — Skeleton components exist but are never imported
5. **Agent chip state transitions** — Online/offline/thinking transitions are instant
6. **No scroll-linked animations** — No parallax, no header shrink, no reveal effects
7. **No spring physics** — Only Toast uses springs; everything else uses ease/ease-out
8. **No gesture support** — No swipe-to-dismiss, drag-to-reorder, or pull-to-refresh
9. **Framer Motion `AnimatePresence` only on Toast** — Not used for modals, panels, or messages

---

## 5. Component-by-Component Audit

### Chat System

**ChatMessage.tsx** — Core message component
- **Good:** Differentiated user (right, blue tint) vs agent (left, agent-colored) layout. Markdown rendering with GFM. Reaction picker. Pin/bookmark/reply actions. Message collapse for long text (600+ chars). @mention highlighting with colored pills. URL previews inline. Inline editing via double-click.
- **Bad:** Framer Motion is imported but the animation is trivially simple (opacity+y). No exit animation. No message grouping by sender (every message gets full avatar+name). Actions bar uses `opacity-0 → group-hover:opacity-100` which is invisible on touch devices. `_agentColorMap` is a module-level mutable variable updated via `useMemo` side effect — React anti-pattern.
- **Missing:** No streaming text animation (characters appear all at once). No code block syntax highlighting (rehype-highlight is in dependencies but code blocks just render plain text with line numbers). No image lightbox. No link hover previews. No message timestamp on hover. No thread/reply UI beyond "replying to #id".

**MessageInput.tsx** — Input composition area
- **Good:** Slash command autocomplete with descriptions. @mention autocomplete dropdown. Voice input via Web Speech API. Drag-and-drop file upload with visual dropzone. Command history with Up/Down arrows. Reply-to banner with dismiss. Textarea auto-resize. Image paste from clipboard.
- **Bad:** The component is ~350 lines and handles too many concerns (commands, voice, file upload, mentions, history). Slash command filtering happens in the component body, not memoized. The mention dropdown positioning may clip at edges. No character count or token estimation in the input.
- **Missing:** No rich text formatting toolbar. No emoji picker (only reactions have emojis). No markdown preview toggle. No AI-assisted autocomplete/suggestions.

**CodeBlock.tsx** — Code rendering
- **Good:** Language label header. Copy button with feedback. Line numbers.
- **Bad:** No syntax highlighting — code renders as plain monochrome text despite `rehype-highlight` being a dependency. No line wrapping toggle. No file name display.
- **Missing:** No diff view support. No collapsible long code blocks. No "Run" or "Apply" buttons like Cursor/ChatGPT have.

**TypingIndicator.tsx** — Agent typing status
- **Good:** Per-channel awareness. Multiple agent names combined ("X and Y are typing").
- **Bad:** The three bouncing dots are tiny (1px) and use Tailwind's `animate-bounce` which is too aggressive for this context. Polls every 500ms via `setInterval` — should use state-driven rendering.

### Agent System

**AgentBar.tsx** — Top agent chip strip
- **Good:** Rich chip design with agent-colored borders, status dots, thinking glow animation, role badges (MGR/WKR/PEER). Quick action button (stop/launch/resume) on hover. Clicking opens detailed info panel.
- **Bad:** Horizontal overflow scroll has no visible scrollbar or scroll indicators. No drag-to-reorder. No grouping of manager+workers visually.

**AgentIcon.tsx** — SVG agent avatars
- **Good:** Custom SVG icons per provider (Claude sunburst, Codex hexagonal flower, Gemini 4-point star, Grok angular X). Default sparkle icon for unknown agents.
- **Bad:** Only 4 custom icons — the other 6+ agents (Copilot, Aider, Goose, OpenCode, Ollama) all get the generic default. Icons are simple flat SVGs with no gradient, shadow, or depth.
- **Missing:** No animated icons (thinking, processing states). No provider logo integration.

**AgentInfoPanel.tsx** — Agent detail modal
- **Good:** Three-tab layout (Info, Context, Skills). Context tab shows token usage bar, session stats grid, estimated cost, SOUL identity editor, working notes. Color bar accent at top. Rich info rows with icons. Response mode selector (4 modes). Hierarchy display (reports-to / workers list).
- **Bad:** Very information-dense — feels like a debug panel rather than a polished product UI. The 4-metric grid is functional but visually flat. No chart/sparkline for activity over time.
- **Missing:** No activity graph. No conversation history preview. No performance metrics (response time, error rate).

**AddAgentModal.tsx** — Agent launcher
- **Good:** Template grid selection with icons. Model selection per provider. Permission preset system with descriptions. Workspace folder picker. Role presets (Code Reviewer, PM, DevOps, etc.) in collapsible `<details>`. Persistent agent toggle.
- **Bad:** The modal can get very tall with all sections expanded. Advanced options in nested `<details>` is functional but not visually exciting. Loading state during spawn is just a spinner + text.
- **Missing:** No preview of what the agent will look like. No "test connection" before launch. No cost estimate before launch.

### Panels

**SettingsPanel.tsx** — Configuration
- **Good:** 7 tabbed sections (General, Look, Agents, AI Providers, Bridges, Security, Advanced). Auto-save after 2s of no changes. Instant-apply for toggles/theme. Theme preview grid with color swatches. Notification sound per agent with preview. Font size slider. Stats panel section toggles.
- **Bad:** Tab bar is very cramped at 7 items (each ~45px). The "saved" confirmation is a tiny green text that disappears quickly. Theme swatches are small and don't show enough preview.
- **Missing:** No settings search. No "reset to defaults" option. No import/export of settings.

**JobsPanel.tsx** — Kanban task board
- **Good:** Three-column kanban (To Do, Active, Closed). Drag-and-drop between columns with visual hover feedback. Priority color-coding via left border. Assignee avatar. Create form with Enter-to-submit.
- **Bad:** Cards are text-only — no tags, no due dates, no progress indicators. The panel is only 320px wide (right sidebar) which makes kanban columns extremely narrow. No card detail view.

**RulesPanel.tsx** — Governance rules
- **Good:** Three-section layout (Active, Drafts, Archived). Drag-and-drop between sections. Max 10 active rules warning. Similar visual language to Jobs.
- **Bad:** Rules are plain text with no rich formatting. No voting/approval mechanism in the UI.

**StatsPanel.tsx** — Session metrics sidebar
- **Good:** Four card sections (Session, Token Usage, Agents, Activity). Per-sender activity bars. Token/cost estimation. Agent status with role badges.
- **Bad:** All metrics are simple text — no charts, no sparklines, no trend indicators. Only visible on `xl:` screens (1280px+). The stat values use raw numbers without formatting (no thousand separators).

### Modals & Overlays

**SearchModal.tsx** — Universal search (Ctrl+K)
- **Good:** Multi-mode: `/` commands, `@` agents, `#` channels, free text search. Keyboard navigation (Up/Down/Enter/Escape). Mode badge indicator. Search result highlighting. Agent color coding in results.
- **Bad:** No recent searches. No search history. Results appear after 300ms debounce which feels sluggish for command palette. No fuzzy matching.
- **Missing:** Should have a "recent" section like VS Code's command palette.

**OnboardingTour.tsx** — First-run guide
- **Good:** 6-step guided tour with step indicator bar. Positioned tooltips. Skip option. localStorage persistence.
- **Bad:** All steps are center/corner positioned — no element highlighting or spotlight effect. Steps don't point to actual UI elements. No animation between steps.

**KeyboardShortcutsModal.tsx** — Shortcut reference
- (Not fully read but referenced as simple modal listing shortcuts)

### Utility Components

**Toast.tsx** — Notification toasts
- **Good:** Framer Motion spring animations. AnimatePresence for smooth exit. Four types with distinct colors. Auto-dismiss after 4s.
- **Bad:** Toast is defined as a module-level function (`_addToast`) which is a React anti-pattern. Toast container is defined but never actually rendered in App.tsx.

**Skeleton.tsx** — Loading placeholders
- **Good:** Three variants (Message, Agent, Channel). Framer Motion opacity pulse.
- **Bad:** Never actually used anywhere in the app. Uses `var(--bg-tertiary)` which isn't defined in the theme.

**EmptyState.tsx** — Empty data placeholder
- **Good:** Framer Motion entrance. Action button option.
- **Bad:** Uses `var(--text-primary)` and `var(--text-muted)` which aren't defined. Only used in ConversationStarters indirectly.

**ConnectionBanner.tsx** — Offline indicator
- **Good:** Fixed top banner with clear messaging. Two states (disconnected/reconnecting).
- **Bad:** No reconnection progress indicator. No retry button. Covers the top of the page abruptly.

---

## 6. Glass Morphism & Surface System

The app implements a comprehensive glass morphism system, which is its strongest visual feature:

**`.glass`** — Header bars: `backdrop-filter: blur(24px) saturate(1.4)` with subtle inner glow
**`.glass-strong`** — Modals/panels: `blur(32px) saturate(1.5)` with multi-layer box-shadow
**`.liquid-glass`** — Interactive cards: Complex multi-stop gradient with hover lift + glow expansion
**`.glass-card`** — Settings/static cards: Heavy blur with inset highlights

This system is well-executed and creates genuine depth. The `color-mix()` usage for agent-themed chip colors is sophisticated and modern.

---

## 7. Responsive Design Assessment

### Good
- Mobile-first breakpoints: `max-lg:` for mobile-only, `lg:` for desktop
- Safe area support for notch devices
- Touch-friendly mobile header with hamburger drawer
- Full-screen panel overlays on mobile
- Prose max-width constraints for code blocks on mobile

### Bad
- Agent bar overflow on desktop has no scroll indicators
- Settings tab bar with 7 items doesn't adapt for narrow right panel
- Stats panel disappears entirely below `xl:` (1280px) — no compact version
- Channel tabs don't wrap or show overflow indicator
- SplitView is not responsive — two columns on any screen size

---

## 8. Accessibility Audit

### Good
- `role="main"` and `aria-label="Chat area"` on main element
- `lang="en"` on HTML root
- Semantic header/main structure
- Keyboard shortcuts with modifier keys

### Critical Issues
- **No ARIA labels on icon buttons** — Sidebar nav icons, message actions, close buttons all lack `aria-label`
- **No skip-to-content link**
- **No focus management** — Opening modals doesn't trap focus; closing doesn't return focus
- **Color contrast** — Many text elements at `/30` and `/40` opacity fail WCAG AA (e.g., `text-on-surface-variant/30` = ~2.5:1 ratio)
- **No `aria-live` regions** — New messages, typing indicators, connection status changes are invisible to screen readers
- **Material Symbols icons have no text alternatives** — `<span className="material-symbols-outlined">chat_bubble</span>` is meaningless to assistive tech
- **Hover-only interactions** — Message actions only appear on hover, invisible to keyboard and touch users
- **No reduced-motion support** — `prefers-reduced-motion` is never checked

---

## 9. Competitive Comparison

### vs ChatGPT
| Feature | ChatGPT | GhostLink | Gap |
|---------|---------|-----------|-----|
| Streaming text | Character-by-character with cursor | All-at-once | **Critical** |
| Code blocks | Syntax highlighted + Copy + Run | Plain text + Copy + Line numbers | **High** |
| Message entrance | Smooth fade-slide | Basic opacity+y (0.2s) | **Medium** |
| Sidebar | Clean conversation list | Channel/agent hybrid | Different paradigm |
| Empty state | Suggestion chips + branding | Conversation starters (good) | **Comparable** |
| Loading | Skeleton + shimmer | None used | **High** |
| Dark mode | Single polished theme | 9 themes (impressive) | **GhostLink wins** |

### vs Claude.ai
| Feature | Claude.ai | GhostLink | Gap |
|---------|-----------|-----------|-----|
| Thinking indicator | Expandable thinking block | Thinking stream preview (good) | **Comparable** |
| Artifacts | Interactive rendered outputs | GenerativeCard (tables, metrics, etc.) | **Comparable concept** |
| File handling | Drag-drop with preview | Drag-drop with upload | **Close** |
| Polish level | High — consistent spacing, animations | Medium — good bones, inconsistent polish | **Medium** |
| Typography | Clean, well-spaced | Too small (10-11px everywhere) | **Medium** |

### vs Cursor
| Feature | Cursor | GhostLink | Gap |
|---------|--------|-----------|-----|
| Terminal integration | Built-in terminal tabs | TerminalPeek modal (polling) | **Medium** |
| Code actions | Apply, Accept, Reject inline | None | **High** |
| File tree | Full file explorer | No file view | Different product |
| Diff view | Inline diff rendering | None | **High** |
| Agent status | Minimal | Rich chips with thinking animation | **GhostLink wins** |

### vs Slack/Discord (chat UX)
| Feature | Slack/Discord | GhostLink | Gap |
|---------|--------------|-----------|-----|
| Message grouping | Same-sender grouping | Every message separate | **Medium** |
| Thread UI | Full thread sidebar | "replying to #id" text only | **High** |
| Reactions | Inline reaction bar | Inline reaction bar | **Comparable** |
| Search | Full-featured | Basic text search | **Medium** |
| Channels | Rich with topics, pins | Basic name + unread count | **Medium** |

---

## 10. What Looks Flat, Boring, or Unpolished

1. **Code blocks are lifeless** — No syntax highlighting makes code look like a gray blob. This is the #1 visual disappointment in a developer-facing product.

2. **Stats panel is a wall of text** — Numbers without any visual representation. No mini charts, sparklines, or even colored progress indicators beyond the token bar.

3. **Message rendering is monotonous** — Every message has identical visual weight. No grouping, no date separators, no visual breathing room between conversation segments.

4. **Settings panel feels like a debug console** — Functional but not delightful. The 7-tab bar is cramped. The theme picker could be a stunning visual showcase but is just small color swatches.

5. **Jobs/Rules panels are too minimal** — 320px kanban board doesn't do justice to the feature. Cards are plain text blocks.

6. **Empty states are underused** — The Skeleton and EmptyState components exist but are never rendered. Loading is either a basic spinner or nothing.

7. **No micro-interactions on buttons** — Beyond `scale(0.97)` on active, buttons have no hover glow, no ripple, no icon animation.

8. **Font sizes are too small everywhere** — Heavy reliance on 10-11px text makes the app feel cramped and hard to read. Labels at `text-[9px]` are nearly illegible.

---

## 11. Specific Animation & Effect Recommendations

### Critical Priority

**1. Streaming Text Animation**
Add character-by-character or word-by-word text reveal for agent messages. This is the single most impactful change for perceived quality. ChatGPT, Claude, and every modern AI chat does this.

**2. Syntax Highlighting in Code Blocks**
`rehype-highlight` is already in `package.json`. Wire it up properly with a theme (e.g., `github-dark`). Add a highlight.js CSS theme import.

**3. AnimatePresence on All Modals/Panels**
Wrap SearchModal, AddAgentModal, AgentInfoPanel, SettingsPanel, HelpPanel, and SessionLauncher with Framer Motion `AnimatePresence` for smooth exit animations.

**4. Message List Stagger**
When switching channels, stagger message entrance with increasing delay (each message 30-50ms after the previous). Use Framer Motion `variants` with `staggerChildren`.

### High Priority

**5. Scroll-to-Bottom Button Enhancement**
The current purple pill is good. Add a count badge animation (scale spring when count changes). Add a subtle floating animation (gentle translateY oscillation).

**6. Agent Chip State Transitions**
Animate the status dot color change. Add a brief "particle burst" or "ripple" when an agent goes from offline to online. Animate the thinking glow ramp-up.

**7. Skeleton Loading States**
Actually use the existing Skeleton components. Show MessageSkeleton while fetching channel messages. Show AgentSkeleton during initial load.

**8. Typing Indicator Redesign**
Replace the tiny bouncing dots with a proper animated indicator — a smooth wave or morphing dots animation. Make it larger and more visible.

**9. Message Grouping**
Group consecutive messages from the same sender. Only show avatar + name on first message. Show timestamps on the group, not each message.

### Medium Priority

**10. Tab/Channel Switch Transition**
Add a subtle crossfade or slide when switching channels. The current instant switch is jarring.

**11. Sidebar Panel Slide Animation**
The right panel should slide in from the right with spring physics, not just appear. The left channel panel already has `panel-slide-in` but could use more polish.

**12. Button Hover Effects**
Add subtle glow or gradient shift on primary action buttons. The "Launch Agent" button should feel exciting — add a gradient animation or shimmer.

**13. Card Hover Micro-Interactions**
Job cards, rule cards, and agent chips should have more sophisticated hover states. The `liquid-glass` class is great — apply it more broadly.

**14. Toast/Notification Entrance**
The Toast system has good spring animation but is never rendered. Add the `<ToastContainer />` to App.tsx and use it.

**15. Ambient Particle Effect**
Add subtle floating particles in the background (tiny dots drifting slowly). This would complement the existing `ambient-bg` gradient mesh beautifully.

### Nice-to-Have

**16. Theme Transition Animation**
When switching themes, animate the color transition instead of instant swap. CSS `transition` on custom properties or a brief crossfade overlay.

**17. Onboarding Tour Spotlight**
Add a spotlight/cutout effect that highlights the actual UI element each tour step references.

**18. Pull-to-Refresh on Mobile**
Standard mobile pattern for refreshing the chat feed.

**19. Swipe Gestures**
Swipe right to open sidebar on mobile. Swipe left on messages to reveal actions.

**20. Cursor Trail / Glow Effect**
For the Cyberpunk theme specifically, add a subtle cursor glow trail effect.

---

## 12. Technical Debt & Code Quality Notes

1. **`_agentColorMap` module-level mutation** — ChatMessage.tsx uses a module-level `let` variable updated via `useMemo` side effect. Should be a context or store value.

2. **@tanstack/react-virtual installed but unused** — The app manually slices messages at 200 (VIRTUALIZE_THRESHOLD) instead of using proper virtual scrolling. This means the "virtual" experience is just showing the latest 200 messages.

3. **Skeleton/EmptyState/Toast components unused** — Three well-built components that are never imported. `var(--bg-tertiary)` and `var(--text-muted)` referenced in them don't exist in the theme.

4. **Theme CSS is massive** — index.css is 700+ lines, mostly theme overrides. Each theme requires ~30 lines of `[data-theme="X"]` selectors. Consider CSS custom property inheritance instead of selector overrides.

5. **Inconsistent opacity patterns** — Some components use Tailwind's `/30` opacity syntax, others use `rgba()`, others use `color-mix()`. The glass system uses `rgba()` while agent chips use `color-mix()`.

6. **JetBrains Mono not loaded** — Referenced as `--font-mono` but no Google Fonts link for it in index.html. Only `Inter` is loaded.

7. **No error boundaries on individual components** — Only one ErrorBoundary wrapping the entire app. A failed ChatMessage could blank the whole UI.

8. **Large components** — MessageInput.tsx (~350 lines), SettingsPanel.tsx (~800+ lines), AgentInfoPanel.tsx (~480 lines) should be broken into smaller sub-components.

---

## 13. Summary Scorecard

| Category | Score | Notes |
|----------|-------|-------|
| **Layout & Structure** | 8/10 | Solid responsive layout, good sidebar pattern |
| **Color & Theming** | 9/10 | Excellent theme system, 9 themes, sophisticated color-mix usage |
| **Typography** | 5/10 | Font sizes too small, mono font not loaded, limited hierarchy |
| **Glass Morphism** | 9/10 | Best-in-class glass system with multiple tiers |
| **Animations** | 4/10 | Good CSS foundations but Framer Motion severely underutilized |
| **Chat UX** | 6/10 | Functional but lacks streaming, grouping, and polish |
| **Agent UI** | 8/10 | Rich chips, thinking states, info panel — strongest feature area |
| **Code Rendering** | 3/10 | No syntax highlighting despite having the library installed |
| **Loading/Empty States** | 2/10 | Components exist but are never used |
| **Accessibility** | 3/10 | Missing ARIA labels, focus management, contrast, screen reader support |
| **Mobile** | 6/10 | Works but no gestures, no pull-to-refresh, limited interactions |
| **Overall Polish** | 6/10 | Strong foundations, needs animation/interaction layer to feel premium |

### The Verdict
GhostLink has **exceptional design bones** — the color system, glass morphism, theme variety, and agent chip design are genuinely impressive. The gap between GhostLink and apps like Claude/ChatGPT is primarily in the **animation and interaction layer**: streaming text, exit animations, loading states, and micro-interactions. The codebase already has Framer Motion installed and animation-ready CSS — it just needs to be activated. Fixing code block highlighting, adding streaming text, and implementing AnimatePresence on modals/panels would cover 70% of the visual gap with relatively modest effort.
