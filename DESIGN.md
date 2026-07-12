---
name: Carrent Desktop
description: A quiet, precise workbench for sustained local agent sessions.
colors:
  night-canvas: "#0f0f0e"
  night-sidebar: "#191918"
  night-surface: "#1f1f1d"
  night-raised: "#272724"
  night-hover: "#30302c"
  night-foreground: "#e7e6e0"
  night-muted: "#949289"
  night-subtle: "#696760"
  night-border: "#31312d"
  night-border-strong: "#46453f"
  night-action: "#b4b4b4"
  night-code: "#0c0c0b"
  paper-canvas: "#f7f7f4"
  paper-sidebar: "#fafaf7"
  paper-surface: "#fffffc"
  paper-hover: "#ebebe6"
  paper-foreground: "#1e1e1e"
  paper-muted: "#696964"
  paper-subtle: "#91918a"
  paper-border: "#e0e0d8"
  paper-border-strong: "#cbcbc2"
  paper-action: "#505050"
  success-night: "#46aa6e"
  warning-night: "#e87d5a"
  danger-night: "#c85050"
  success-paper: "#32965a"
  warning-paper: "#d26e46"
  danger-paper: "#b43c3c"
typography:
  headline:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    fontSize: "18px"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "normal"
  title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "normal"
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.75
    letterSpacing: "normal"
  label:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "normal"
  caption:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  mono:
    fontFamily: '"SFMono-Regular", "IBM Plex Mono", Consolas, monospace'
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
rounded:
  sm: "0.375rem"
  md: "0.5rem"
  lg: "0.75rem"
  full: "9999px"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  xl: "1.5rem"
  2xl: "2rem"
components:
  button-primary:
    backgroundColor: "{colors.night-foreground}"
    textColor: "{colors.night-canvas}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "7px 12px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.night-muted}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "7px 8px"
  icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.night-subtle}"
    rounded: "{rounded.md}"
    size: "28px"
  nav-item-active:
    backgroundColor: "{colors.night-hover}"
    textColor: "{colors.night-foreground}"
    typography: "{typography.title}"
    rounded: "{rounded.lg}"
    padding: "8px 10px"
  input-field:
    backgroundColor: "{colors.night-surface}"
    textColor: "{colors.night-foreground}"
    typography: "{typography.title}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  skill-chip:
    backgroundColor: "{colors.night-surface}"
    textColor: "{colors.night-foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "4px 8px"
  composer:
    backgroundColor: "{colors.night-raised}"
    textColor: "{colors.night-foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "12px"
  toast:
    backgroundColor: "{colors.night-raised}"
    textColor: "{colors.night-foreground}"
    typography: "{typography.title}"
    rounded: "{rounded.lg}"
    padding: "12px 14px"
---

# Design System: Carrent Desktop

## 1. Overview

**Creative North Star: "The Quiet Workbench"**

Carrent is a focused desktop surface for an engineer working through sustained local agent sessions. In a dim workspace the Night theme reduces glare with warm graphite layers; in daylight the Paper theme preserves the same hierarchy with warm whites and soft ink. Both themes feel like the same tool, not separate brands.

The system is dense, restrained, and operational. Information stays close to the action, familiar icons carry repeated commands, and state is conveyed with tone, border strength, and concise text. It explicitly rejects marketing-style composition inside the app, playful chatbot aesthetics, decorative gradients, excessive cards, oversized labels, and runtime terminology that hides the user's actual selection.

This document covers `apps/desktop` only. The landing site is not designed yet and must not inherit a speculative theme from this file.

**Key Characteristics:**

- Warm graphite and paper-white theme parity.
- Compact three-pane desktop structure with predictable navigation.
- Tonal layering and 1px hairlines before shadows.
- System sans typography with mono reserved for code and paths.
- Controls that remain usable from 8px through 32px text scaling.

**The Desktop-Only Rule.** Apply these tokens to `apps/desktop`; do not theme the undeveloped landing site from this document.

## 2. Colors

The palette is nearly achromatic but deliberately warm, with semantic color reserved for execution state rather than decoration.

### Primary

- **Neutral Action** (#b4b4b4 Night / #505050 Paper): The current theme's action token carries primary controls and selected emphasis without introducing a saturated brand hue.

### Secondary

- **Measured Green** (#46aa6e Night / #32965a Paper): Success and healthy runtime state only.
- **Warm Signal** (#e87d5a Night / #d26e46 Paper): Warnings and attention states that are actionable but not destructive.
- **Muted Red** (#c85050 Night / #b43c3c Paper): Errors, destructive commands, and failed runtime state.

### Neutral

- **Graphite Canvas / Paper Canvas** (#0f0f0e / #f7f7f4): The application background and deepest spatial layer.
- **Warm Rail / Warm Paper Rail** (#191918 / #fafaf7): The title bar, project rail, and secondary-pane surround.
- **Workbench Surface / Clean Paper Surface** (#1f1f1d / #fffffc): Menus, fields, and framed tools.
- **Raised Graphite / Pressed Paper** (#272724 / #ebebe6): Composer, hover, selected, and transient raised states.
- **Chalk Foreground / Soft Ink** (#e7e6e0 / #1e1e1e): Primary copy and high-confidence controls.
- **Tool Steel / Graphite Text** (#949289 / #696964): Secondary labels and inactive commands.
- **Quiet Text / Quiet Graphite** (#696760 / #91918a): Metadata, descriptions, and placeholders.
- **Graphite Hairlines / Paper Hairlines** (#31312d / #e0e0d8): Structural borders and dividers; strong variants (#46453f / #cbcbc2) mark focus or raised boundaries.
- **Ink Well** (#0c0c0b): Code blocks and inline code in the Night theme; the Paper theme uses its corresponding code surface token from the implementation.

**The Restrained Signal Rule.** Semantic green, orange, and red communicate state only; they never decorate navigation, headings, or empty space.

**The Theme Parity Rule.** A component must keep the same hierarchy in Night and Paper themes even when exact contrast relationships invert.

## 3. Typography

**Display Font:** System sans stack with platform-native rendering.
**Body Font:** System sans stack with platform-native rendering.
**Label/Mono Font:** SFMono Regular, IBM Plex Mono, or Consolas.

**Character:** Typography is neutral, compact, and immediately legible. Hierarchy comes from restrained size and weight changes, never from a decorative typeface or compressed tracking.

### Hierarchy

- **Headline** (500, 18px, 1.5): Page titles such as Settings and active workspace headings.
- **Title** (600, 13px, 1.5): Pane headings, selected items, and compact section labels.
- **Body** (400, 15px, 1.75): Agent and user prose; cap sustained prose near 65-75 characters per line.
- **Label** (500, 12px, 1.5): Buttons, control labels, statuses, and menu actions.
- **Caption** (400, 11px, 1.5): Secondary descriptions, timestamps, versions, and source labels.
- **Mono** (400, 13px, 1.5): Code, shell output, versions, and filesystem paths.

**The Fixed Layout Rule.** The user's 8px-32px setting scales typography tokens, not the root rem size, so layout dimensions remain stable while text grows.

**The No Display Type Rule.** Never introduce a display font, fluid viewport typography, negative letter spacing, or oversized product labels.

## 4. Elevation

Carrent is flat by default. Canvas, rail, surface, raised surface, and 1px borders establish most depth. Shadows are structural and appear only on the outer desktop shell, composer, menus, dialogs, popovers, and toasts.

### Shadow Vocabulary

- **Shell Frame** (`0 0 0 1px rgb(255 255 255 / 0.02), 0 18px 48px rgb(0 0 0 / 0.18)`): Defines the Electron window as one contained work surface.
- **Composer Lift** (`0 18px 60px rgb(0 0 0 / 0.18)`): Separates the message composer from the timeline without making it a decorative card.
- **Menu Lift** (`0 18px 60px rgb(0 0 0 / 0.28)` or Tailwind `shadow-xl`): Reserved for temporary layers above the active task.
- **Inset Selection** (`0 0 0 1px rgb(var(--color-border-strong) / 0.28-0.32) inset`): Reinforces selected navigation without a saturated highlight.

**The Flat-at-Rest Rule.** Persistent content surfaces use tonal separation and hairlines; if every section casts a shadow, the hierarchy is wrong.

## 5. Components

Components are compact, restrained, and familiar. They prioritize repeated keyboard-and-pointer workflows over decoration.

### Buttons

- **Shape:** Gently curved compact controls using the medium radius; circular treatment is reserved for icon-only approval and dismiss actions.
- **Primary:** Foreground-on-canvas inversion with 7px vertical and 12px horizontal padding.
- **Hover / Focus:** Hover changes tone or opacity in 150ms; keyboard focus must use a visible outline or strong border, never color alone.
- **Secondary / Ghost:** Transparent at rest with muted text; hover introduces the raised or hover surface. Icon-only buttons are 28px by default and always require a tooltip or accessible name.

### Chips

- **Style:** Full-radius surface chip with a 1px strong hairline, 8px horizontal padding, and compact label typography.
- **State:** Skills and compact state markers may dim when unavailable; semantic color appears only when the chip itself communicates status.

### Cards / Containers

- **Corner Style:** Large radius for the shell, panes, composer, menus, and bounded tools.
- **Background:** Use canvas for the task area, rail for navigation surroundings, surface for menus and fields, and raised surface for transient emphasis.
- **Shadow Strategy:** Persistent sections stay flat; only temporary or genuinely elevated tools use shadows.
- **Border:** One-pixel default hairlines; strong hairlines identify focus, selection, or floating boundaries.
- **Internal Padding:** 8px for dense lists, 12px for tools, 16px for dialogs, and 24px only for spacious shared primitives.

### Inputs / Fields

- **Style:** Surface or transparent field inside a framed tool, medium radius, 1px border, and 12px horizontal padding.
- **Focus:** Shift to the strong border or a 2px low-opacity ring without moving layout.
- **Error / Disabled:** Error text uses Muted Red with an icon where space permits; disabled controls keep their label and use reduced opacity plus a non-interactive cursor.
- **Numeric Input:** Clamp values immediately to documented bounds; do not defer invalid state until blur.

### Navigation

- **Style:** A 58px project rail and a resizable 200px-480px secondary pane frame the task area. Active items use the hover surface, foreground text, and a faint inset hairline. Inactive items use muted text and gain tone on hover.
- **Typography:** Primary labels use Title; descriptions use Caption. Truncate secondary metadata before it can resize the pane.
- **Behavior:** Collapse and resize controls preserve the main task area. Navigation state must remain readable without relying on color alone.

### Chat Composer

The composer is the signature working surface: a raised, large-radius tool capped at 48rem, with the message field first and runtime, model, permission, attachment, skill, and branch controls grouped below. Menus open above it, use strong boundaries, and never obscure the current selection.

## 6. Do's and Don'ts

### Do:

- **Do** preserve Night and Paper theme parity using the existing semantic color roles.
- **Do** keep repeated workflows compact, predictable, and directly adjacent to the active coding task.
- **Do** show runtime, model, permission mode, branch, and execution state in plain domain language.
- **Do** use familiar Lucide icons for commands and provide accessible names for icon-only buttons.
- **Do** use tonal layering and 1px borders before adding a shadow.
- **Do** keep controls usable under 8px-32px text scaling and constrained desktop widths.
- **Do** use 150ms-260ms state transitions with ease-out curves; animate opacity and transform, not layout.

### Don't:

- **Don't** use marketing-style composition inside the app.
- **Don't** use playful chatbot aesthetics.
- **Don't** add decorative gradients; the single subdued neutral canvas wash is the only existing exception.
- **Don't** create excessive cards or cards nested inside cards.
- **Don't** use oversized labels or hero-scale typography inside product UI.
- **Don't** use runtime terminology that obscures the user's actual selection.
- **Don't** use gradient text, glassmorphism, decorative colored side stripes, or saturated inactive states.
- **Don't** invent a landing theme until the landing product and content are designed.
- **Don't** open a modal when an inline or progressively disclosed control can complete the task.
