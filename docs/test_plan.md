# Test Plan – Codex Sparkline Table

## 1. Functional Tests
- [ ] Visual loads without errors
- [ ] Visual renders with sample data
- [ ] Visual handles empty data gracefully
- [ ] All format pane options apply correctly
- [ ] Selection / cross-filter works (if applicable)
- [ ] Tooltips appear on hover

## 2. Performance Tests
- [ ] update() completes < 250ms
- [ ] No memory leaks
- [ ] Bundle size < 2.5 MB

## 3. Accessibility Tests
- [ ] Keyboard navigation works
- [ ] High contrast mode supported
- [ ] ARIA labels present
- [ ] No flashing content

## 4. Security Tests
- [ ] No external network calls
- [ ] No telemetry
- [ ] No external scripts or fonts
- [ ] No DOM escape or eval

## 5. Packaging Tests
- [ ] pbiviz builds successfully
- [ ] Bundle size < 2.5 MB
- [ ] capabilities.json valid

## 6. Sample PBIX Verification
- [ ] Demonstrates all features
- [ ] Demonstrates formatting options
- [ ] Demonstrates interactions

## 7. Outer Background Transparency (TRANS-01/02/03)
- [ ] Background card exposes Colour + Transparency (0-100) controls
- [ ] Transparency 0 = opaque (matches pre-upgrade default; old saved reports render pixel-identical)
- [ ] Transparency 50 shows report canvas bleeding through the container evenly
- [ ] Transparency 100 = fully transparent container
- [ ] Verified in both light and dark report themes

## 8. Per-Row and Per-Sparkline Transparency (D-05)
- [ ] Row Background Transparency slider (Table card) affects both Row Color and Alternate Row Color identically
- [ ] Row Background Transparency 0 = opaque (matches pre-upgrade default)
- [ ] Sparkline Transparency slider (Sparkline card) affects line/area/bar rendering, NOT the Dot Color last-point highlight
- [ ] Sparkline Transparency 0 = opaque (matches pre-upgrade default); area/bar retain their existing fill-opacity design (0.15/0.7) multiplicatively

## 9. Conditional Formatting / fx (TRANS-04)
- [ ] Sparkline Color swatch shows the fx button in the format pane
- [ ] Setting a rule on Sparkline Color resolves per-row via the row's own category instance
- [ ] Rows without a rule override still show the static Sparkline Color swatch value

## 10. Data Model Confirmation
- [ ] Confirmed this visual uses a categorical dataView (dataView.categorical.categories/values), NOT a true matrix dataRole — fx wiring is fully supported
## 11. Visual Title (TITLE-01, shared _shared/formatting/ v2)
- [ ] Visual Title card appears in the format pane (Show Title, Title Text, Font, Alignment, Font Color)
- [ ] Show Title default OFF — an old saved report renders pixel-identical (no title strip appears)
- [ ] Show Title ON + empty Title Text renders nothing (render gate is showTitle && titleText)
- [ ] Title font family/size/bold/italic/underline apply; alignment left/center/right applies
- [ ] Right-click on the title shows the PBI context menu (title is a child of the container, listener bubbles)

## 12. Per-Surface Text Treatment (TEXT-01)
- [ ] Header Font (family/size/bold/italic/underline) applies to column header text
- [ ] Row Label Font applies to the category column AND text columns
- [ ] Value Font applies to numeric measure cells (badge cells keep their own badge chrome — colour/background/weight)
- [ ] Each composite's Font Size 0 (default) = follow the shared Font Size — a saved report with a customised shared Font Size renders identically at defaults; setting a per-surface size > 0 takes over for that surface only
- [ ] Bold OFF renders each surface's own pre-existing weight (header 600, row label 500, value 400); Header Bold defaults ON (pre-existing 600, renders 700 — documented negligible increase)
- [ ] All defaults untouched → pixel-identical to the pre-upgrade render (D-06)

## 13. Measure Text Colour fx (TEXT-02)
- [ ] Measure Text Color swatch shows the fx button in the format pane
- [ ] Setting a rule on Measure Text Color resolves PER-ROW via the row's own category instance (rowCatColumn.objects[firstRawIndex] — the aggregated-row resolution, not a loop counter)
- [ ] Sparkline line/area/bar and Dot Color rendering are unaffected by a Measure Text Color rule
- [ ] Badge cells are unaffected (badge chrome keeps its own colour scheme)

## 14. Shared Spark Grammar (01-18 Task 3 — matches pbiKpiSparklineCard exactly)
- [ ] Sparkline Type's declared default is now Area (soft fill under the line) — matches pbiKpiSparklineCard's Show Area Fill flip; an old saved report with an explicit Line or Bar selection keeps that value (D-06/D-16)
- [ ] Min/max whisper ticks (short muted vertical dashes) render at the series' two extreme points on Line/Area types; skipped when the series is flat (min===max) and skipped entirely under high contrast
- [ ] Bar type sparklines do not render whisker ticks (no line to annotate, matches KPI Sparkline Card's own scope)
- [ ] Endpoint dot band-tints via the shared v3 band engine by default (Band-Tint Endpoint Dot ON) — colour reflects the row's latest sparkline point vs. the mean of its own prior points
- [ ] Band-Tint Endpoint Dot OFF restores the flat, per-row Dot Color exactly as it rendered before this plan
- [ ] High contrast: the dot always renders the flat HC foreground colour regardless of the Band-Tint Endpoint Dot toggle

## 15. Band-Tinted Value Column (01-18 Task 3)
- [ ] Band-Tint Value Column ON (default): the FIRST measure column's text colour reflects the row's own trend band (success/warning/danger vs. its own baseline), the SAME token driving the endpoint dot
- [ ] Band-Tint Value Column OFF: the first measure column falls back to the flat/fx-resolved Measure Text Color exactly as before this plan
- [ ] A per-row Measure Text Color fx RULE always wins over the band tint regardless of the toggle state
- [ ] Badge-format cells are unaffected (badge chrome keeps its own colour scheme, unchanged from Plan 14)
- [ ] Secondary measure columns (index > 0) are unaffected by the band tint — only the first/value column changes
- [ ] High contrast: all measure cells render the flat HC foreground colour, band tint never applies

## 16. Row Hover Lift + Corner-Bracket Signature (01-18 Task 3)
- [ ] Hovering a row lifts its background one elevation step (a faint, theme-aware muted-surface-token tint) rather than the old static rgba(19,0,100,0.06)
- [ ] The hover lift transition stays within the shared 120-200ms glow-transition band (existing 0.15s CSS transition)
- [ ] Mouse-leave restores the row's exact resting background (row/alternate colour + Row Background Transparency), matching pre-hover state
- [ ] High contrast: no hover lift is applied (rows keep their flat HC background)
- [ ] A cyan corner-bracket card signature (mirrored top-left/bottom-right) appears on the visual and survives every re-render (attached to the persistent host element, not the per-update-cleared table container)
- [ ] Corner brackets mute to the neutral grey on the empty/no-fields state
- [ ] tnum (tabular-nums) is already applied to measure cells (pre-existing, unaffected by this plan)
