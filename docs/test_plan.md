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