# Codex Sparkline Table — Cert Notes (resubmission wave, Phase 01)

**Version:** 1.0.0.15 (visual.version) · production GUID unchanged (`codexSparklineTable…`) · API 5.11.0 / pbiviz 7.0.2 (pinned).

One-wave AppSource resubmission carrying the transparency/formatting rework **and** the v2 appearance redesign. Partner Center re-evaluates the whole package (Pitfall 6).

## Transparency wave (Plans 07–08)
- New **Background** card: `ColorPicker` fill + 0–100 `transparency` slider via `hexToRGBString`. Additive.
- fx conditional formatting wired on eligible colour properties.

## Title + per-region text wave (Plan 14)
- Title + per-region text treatment reworked with adaptive text colour.

## v2 Appearance wave (Plan 18)
- Shared spark grammar reused from KPI Sparkline Card: **Line → Area default flip**, min/max whisper ticks, band-tinted endpoint dot; band-tinted value column (per row); row hover elevation lift; host-attached corner brackets.
- No genuine target/goal data role exists, so the band token is self-referential (trend-vs-baseline), gated behind new **Band-Tint Value Column** / **Band-Tint Endpoint Dot** toggles (default ON, +2 additive `capabilities.json` booleans) so an fx rule or a toggle-off resolves the flat colour exactly as before.
- Corner brackets attach to the **persistent host element** so they survive the per-update table rebuild.
- **D-16:** saved colour/fx overrides still resolve.

## High-contrast rule
Shared HC rule wired (`src/shared/highContrast.ts`).

## Pending fixes riding this wave
None outstanding (PENDING-FIXES: nothing pending).
