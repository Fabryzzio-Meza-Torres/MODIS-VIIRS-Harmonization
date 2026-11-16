---
name: FuegoTrazo
description: A scientific dashboard for harmonized satellite observations and experimental weekly activity estimates in Peru.
colors:
  base: "#081625"
  panel: "#10243B"
  surface: "#17334D"
  line: "#21405E"
  ink: "#F4F7FB"
  muted: "#94A8BD"
  fire: "#F97316"
  danger: "#EF4444"
  modis: "#FB923C"
  viirs: "#67D8F2"
  amber: "#FBBF24"
  teal: "#14B8A6"
  sky: "#38BDF8"
typography:
  headline:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: "32px"
  title:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: "25.5px"
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
  statistic:
    fontFamily: '"JetBrains Mono", ui-monospace, monospace'
    fontSize: "20px"
    fontWeight: 500
    lineHeight: "28px"
rounded:
  md: "6px"
  lg: "8px"
  xl: "12px"
spacing:
  xs: "4px"
  sm: "8px"
  control: "12px"
  md: "16px"
  panel: "20px"
  section: "24px"
  wide: "32px"
components:
  button-week:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  button-week-selected:
    backgroundColor: "{colors.amber}"
    textColor: "{colors.base}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "6px 10px"
  card:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "20px"
  experimental-chip:
    backgroundColor: "{colors.amber}"
    textColor: "{colors.base}"
    rounded: "{rounded.md}"
    padding: "4px 10px"
---

# Design System: FuegoTrazo

## Overview

**Creative North Star: "The Scientific Observation Desk"**

FuegoTrazo is a navy, ruled scientific dashboard. It places readable numbers, geographic scope, historical context, and inspectable sources in a continuous working surface. The incumbent React application is the visual authority; this record captures its shipped system rather than proposing a new identity.

Its calm density suits comparison and careful reading. Spanish public copy keeps explanations close to the statistic they qualify. Forecast and evidence views share panels, controls, table rules, and disclosures so a reader can move from a weekly estimate to its context without learning another interface.

**Key Characteristics:**
- Deep navy surfaces distinguished by tone and thin rules.
- Compact Inter text with a restrained hierarchy and selective monospace statistics.
- Amber selection, cyan links, and stable instrument colors.
- Visible denominators and progressive disclosure for detailed provenance.

## Colors

The palette uses three related navy surfaces, pale text, and functional accents. Frontmatter contains the normative values extracted from the Tailwind theme.

### Primary

- **Signal Amber (`amber`)** identifies the selected forecast week, selected chart bar, and experimental badge. Warning panels also use its translucent form with explicit explanatory text.
- **Navigation Sky (`sky`)** marks underlined links, interactive comparison labels, and the global keyboard focus outline.

### Secondary

- **MODIS Orange (`modis`)** and **VIIRS Ice (`viirs`)** identify instruments consistently across the wider dashboard.
- **Fire Orange (`fire`)** accents the brand and participates in the activity map scale.
- **Status Teal (`teal`)** marks an available series connection; **Error Red (`danger`)** supports error feedback.

### Neutral

- **Deep Navy (`base`)** anchors the page and provides text on amber controls.
- **Panel Navy (`panel`)** separates cards and navigation from the canvas.
- **Surface Navy (`surface`)** gives controls, statistics, and selected navigation an inset tonal layer.
- **Rule Blue (`line`)** defines panel edges, table rows, chart grids, and section divisions.
- **Reading White (`ink`)** carries headings and main values; **Context Slate (`muted`)** carries labels, dates, caveats, and historical chart context.

**The Context Rule.** Color supports a named state or data series; labels and explanatory text carry its meaning.

## Typography

Inter is the display and reading family, with system sans-serif fallbacks. JetBrains Mono, with monospace fallbacks, appears in shared statistics and selected technical identifiers. Forecast probability values instead use Inter with tabular numerals.

The hierarchy moves from a compact page headline to semibold panel titles, regular body text, and small contextual labels. The forecast result adds a prominent estimate (30px, semibold) alongside historical frequency and difference (24px). These are local data emphases, not a promotional display style. Subtitles generally stop at 70 characters; explanatory paragraphs commonly use 72–85-character measures.

**The Number and Meaning Rule.** Keep a statistic's label, unit, denominator, and qualification visually adjacent. A large percentage must remain legible as a specific department and week estimate.

## Layout

At the medium breakpoint (768px), the shell becomes a two-column grid with a fixed 250px navigation column and a flexible content column. Desktop navigation stays near the top while the page scrolls. Below that breakpoint, a compact branded header and an expandable menu replace the sidebar.

Main content uses 16px horizontal padding on small screens and 32px from the medium breakpoint, with 24px vertical padding. Cards stack with a 20px gap and 20px internal padding. Filter groups and week controls wrap; the forecast result moves from one column to three at 640px, while paired evidence witnesses move to two columns there. Tables retain their tabular structure inside horizontal scroll containers.

The application has no imposed narrow page container. Reading measures constrain prose while tables and charts use the available width. The weekly comparison chart is 260px high. Print styles remove navigation and filters, switch surfaces to white, preserve readable text and rules, and avoid breaking sections where possible.

## Elevation & Depth

The shell and cards use tonal layering and one-pixel rules, without structural shadows. A translucent filter strip uses backdrop blur. Tooltips use an opaque panel surface with a thin rule and gently curved corners. Interactive emphasis comes from color and focus, not simulated physical lift.

## Shapes

Containers have gently curved corners: cards use the largest standard radius, statistics and navigation use the middle radius, and controls use the smallest. Straight table rules and bordered metric bands maintain the scientific reading grid inside these containers. Small legend squares and circular connection indicators retain their existing distinct functions.

## Components

### Navigation and filters

Navigation combines a small line icon with a Spanish label. Active links use a surface fill and bright text; inactive links use muted text and acquire a subdued surface fill on hover. The mobile menu closes after navigation. Fields use a surface fill, thin rule, visible label, and compact padding. Forecast and evidence routes retain the department filter while exposing their own week or catalog controls.

### Week buttons and experimental chip

Week buttons are bordered, wrapping controls. Selection uses amber fill with dark text and `aria-pressed`; unselected buttons have surface fill and a sky border on hover. Each button shows the starting date and lead week. The experimental chip shares the amber treatment while remaining a textual status, not an action.

### Cards and metric bands

Cards contain a semibold title, optional muted subtitle, optional actions, and content. Their headers wrap naturally. The forecast metric band uses top and bottom rules rather than nested statistic cards: model estimate first, historical frequency with positive-week denominator second, and contextual difference in percentage points third. Difference values do not receive a severity color.

### Charts and tables

The forecast chart uses amber for the selected week, muted blue for other bars, and a dashed slate historical line. Animation is disabled. Grid lines are horizontal, ticks are small, and tooltips report the full week and percentage. Department comparisons remain alphabetical. Tables use left-aligned headers and thin row rules, with nowrap numeric cells where needed.

### Evidence disclosures

Native details and summary controls reveal matching instrument witnesses beneath a compact date, department, and reference identifier. Witnesses present labeled dates, local time, WGS84 distance, coordinates, and official-record links. Long archive names and hashes wrap. Method and integrity disclosures use the same ruled language and preserve access to detailed sources.

### Feedback and interaction

Unavailable forecasts use an amber bordered panel with explanatory Spanish copy and no replacement percentage. Errors use translucent red feedback with retry actions where present. Empty states use a dashed border; loading states use quiet pulsing surface blocks with accessible status text. The global focus-visible treatment is a sky outline (2px) offset from its target (2px). Native disabled pagination lowers opacity.

## Do's and Don'ts

### Do:

- **Do** retain navy tonal layers and thin rules as the main means of grouping information.
- **Do** keep Spanish UI text, visible labels, and underlined source links.
- **Do** present forecast percentages with department, complete week, historical denominator, and a clearly labeled difference in percentage points.
- **Do** keep official evidence details and scientific qualifications available through readable disclosures.
- **Do** preserve wrapping controls and horizontally scrollable tables on small screens.

### Don't:

- **Don't** turn the contextual difference or experimental badge into an official severity classification.
- **Don't** display an unavailable forecast as zero.
- **Don't** replace instrument colors or selected-week semantics with arbitrary decorative accents.
- **Don't** separate enlarged statistics from the context needed to interpret them.
