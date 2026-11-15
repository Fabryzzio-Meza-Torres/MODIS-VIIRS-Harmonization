---
name: Fire Shift Calendar
description: Regional MODIS–VIIRS comparison and historical evidence viewer for Peru.
colors:
  bg: "#091525"
  panel: "#10243b"
  surface: "#183552"
  line: "#344b62"
  text: "#f4f7fb"
  muted: "#a9bbce"
  orange: "#fb923c"
  cyan: "#67d8f2"
  focus: "#a5edfa"
  field-border: "#607d98"
rounded:
  control: "8px"
  panel: "12px"
spacing:
  compact: "8px"
  field: "12px"
  control-gap: "14px"
  gutter: "16px"
  section: "24px"
  page: "32px"
typography:
  headline:
    fontFamily: "Inter, sans-serif"
    fontSize: "26px"
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Inter, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Inter, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Inter, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.6
  metadata:
    fontFamily: "Inter, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.6
components:
  button-primary:
    backgroundColor: "{colors.orange}"
    textColor: "#172231"
    rounded: "{rounded.control}"
    padding: "10px 24px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "8px 14px"
  field:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "9px 12px"
  panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.panel}"
    padding: "24px"
---

# Design System: Fire Shift Calendar

## Overview

**Creative North Star: "The analytical viewer"**

This records the existing operational extension of Fire Shift Calendar, rather than a new visual direction. Dark navy surfaces, self-hosted Inter and orange/cyan instrument identification carry the comparison and its historical evidence. The chart is the main comparison surface; the geographic selector supports it.

The evidence extension uses a reading-and-operating rhythm: a stated interpretation boundary, ruled result tables, native filters and expandable references. It continues the viewer's visual language without presenting historical association as proof of attribution or future ignition risk.

**Key Characteristics:**
- Dark tonal surfaces with visible rules and restrained corners.
- One self-hosted type family and tabular numerals.
- Instrument identity preserved across the analytical viewer.
- Native controls and disclosures with visible keyboard focus.
- Responsive evidence that stacks while retaining source detail.

## Colors

Navy neutrals support bright data and interaction accents; token values above are authoritative.

### Primary

- **MODIS orange** (`orange`) identifies the MODIS series and the primary comparison action.

### Secondary

- **VIIRS cyan** (`cyan`) identifies the VIIRS series and carries links and disclosure affordances. Evidence result labels also use cyan; color alone does not encode their classification.

### Neutral

- **Deep navy** (`bg`) forms the page ground; **panel navy** (`panel`) holds controls, chart and map; **raised navy** (`surface`) supplies secondary hover fill.
- **Slate rule** (`line`) separates tables, sections and disclosures. **Field stroke** (`field-border`) strengthens control outlines.
- **Cool white** (`text`) carries headings and primary values; **blue grey** (`muted`) carries supporting prose and metadata.
- **Ice focus** (`focus`) identifies keyboard position with a visible outline.

**The Instrument Identity Rule.** Preserve orange for MODIS and cyan for VIIRS in the comparison series and legend; retain explicit instrument names alongside color.

## Typography

**Display and Body Font:** Inter, with sans-serif fallback. The variable Latin font is self-hosted at `assets/inter-latin.woff2`, weights 400–700. Body numerals are tabular.

The hierarchy is compact and functional. The headline and title roles above establish the main scale; evidence headings use a slightly smaller desktop headline (24px), then the shared title role. Body copy retains a comfortable line height; labels and metadata remain subordinate without becoming uppercase decoration.

At the mobile breakpoint the main headline becomes 23px and the evidence heading 22px. Supporting evidence text uses the label and metadata sizes. Introductory text is bounded around 70 characters, while evidence explanations and provenance may extend to 85–95 characters.

## Layout

The centered main area is capped at 1320px with desktop padding of 32px vertically and 24px horizontally. The comparison workspace uses a 2.7:1 grid, a minimum 270px map column and a 22px gap. At 1000px the map remains 270px while the gap reduces to 16px.

At 760px the workspace becomes one column and page padding becomes 24px by 16px. Filters form a two-column grid with the regional field spanning both columns. The map internally pairs its drawing with coordinate controls until the narrow 390px layout stacks them.

Evidence is separated from the viewer by a top rule and 56px margin. Reference summaries have four desktop columns; at 760px they become a two-column arrangement. Expanded instrument evidence changes from two columns to one. Tables retain local horizontal scrolling where needed; long IDs, hashes and source filenames wrap inside their own content area. Percentages retain their unit as one unbroken inline value.

The spacing tokens describe recurring values, not a strict universal grid: source styles also use contextual gaps and margins. Preserve the established density instead of forcing all measurements onto a new scale.

**The Evidence Continuity Rule.** Keep reference identifiers, result labels and source detail readable when a summary or evidence column stacks on mobile.

## Elevation & Depth

The page uses tonal layering and one-pixel rules for its persistent hierarchy. Panels have visible boundaries; evidence lists remain flat on the page. The chart tooltip alone uses a floating shadow (`0 6px 18px #0005`), with its own stronger border and background. That transient treatment is not a general card style.

Map fill changes use a short 150ms ease-out transition. Reduced-motion preferences disable transitions and smooth scrolling throughout the page.

## Shapes

Controls and small bounded notices share gently curved corners through the control radius. Chart and map panels use the larger panel radius. Evidence tables and reference rows use straight horizontal rules without individual rounded cards. The map retains geographic silhouettes.

## Components

### Buttons

Primary buttons use orange fill, dark text, semibold type and no border; hover lightens the fill. Secondary buttons use a transparent background, white text and the field stroke, changing to the surface fill on hover. Text actions use cyan and gain an underline on hover. Controls have a 43px minimum height. Disabled buttons reduce opacity to one half and use the disabled cursor.

### Inputs / Fields

Native inputs and selects use panel fill, a one-pixel field stroke and the control radius. Labels sit above fields with a 6px gap. The shared keyboard treatment is a three-pixel focus outline with a three-pixel offset; preserve it for buttons, links and disclosures as well as form fields.

### Navigation

The top bar pairs the small inline series mark and brand with compact text links. Its bottom rule separates it from the content. Mobile reduces padding, type and mark size; the country label disappears while the Evidence and API links remain.

### Cards / Containers

Chart and map panels use panel fill, a one-pixel slate rule and the panel radius. Their desktop padding is 24px and 22px respectively, reducing to 18px on mobile. Evidence notices use a simple bounded inset; reference lists and methodology disclosures use ruled sections.

### Evidence tables and disclosures

Native tables use collapsed borders, left-aligned headings and subdued supporting values. Evidence tables allow wrapping; weekly comparison tables use an independently scrollable, unwrapped layout. Reference rows are native details/summary elements with a plus/minus affordance. Open references expose instrument headings, definition lists and direct source links. Methodology disclosures preserve the browser's native marker.

The evidence filters cover year, department, result and reference search. Results are paged at twelve references. Loading and errors have explicit status text; the year-download link is hidden until the current file is validated. The empty state suggests changing filters. These states belong to the existing catalogue flow.

## Do's and Don'ts

### Do:

- **Do** preserve the navy, Inter and instrument-color continuity of the viewer.
- **Do** keep instrument names, result labels and interpretation limits explicit beside numerical evidence.
- **Do** use ruled tables and native disclosures for the historical catalogue.
- **Do** retain keyboard focus, local table scrolling and wrapping source identifiers across viewport sizes.

### Don't:

- **Don't** replace established instrument colors or the self-hosted font when extending this viewer.
- **Don't** apply the transient tooltip shadow to persistent evidence rows.
- **Don't** communicate match classification through color alone.
- **Don't** turn unrelated filter results into changes to the full-period evidence totals.

Recorded from `styles.css`, `validation.css`, `index.html`, `app.js`, `validation.js` and `DISENO.txt`; product interpretation checked against `../docs/VALIDACION_WEB.md`. The completed scoped review is `../../../outputs/41_validacion_web/qa-final/finish_review.md` (ship); its four desktop/mobile captures document the final built surfaces. No new identity decisions are introduced here.
