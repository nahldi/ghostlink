# GhostLink Animation & Frontend (GAF) Roadmap

> **Generated:** March 24, 2026
> **Scope:** Frontend-only visual polish, animations, micro-interactions, accessibility
> **Rule:** NO code edits — this is the test plan and phased roadmap only
> **Existing roadmaps:** `ROADMAP.md` and `V2.5_BUGFIX_ROADMAP.md` are untouched; this file is standalone

---

## Table of Contents

1. [Audit Corrections](#audit-corrections)
2. [Phase 0 — Critical Fixes (P0)](#phase-0--critical-fixes-p0)
3. [Phase 1 — Core Animation Layer (P1)](#phase-1--core-animation-layer-p1)
4. [Phase 2 — Component Micro-Interactions (P2)](#phase-2--component-micro-interactions-p2)
5. [Phase 3 — Premium Effects & Polish (P3)](#phase-3--premium-effects--polish-p3)
6. [Phase 4 — Mobile & Responsive (P4)](#phase-4--mobile--responsive-p4)
7. [Dependency Map](#dependency-map)

---

## Audit Corrections

Items from the initial audit that were found to already exist on re-verification:

| Finding | Status | Evidence |
|---------|--------|----------|
| `prefers-reduced-motion` missing | **FALSE — Already exists** | `index.css:1033` — full `@media (prefers-reduced-motion: reduce)` block nullifies all animations/transitions |
| `focus-visible` missing | **FALSE — Already exists** | `index.css:1003` — `*:focus-visible` rule with 2px purple outline and offset |
| `@tanstack/react-virtual` unused | **TRUE** — imported in package.json but `VIRTUALIZE_THRESHOLD` in `App.tsx` uses manual `.slice()` instead of the library |
| `stagger-in` keyframe unused | **TRUE** — defined in CSS but no class references it |
| `float-in` keyframe unused | **TRUE** — defined in CSS but no class references it |
| `bubble-glow` class unused | **TRUE** — defined in CSS but not applied to any component |

---

## Phase 0 — Critical Fixes (P0)

### P0-1: Add Syntax Highlighting to CodeBlock

**Impact:** CRITICAL — every code block in the app renders as monochrome plain text despite `rehype-highlight` being installed

#### Fail Test
1. Open GhostLink, send a message containing a fenced code block: ` ```javascript\nconsole.log("hello");\n``` `
2. Inspect the rendered code in the DOM
3. **Expected (failing):** All text is a single color (`text-on-surface-variant`), no `<span class="hljs-...">` wrappers
4. **Verify in:** `CodeBlock.tsx:48-54` — `code.split('\n').map(...)` renders raw strings with no highlighting pass
5. **Root cause:** `CodeBlock.tsx` receives pre-extracted code from `ChatMessage.tsx`'s `MdCode` component and renders it as plain text. The `rehype-highlight` plugin is in `package.json` but NOT in the `ReactMarkdown` component's `rehypePlugins` array in `ChatMessage.tsx`

#### Fix Test — Approach Comparison

| Approach | Pros | Cons | Winner? |
|----------|------|------|---------|
| A: Add `rehype-highlight` to `ReactMarkdown rehypePlugins` in `ChatMessage.tsx` | One-line fix, uses installed dep, auto-detects language | Requires `highlight.js` CSS theme import; code still routed through `CodeBlock` which strips hljs classes | |
| B: Use `highlight.js` directly inside `CodeBlock.tsx` | Full control over theme, per-line rendering preserved | Manual integration, need to import hljs + register languages | |
| C: Replace `CodeBlock` internals with `rehype-highlight` output AND import a dark hljs theme | Combines both: ReactMarkdown does the highlighting, CodeBlock just wraps it | Need to adjust `MdCode` to pass `className` through so hljs classes survive | **YES** |

**Chosen fix (C):**
1. In `ChatMessage.tsx`, add `rehype-highlight` to the `ReactMarkdown` rehypePlugins array: `rehypePlugins={[rehypeHighlight]}`
2. In `ChatMessage.tsx`'s `MdCode` function, when `match` is found, pass the `className` (which now contains hljs classes) through to `CodeBlock`
3. In `CodeBlock.tsx`, render `dangerouslySetInnerHTML` for the highlighted code OR accept pre-highlighted children
4. Import a highlight.js dark theme CSS file (e.g., `github-dark` or `atom-one-dark`) in `index.css` or `main.tsx`

**Why C wins:** It leverages the already-installed dependency, gives proper language detection from markdown fence tags, and only requires changes in 2 files.

#### Smoke Test
1. Send messages with code blocks in: JavaScript, Python, TypeScript, HTML, CSS, bash, JSON
2. Verify each renders with colored syntax tokens (keywords, strings, comments in different colors)
3. Verify line numbers still display correctly alongside highlighted code
4. Verify "Copy" button still copies the raw text (not HTML markup)
5. Verify code blocks inside agent messages AND user messages both highlight
6. Verify the highlight theme respects each of the 9 app themes (or at minimum doesn't clash)
7. Verify `prefers-reduced-motion` doesn't break highlighting (highlighting is not an animation)

#### Verify — Compatibility
- `rehype-highlight@7.0.2` is already in `package.json` — no new dependency
- `ReactMarkdown` already accepts `rehypePlugins` (it uses `remarkGfm` this way)
- The `.hljs` class override in `index.css:377` already sets `background: transparent !important` — this confirms highlight.js was planned but never wired up
- **No conflict** with existing `MdCode` or `CodeBlock` — they just need to pass classes through

---

### P0-2: Wire Up Unused CSS Animations

**Impact:** Medium — three animations are defined but never used, wasting CSS and missing polish opportunities

#### Fail Test
1. Search codebase for `stagger-in` class usage: `grep -r "stagger-in" frontend/src/components/` → 0 results
2. Search for `float-in`: `grep -r "float-in" frontend/src/components/` → 0 results
3. Search for `bubble-glow`: `grep -r "bubble-glow" frontend/src/components/` → 0 results
4. These are defined in `index.css:224-228`, `index.css:212-215`, and `index.css:291-298` respectively

#### Fix Test
- `stagger-in` → Apply to list items in: `SearchModal.tsx` results, `JobsPanel.tsx` job cards, `RulesPanel.tsx` rule cards, `ActivityTimeline.tsx` events (using `animation-delay` with `calc(var(--i) * 0.05s)`)
- `float-in` → Apply to: `ConversationStarters` buttons in `App.tsx`, `EmptyState` content
- `bubble-glow` → Apply to: `ChatMessage` agent message bubbles on hover (add `bubble-glow` class to the message container div)

**Why CSS-first:** These animations already exist and are tested in the CSS. Applying them is a className addition, not new animation code. This is the lowest-risk improvement.

#### Smoke Test
1. Open SearchModal (Ctrl+K), type a query → results should stagger in with slight delays
2. Open an empty channel → ConversationStarter buttons should float in
3. Hover over an agent message bubble → should get subtle glow + lift effect
4. Verify animations respect `prefers-reduced-motion` (they will, because the global `@media` rule catches `*`)

#### Verify
- No new CSS required — only `className` additions in TSX files
- `prefers-reduced-motion` block at line 1033 already covers `animation-duration` and `transition-duration` on `*`
- No Framer Motion conflicts — these are pure CSS animations on elements that don't currently use Framer Motion

---

### P0-3: Connect `@tanstack/react-virtual` or Remove It

**Impact:** Low-medium — the dependency is installed but unused, and the manual `slice(-200)` approach in `ChatFeed` has perf implications

#### Fail Test
1. `grep -r "react-virtual" frontend/src/` → 0 results in source files (only in `package.json`)
2. In `App.tsx:121`, `VIRTUALIZE_THRESHOLD = 200` triggers a `.slice(-200)` which is NOT virtualization — it just discards old messages from the DOM
3. With 200+ messages, scroll to top → messages above the threshold are gone from the DOM entirely (not virtualized, deleted)

#### Fix Test — Approach Comparison

| Approach | Pros | Cons |
|----------|------|------|
| A: Wire up `@tanstack/react-virtual` properly | True virtualization, handles 10K+ messages, maintains scroll position | Significant refactor of `ChatFeed`, need to handle dynamic row heights for variable message sizes |
| B: Remove the dependency, keep the slice approach | Simpler, current approach works fine for typical usage | Loses messages above threshold, no scroll-to-old-message capability |
| C: Keep dep, improve slice to be a "window" that loads more on scroll-up | Middle ground — infinite scroll upward | Still not true virtualization, custom logic |

**Recommendation: Approach A** for Phase 2 (not P0). For P0, document the issue and defer. The current approach works acceptably for most sessions.

#### Smoke Test (when implemented)
1. Send 500+ messages in a channel
2. Scroll to top → all messages should be accessible (not truncated)
3. Scroll should be smooth at 60fps
4. Auto-scroll-to-bottom on new message should still work
5. Memory usage should stay flat regardless of message count

---

## Phase 1 — Core Animation Layer (P1)

> **Depends on:** Phase 0 complete
> **Goal:** Establish Framer Motion as the animation backbone across all major UI surfaces

### P1-1: AnimatePresence on All Panels and Modals

**Files:** `App.tsx` (RightPanel, MobilePanel, modals), `Sidebar.tsx` (expanded panel)

#### Fail Test
1. Open Settings panel → panel appears with CSS `panel-slide-in` animation (0.25s)
2. Close Settings panel → panel **instantly disappears** (no exit animation)
3. Open SearchModal → modal has `modal-enter` CSS animation
4. Close SearchModal → **instantly disappears**
5. **Root cause:** CSS animations only run on mount. There is no unmount/exit animation anywhere except `Toast.tsx`

#### Fix Test
**Approach:** Wrap conditional renders in `AnimatePresence` with `motion.div` wrappers.

For `RightPanel` in `App.tsx`:
```
<AnimatePresence>
  {panel && (
    <motion.aside
      key="right-panel"
      initial={{ x: 320, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 320, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
    >
      ...existing panel content...
    </motion.aside>
  )}
</AnimatePresence>
```

Same pattern for: `MobilePanel`, `MobileSidebar`, `SearchModal`, `KeyboardShortcutsModal`, `HelpPanel`, `SessionLauncher`, `AddAgentModal`, `AgentInfoPanel`, `ChannelSummary`, `TerminalPeek`, `ReplayViewer`, `SplitView`

**Why spring physics:** Matches `Toast.tsx`'s existing spring config (stiffness 400, damping 30), creating consistency. Spring feels more natural than eased transitions for panels.

#### Smoke Test
1. Open/close every panel → should animate in AND out
2. Rapidly toggle panels → no stuck animations or zombie elements
3. Press Escape during animation → should interrupt cleanly
4. Test on each of the 9 themes → animation should work regardless of theme
5. Enable `prefers-reduced-motion` in browser → all animations should be instant (the CSS `@media` rule covers transitions but Framer Motion needs its own check — see P1-1b)

#### Verify
- `framer-motion` is v11.18.0, which supports `AnimatePresence` with `mode="wait"`
- `Toast.tsx` already proves `AnimatePresence` works in this codebase
- `ChatMessage.tsx` already imports `motion` — no new import patterns needed
- Right panel currently uses `className` margin transitions (`lg:mr-80`) — the Framer Motion animation should replace the CSS `panel-slide-in` class, not fight it

**P1-1b: Framer Motion reduced-motion support**
The CSS `prefers-reduced-motion` rule handles CSS animations but NOT Framer Motion. Add at app root:
```
import { MotionConfig } from 'framer-motion';
// In render:
<MotionConfig reducedMotion="user">
  <AppInner />
</MotionConfig>
```
This makes Framer Motion respect the OS preference. One-line wrapper.

---

### P1-2: Staggered List Animations

**Files:** `App.tsx` (ChatFeed message list), `SearchModal.tsx` (results), `JobsPanel.tsx`, `RulesPanel.tsx`, `ActivityTimeline.tsx`

#### Fail Test
1. Switch to a channel with 20+ messages → all messages appear simultaneously
2. Open SearchModal, search "test" → all results appear at once
3. Open Jobs panel → all job cards appear at once
4. **Expected:** Items should cascade in with 30-50ms stagger between each

#### Fix Test
**Approach:** Use Framer Motion `staggerChildren` on parent `motion.div`:

```
// Parent
<motion.div variants={{ show: { transition: { staggerChildren: 0.04 } } }} initial="hidden" animate="show">
  {items.map(item => (
    <motion.div key={item.id} variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}>
      ...
    </motion.div>
  ))}
</motion.div>
```

**Important constraint for ChatFeed:** Only stagger on initial channel load, NOT on individual new messages (which should animate individually via the existing `ChatMessage` motion.div). Use a `key={activeChannel}` on the parent to trigger stagger only on channel switch.

#### Smoke Test
1. Switch channels → messages cascade in with visible stagger
2. Receive a new message while viewing → single message animates in (no re-stagger of existing messages)
3. Search in SearchModal → results stagger in
4. Open Jobs/Rules → cards stagger in
5. Verify performance: 200+ messages should not cause jank (stagger only the visible ones)
6. `prefers-reduced-motion` with `MotionConfig` → items appear instantly

#### Verify
- `ChatMessage.tsx` already wraps each message in `<motion.div initial={{ opacity: 0, y: 10 }} ...>` — the stagger parent will orchestrate these via `variants` instead of individual `initial/animate`
- Need to convert ChatMessage's animation to use variants pattern (minor refactor)
- No conflict with virtual scrolling (Phase 0-3) since stagger only applies to visible items

---

### P1-3: Shimmer Skeleton Loaders

**Files:** `Skeleton.tsx`

#### Fail Test
1. Open the app with slow network (DevTools → Network → Slow 3G)
2. Observe loading states → `Skeleton.tsx` shows rectangles with opacity pulsing (0.3 ↔ 0.6)
3. Compare to LinkedIn/Facebook → they use a shimmering gradient sweep effect
4. **Issue:** The current `bg-[var(--bg-tertiary)]` references a CSS variable that doesn't exist in the current theme system (should be `bg-surface-container` or similar)

#### Fix Test
**Approach:** Replace opacity pulse with CSS gradient shimmer:

```css
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
.skeleton-shimmer {
  background: linear-gradient(90deg,
    var(--color-surface-container) 0%,
    var(--color-surface-container-high) 50%,
    var(--color-surface-container) 100%);
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
}
```

In `Skeleton.tsx`, replace the Framer Motion opacity animation with the CSS class:
```
<div className={`rounded skeleton-shimmer ${className}`} style={{ width, height }} />
```

**Why CSS over Framer Motion here:** Shimmer is a continuous loop that doesn't need JS — pure CSS is more performant for repeated decorative animations. This also fixes the broken `--bg-tertiary` variable reference.

#### Smoke Test
1. Skeleton components show moving gradient shimmer instead of opacity blink
2. Shimmer respects the active theme's surface colors (not hardcoded)
3. Works in all 9 themes
4. `prefers-reduced-motion` kills the animation (covered by existing CSS rule)
5. `MessageSkeleton`, `AgentSkeleton`, `ChannelSkeleton` all render correctly

#### Verify
- Removing the Framer Motion import from `Skeleton.tsx` is safe — no other Framer features are used there
- The `--bg-tertiary` variable bug is fixed by using theme tokens
- Shimmer animation is additive to the existing CSS animation infrastructure

---

### P1-4: Button & Toggle Micro-Interactions

**Files:** All components with buttons, `SettingsPanel.tsx` (Toggle component)

#### Fail Test
1. Click the Settings toggle for "Notification Sounds" → toggle knob slides with CSS `transition-all`
2. Compare to iOS/macOS toggle → their toggles have spring overshoot physics
3. Click any button → global `button:active { transform: scale(0.97) }` provides basic press feedback
4. **Missing:** No hover scale, no spring physics, no success/error feedback after async operations

#### Fix Test
**Toggle approach:** Replace CSS transition with Framer Motion `layout` animation on the knob:

```
<motion.div layout transition={{ type: 'spring', stiffness: 500, damping: 30 }} ... />
```

**Button approach:** Create a reusable `<MotionButton>` wrapper:
```
const MotionButton = motion.button;
// Usage: <MotionButton whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.95 }} ... />
```

**Why per-component instead of global CSS:** The global `button:active` rule gives 0.97 scale, but Framer Motion's `whileTap` provides spring physics that feel premium. The global CSS rule should remain as a fallback; Framer Motion will override it on components where it's applied.

#### Smoke Test
1. Toggle any switch → knob overshoots slightly then settles (spring behavior)
2. Hover over primary buttons → subtle scale-up
3. Click buttons → spring-physics press
4. Verify toggles still function correctly (state changes properly)
5. Verify the CSS `button:active` global rule doesn't conflict (Framer Motion's transform will win)

#### Verify
- The `Toggle` component in `SettingsPanel.tsx` is a local component (not shared) — safe to modify
- Adding `motion.button` to other components is additive — no existing animation to conflict with
- The global `button { transition: all 0.2s }` in `index.css:301` may need `transform` excluded to prevent fighting Framer Motion

---

## Phase 2 — Component Micro-Interactions (P2)

> **Depends on:** Phase 1 complete (AnimatePresence, stagger, shimmer infrastructure in place)

### P2-1: Chat Message Polish

#### Fail Test
1. Hover over an agent message → action bar (reply, copy, pin, bookmark, delete) fades in with `opacity` transition only
2. Delete a message → it instantly disappears from DOM
3. Long message collapse/expand → content height changes instantly
4. Reaction picker opens → just appears (no animation)

#### Fix Test
- **Action bar:** Add `motion.div` with staggered icon entrance (0.02s per icon, slide-up 4px + fade)
- **Message deletion:** Wrap message in `AnimatePresence` in the parent ChatFeed, add `exit={{ opacity: 0, height: 0, scale: 0.95 }}` with `layout` prop
- **Collapse/expand:** Use `motion.div` with `animate={{ height: 'auto' }}` pattern or `AnimatePresence` for the extra content
- **Reaction picker:** `motion.div` with `initial={{ scale: 0.8, opacity: 0 }}` from the button position

#### Smoke Test
1. Hover message → icons cascade in from left to right
2. Delete message → shrinks and fades out
3. Expand long message → content smoothly grows
4. Open reaction picker → pops in with spring
5. Add reaction → emoji bounces
6. Verify all of these with `prefers-reduced-motion` → instant/no animation

---

### P2-2: Input & Command Palette Polish

#### Fail Test
1. Focus MessageInput textarea → gets box-shadow focus ring (CSS) but no scale or glow animation
2. Open slash command menu → appears instantly
3. @mention autocomplete → appears instantly
4. Send message → button has no feedback beyond the global `active:scale-0.97`

#### Fix Test
- **Input focus:** Add animated border-glow using CSS `box-shadow` transition with `spread` expanding on focus (already partially there — enhance the `box-shadow: 0 0 0 2px` to `0 0 12px 2px` with color)
- **Slash commands:** Wrap in `motion.div` with `initial={{ opacity: 0, y: 8, scale: 0.95 }}` and stagger items
- **@mention autocomplete:** Same pattern as slash commands
- **Send button:** `whileTap={{ scale: 0.9 }}` + brief color flash on success

#### Smoke Test
1. Focus input → glow ring smoothly expands
2. Type `/` → command menu slides up with stagger
3. Type `@` → mention list animates in
4. Send message → button pulses
5. Rapidly type/delete → no animation jank or stuck states
6. Keyboard navigate slash commands → selection follows with smooth highlight

---

### P2-3: Agent State Transitions

#### Fail Test
1. Observe agent chip when agent goes from idle → thinking → idle
2. **Current:** Status dot color changes instantly, text changes instantly, spin border appears/disappears instantly
3. **Expected:** Color should morph, text should crossfade, spin border should fade in/out

#### Fix Test
- **Status dot:** Use `motion.div` with `animate={{ backgroundColor: dotColor }}` and `transition={{ duration: 0.5 }}`
- **Status text:** Use `AnimatePresence mode="wait"` with key={statusText} for crossfade
- **Spin border:** Wrap in `AnimatePresence` with opacity fade (the CSS animation handles rotation, Framer handles visibility)
- **Agent online/offline:** Animate the entire chip's opacity (0.5 → 1 for coming online, 1 → 0.5 for going offline)

#### Smoke Test
1. Watch an agent go through state transitions → colors morph smoothly
2. Agent comes online → chip fades to full opacity
3. Agent goes offline → chip dims gradually
4. Agent starts thinking → spin border fades in over 0.3s
5. Rapid state changes → transitions queue properly, no visual glitches

---

### P2-4: StatsPanel Number Animations

#### Fail Test
1. Open app with StatsPanel visible (xl+ screen, showStatsPanel enabled)
2. Send a message → "Messages" count changes from N to N+1 instantly
3. **Expected:** Number should animate (count up/down) like a dashboard counter

#### Fix Test
**Approach:** Create a `<AnimatedNumber value={n} />` component using `useSpring` from Framer Motion:

```
function AnimatedNumber({ value }: { value: number }) {
  const spring = useSpring(value, { stiffness: 100, damping: 20 });
  const display = useTransform(spring, v => Math.round(v));
  return <motion.span>{display}</motion.span>;
}
```

Apply to all numeric displays in `StatsPanel.tsx`: message count, agent count, token estimate, cost estimate, session time.

#### Smoke Test
1. Send messages → counter smoothly ticks up
2. Agent comes online → "Agents Online" counter animates
3. Switch channels → all counters animate to new values
4. Values with K suffix (e.g., "12.5K") should animate the number part only
5. `prefers-reduced-motion` → numbers jump instantly

---

### P2-5: ConnectionBanner Animation

#### Fail Test
1. Disconnect network (DevTools → Offline) → banner appears instantly at top
2. Reconnect → banner instantly disappears
3. **Expected:** Slide down on appear, slide up on disappear

#### Fix Test
Wrap in `AnimatePresence` in `App.tsx` (where `ConnectionBanner` is rendered):
```
<AnimatePresence>
  {wsState !== 'connected' && (
    <motion.div
      initial={{ y: -40 }}
      animate={{ y: 0 }}
      exit={{ y: -40 }}
      transition={{ type: 'spring', stiffness: 300, damping: 25 }}
    >
      <ConnectionBanner />
    </motion.div>
  )}
</AnimatePresence>
```

Also add a pulsing animation to the "Reconnecting..." state (the `sync` icon should rotate).

#### Smoke Test
1. Go offline → banner slides down smoothly
2. Reconnect → banner slides up and disappears
3. Rapid connect/disconnect → animations queue properly
4. Banner doesn't push content down jankily (use `position: fixed` — already the case)

---

## Phase 3 — Premium Effects & Polish (P3)

> **Depends on:** Phase 2 complete
> **Goal:** The "wow factor" — particle effects, streaming text, ambient enhancements

### P3-1: Streaming Text Animation for Agent Messages

#### Fail Test
1. Agent sends a message → entire message appears at once (received via WebSocket as complete text)
2. Compare to ChatGPT/Claude → text appears word-by-word with a cursor

#### Fix Test
**Approach:** Client-side text reveal animation (since the backend sends complete messages):
- When a new agent message arrives, instead of rendering full text immediately, animate words appearing with 15ms delay per word
- Use a `useEffect` with `requestAnimationFrame` loop to progressively reveal `displayedText` from 0 to full length
- Only for NEW messages (not historical messages loaded on channel switch)

**Alternative considered:** Modify backend to stream via WebSocket chunks — rejected because it's a backend change and the visual effect can be achieved client-side.

#### Smoke Test
1. Receive agent message → text flows in word by word
2. Existing messages (loaded on channel switch) → appear instantly (no animation)
3. Multiple agents responding simultaneously → each animates independently
4. User scrolls during animation → animation continues correctly
5. Code blocks within streaming text → appear as a unit (not character by character)
6. Performance: 1000-word message should not cause jank

---

### P3-2: Particle Effects for Agent Thinking

#### Fail Test
1. Agent enters thinking state → spinning border + pulse glow (good existing animation)
2. **Missing:** No floating particles, orbs, or ambient effect around the thinking chip
3. Compare to AI loading states in modern apps → often have floating dots or orbiting particles

#### Fix Test
**Approach:** SVG-based animated particles using Framer Motion:
- Create `<ThinkingParticles color={agentColor} />` component
- Render 4-6 small circles that orbit the agent chip with randomized speeds
- Use `motion.circle` with `animate={{ rotate: 360 }}` and varying `transition.duration`
- Position as absolute overlay on the `AgentChip` component

**Why SVG over Canvas:** SVG integrates with React's lifecycle and Framer Motion. Canvas would need manual cleanup. For 4-6 particles, SVG is plenty performant.

#### Smoke Test
1. Agent starts thinking → particles appear and orbit
2. Agent stops thinking → particles fade out
3. Multiple agents thinking → each has independent particles
4. Particles use the agent's color
5. `prefers-reduced-motion` → no particles shown
6. No memory leaks on repeated think/stop cycles

---

### P3-3: Toast Improvements (Stacking, Swipe Dismiss)

#### Fail Test
1. Trigger 3 toasts rapidly → they stack vertically but may overlap
2. Try to dismiss a toast → no gesture support, must wait 4 seconds
3. **Current:** Toast has good spring entrance/exit but no stacking offset and no interaction

#### Fix Test
- **Stacking:** Add `index` to each toast, use `style={{ y: index * -8 }}` for cascading offset
- **Swipe dismiss:** Add `drag="x"` and `onDragEnd` handler that removes toast when dragged past threshold
- **Max toasts:** Limit to 5 visible, auto-dismiss oldest

#### Smoke Test
1. Trigger 5 toasts → they stack with offset, newest on top
2. Swipe a toast right → it slides out and is removed
3. 6th toast → oldest auto-dismissed
4. Toast still auto-dismisses after 4s if not swiped

---

### P3-4: Theme Transition Animation

#### Fail Test
1. Go to Settings → Appearance → Click a different theme
2. **Current:** Theme changes instantly (all CSS variables swap at once)
3. **Expected:** Smooth cross-fade between themes

#### Fix Test
**Approach:** Use a CSS `transition` on the `html` element's color properties:
```css
html {
  transition: background-color 0.4s ease, color 0.4s ease;
}
.glass, .glass-strong, .liquid-glass, .glass-card {
  transition: all 0.4s ease;  /* already partially exists */
}
```

**Why CSS over JS:** Theme changes swap CSS variables. The browser's `transition` property can interpolate between CSS variable values if the transition is on the resolved properties. The glass classes already have `transition: all 0.3s` — just ensure the duration matches.

#### Smoke Test
1. Switch dark → light → colors smoothly morph
2. Switch dark → cyberpunk → neon colors fade in
3. Switch terminal → ocean → monospace fades to sans-serif, colors morph
4. Rapid theme toggling → transitions queue cleanly
5. Glass surfaces transition without flash-of-unstyled-content

---

## Phase 4 — Mobile & Responsive (P4)

> **Depends on:** Phase 1 (AnimatePresence) and Phase 2 (micro-interactions)

### P4-1: Mobile Message Actions via Long-Press

#### Fail Test
1. On mobile (< 1024px), hover over a message → action buttons are forcibly hidden
2. `index.css:410-413`: `.group:hover .opacity-0 { opacity: 0 !important; }` — this CSS rule kills all hover-revealed actions on mobile
3. **Result:** Mobile users cannot react, reply, pin, bookmark, or delete messages

#### Fix Test
**Approach:** Implement long-press gesture on `ChatMessage` to show action menu:
- Use `onTouchStart` / `onTouchEnd` with 500ms timer
- On long-press, show a bottom sheet or context menu with the same actions
- Replace the blanket CSS hide with a more nuanced approach

#### Smoke Test
1. Mobile: long-press a message → action menu appears
2. Short tap → no action menu (normal behavior)
3. Long-press then drag → cancels the menu (not a long-press)
4. Action menu: react, reply, copy, pin, bookmark, delete all work
5. Menu dismisses on outside tap
6. Desktop: hover actions still work as before

---

### P4-2: Mobile Sidebar Gesture Support

#### Fail Test
1. Open MobileSidebar → tapping hamburger shows full-screen overlay
2. **Missing:** No swipe-from-left-edge to open, no swipe-right to close
3. Compare to Slack/Discord mobile → edge swipe is standard

#### Fix Test
**Approach:** Use Framer Motion `drag` on the sidebar:
```
<motion.div
  drag="x"
  dragConstraints={{ left: 0, right: 0 }}
  onDragEnd={(_, info) => { if (info.offset.x > 100) close(); }}
>
```

Also add touch listener on left edge (0-20px) of the screen for swipe-to-open.

#### Smoke Test
1. Swipe from left edge → sidebar opens
2. Swipe sidebar right → sidebar closes
3. Swipe in chat area → does NOT open sidebar (only edge swipe)
4. Content behind sidebar is not interactive while open
5. Animation feels natural with momentum

---

## Dependency Map

```
Phase 0 (P0) — No dependencies, can start immediately
├── P0-1: CodeBlock syntax highlighting
├── P0-2: Wire unused CSS animations
└── P0-3: Document @tanstack/react-virtual issue

Phase 1 (P1) — Depends on P0 completion
├── P1-1: AnimatePresence on panels/modals ← FOUNDATION for everything
│   └── P1-1b: MotionConfig reduced-motion ← Must ship WITH P1-1
├── P1-2: Staggered list animations ← Depends on P1-1 (AnimatePresence)
├── P1-3: Shimmer skeletons ← Independent, can parallel with P1-1/P1-2
└── P1-4: Button/toggle micro-interactions ← Independent, can parallel

Phase 2 (P2) — Depends on P1-1 (AnimatePresence) and P1-4 (motion.button pattern)
├── P2-1: Chat message polish ← Depends on P1-1, P1-2
├── P2-2: Input/command palette ← Depends on P1-4
├── P2-3: Agent state transitions ← Depends on P1-1
├── P2-4: StatsPanel numbers ← Independent
└── P2-5: ConnectionBanner ← Depends on P1-1

Phase 3 (P3) — Depends on P2 core patterns established
├── P3-1: Streaming text ← Depends on P2-1 (chat message structure)
├── P3-2: Thinking particles ← Independent
├── P3-3: Toast improvements ← Independent (Toast already uses Framer)
└── P3-4: Theme transitions ← Independent (CSS-only)

Phase 4 (P4) — Depends on P1-1 (AnimatePresence) and P2-1 (message patterns)
├── P4-1: Mobile long-press ← Depends on P2-1
└── P4-2: Mobile sidebar gestures ← Depends on P1-1
```

### Parallelization Opportunities

Within each phase, items marked "Independent" can be worked on simultaneously:

- **P1 parallel track A:** P1-1 + P1-1b (foundation)
- **P1 parallel track B:** P1-3 + P1-4 (can start immediately, no P1-1 dependency)
- **P2 parallel track A:** P2-1 + P2-3 + P2-5 (all need AnimatePresence)
- **P2 parallel track B:** P2-2 + P2-4 (independent patterns)
- **P3 all items** can be parallelized (independent of each other)
- **P4 both items** can be parallelized

### Conflict Avoidance with Other Roadmaps

This GAF roadmap touches ONLY:
- `frontend/src/components/*.tsx` — animation wrappers and className additions
- `frontend/src/index.css` — new keyframes and shimmer class
- `frontend/src/App.tsx` — AnimatePresence wrappers around existing conditionals

It does NOT touch:
- Backend files (`server.ts`, `api/`, etc.)
- State management logic (`chatStore.ts` internals)
- Type definitions (`types/index.ts`)
- Build configuration (`vite.config.ts`, `package.json`)
- Desktop app files (`desktop/`)
- Any file mentioned in `ROADMAP.md` or `V2.5_BUGFIX_ROADMAP.md`

---

*End of GAF Roadmap — March 24, 2026*
