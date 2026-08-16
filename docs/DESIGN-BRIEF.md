# Design brief: waymark

This brief is derived from the component register. It is the contract the design must be drawn inside. It contains no colours, lengths, fonts, durations or easing curves: those live in the design system itself, and this brief does not overrule them.

Register digest: `sha256:d47d34ca9a5a73dfe4b43778763eccb7ced3367625d123b8d5dd93d5d7e60344`
States drawn measured from: **the register's own claim (NOT measured; run `vds figma pull`)**

## Rules

- Compose only from `may_use`. A component that is not in the register does not exist for the purposes of this brief, and drawing one is drift (VDS S-7(5) composition).
- Draw every state in `states_to_draw`. A required state that is not drawn fails the `states` proof and blocks W2 (VDS S-6(2)).
- Do not invent a tenth state. The nine are fixed by VDS S-5(3): default, hover, focus, active, selected, disabled, loading, error, success.
- Do not change a component's prop contract while drawing. A contract change is an amendment with its own record and, where it is breaking, its own warrant (VDS S-9(2), S-9(4)).
- Respect every contrast floor. They are requirements drawn from WCAG, not preferences, and a floor may be tightened and never loosened (VDS S-9(5)).
- Where a component you need does not exist, STOP and register it first. Registering after drawing is the ordering VDS S-6(2) forbids, and it is the ordering under which every drift defect in the motivating project was authored.
- Design may begin: WARRANT-W1-001 is granted over this surface (W1 REGISTER-COMPLETE).

## Components you may use (15)

### MapView `CMP-0001` (registered)

- Figma node: **none recorded**. This component has never been drawn.
- States required: default, focus
- States drawn: none
- **STILL TO DRAW: default, focus**
- Accessible name from: undecided
- Contrast floor: control-border against surface at least 3:1 (WCAG 2.2 SC 1.4.11)
- Consumed by 1 route

### PlaceSummaryCard `CMP-0002` (registered)

- Figma node: **none recorded**. This component has never been drawn.
- States required: default, focus
- States drawn: none
- **STILL TO DRAW: default, focus**
- Accessible name from: undecided
- Contrast floor: control-border against surface at least 3:1 (WCAG 2.2 SC 1.4.11)
- Consumed by 1 route

### AddPlaceSheet `CMP-0003` (registered)

- Figma node: **none recorded**. This component has never been drawn.
- States required: default, focus
- States drawn: none
- **STILL TO DRAW: default, focus**
- Accessible name from: undecided
- Contrast floor: control-border against surface at least 3:1 (WCAG 2.2 SC 1.4.11)
- Consumed by 1 route

### FiltersBar `CMP-0004` (registered)

- Figma node: **none recorded**. This component has never been drawn.
- States required: default, focus
- States drawn: none
- **STILL TO DRAW: default, focus**
- Accessible name from: undecided
- Contrast floor: control-border against surface at least 3:1 (WCAG 2.2 SC 1.4.11)
- Consumed by 1 route

### AuthScreen `CMP-0005` (registered)

- Figma node: **none recorded**. This component has never been drawn.
- States required: default, focus
- States drawn: none
- **STILL TO DRAW: default, focus**
- Accessible name from: undecided
- Contrast floor: control-border against surface at least 3:1 (WCAG 2.2 SC 1.4.11)
- Consumed by 1 route

### Dashboard `CMP-0006` (registered)

- Figma node: **none recorded**. This component has never been drawn.
- States required: default, focus
- States drawn: none
- **STILL TO DRAW: default, focus**
- Accessible name from: undecided
- Contrast floor: control-border against surface at least 3:1 (WCAG 2.2 SC 1.4.11)
- Consumed by 1 route

### MembersPanel `CMP-0007` (registered)

- Figma node: **none recorded**. This component has never been drawn.
- States required: default, focus
- States drawn: none
- **STILL TO DRAW: default, focus**
- Accessible name from: undecided
- Contrast floor: control-border against surface at least 3:1 (WCAG 2.2 SC 1.4.11)
- Consumed by 1 route

### ManagePanel `CMP-0008` (registered)

- Figma node: **none recorded**. This component has never been drawn.
- States required: default, focus
- States drawn: none
- **STILL TO DRAW: default, focus**
- Accessible name from: undecided
- Contrast floor: control-border against surface at least 3:1 (WCAG 2.2 SC 1.4.11)
- Consumed by 1 route

### App `CMP-0009` (registered)

- Figma node: **none recorded**. This component has never been drawn.
- States required: default, focus
- States drawn: none
- **STILL TO DRAW: default, focus**
- Accessible name from: undecided
- Contrast floor: control-border against surface at least 3:1 (WCAG 2.2 SC 1.4.11)
- Consumed by 0 routes

### Button `CMP-0010` (registered)

- Figma node: **none recorded**. This component has never been drawn.
- States required: default, focus
- States drawn: none
- **STILL TO DRAW: default, focus**
- Accessible name from: undecided
- Contrast floor: control-border against surface at least 3:1 (WCAG 2.2 SC 1.4.11)
- Consumed by 8 routes

### Input `CMP-0011` (registered)

- Figma node: **none recorded**. This component has never been drawn.
- States required: default, focus
- States drawn: none
- **STILL TO DRAW: default, focus**
- Accessible name from: undecided
- Contrast floor: control-border against surface at least 3:1 (WCAG 2.2 SC 1.4.11)
- Consumed by 5 routes

### Select `CMP-0012` (registered)

- Figma node: **none recorded**. This component has never been drawn.
- States required: default, focus
- States drawn: none
- **STILL TO DRAW: default, focus**
- Accessible name from: undecided
- Contrast floor: control-border against surface at least 3:1 (WCAG 2.2 SC 1.4.11)
- Consumed by 4 routes

### Textarea `CMP-0013` (registered)

- Figma node: **none recorded**. This component has never been drawn.
- States required: default, focus
- States drawn: none
- **STILL TO DRAW: default, focus**
- Accessible name from: undecided
- Contrast floor: control-border against surface at least 3:1 (WCAG 2.2 SC 1.4.11)
- Consumed by 1 route

### Checkbox `CMP-0014` (registered)

- Figma node: **none recorded**. This component has never been drawn.
- States required: default, focus
- States drawn: none
- **STILL TO DRAW: default, focus**
- Accessible name from: undecided
- Contrast floor: control-border against surface at least 3:1 (WCAG 2.2 SC 1.4.11)
- Consumed by 0 routes

### Option `CMP-0015` (registered)

- Figma node: **none recorded**. This component has never been drawn.
- States required: default
- States drawn: none
- **STILL TO DRAW: default**
- Accessible name from: undecided
- Contrast floor: control-border against surface at least 3:1 (WCAG 2.2 SC 1.4.11)
- Consumed by 4 routes

## What this brief does not settle

- VDS S-9(10) RESERVED (SUBMISSION-VDS-005): where the primitive floor sits is unsettled. Bare HTML elements are informational rows in every proof, so this brief does not reach the primitive layer, and a screen built entirely from bare elements satisfies it while proving nothing.
- No Figma ledger is present, so `states_drawn` is the register's own hand-maintained claim rather than a measurement of the decided-target file. VDS S-5(5): a hand-maintained register decays. Run `vds figma pull` to measure it.
