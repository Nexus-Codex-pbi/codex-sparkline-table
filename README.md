# Codex Sparkline Table

A table of grouped measures, text columns, and per-row sparklines.

## Binding

Row Category and Sparkline Category are required. Bind at least one numeric
Measure or Text Column. Text-only tables also need a numeric Sparkline Value.
Without a dedicated Sparkline Value, the last numeric Measure supplies the trend.

Native Date categories sort chronologically and use the host locale in the
period header. Text categories retain the host's delivered order; configure
the field's sort order in the model when labels represent time.
Repeated spark categories are summed into one bucket. Every row shares the same
bucket positions. Missing readings break the line; genuine zeros remain.
Spacing is ordinal, not proportional to elapsed time.

Numeric measures are summed across delivered observations; percentage-formatted
measures use the mean of observed values. Choose measures whose aggregation
matches that contract. Names such as "Score" and "Badge" have no special meaning
and do not change numeric values into status labels.
Only finite numeric readings contribute to totals and trends. Missing/invalid
readings are not zeros. Text uses the latest bucket, including an empty string
or a missing value (shown as a dash); ties take the last delivered raw row.
Category grouping preserves value types and whitespace.

Delta compares the latest observed reading with the mean of preceding observed
readings, divided by the baseline's absolute magnitude. Missing or zero baselines
have no percentage. Unchanged readings show a neutral 0.0%, without a direction
arrow. Each row has its own vertical spark scale.

## Formatting

The Table pane exposes Row Background, Text Color, Font Size, Row Height,
Show Grid Lines, Display Units, and Decimal Places. The Sparkline pane exposes
Sparkline Color, Show Last Point Dot, and Line Width.
Title, Background, Card Signature, Border, and Sort have their own cards.

Retired header, row/value font, alternate-row, transparency, measure color,
band-tint, spark type/dimensions, and dot-color properties still restore from
saved reports without being reintroduced into the pane. Unset spark width fills
the Trend column; an explicitly saved width is capped to the available space.
Saved Line omits area fill; saved Area includes it; saved Bar uses bars.

Drag header separators to resize columns. Widths persist with the report.
The table scrolls vertically when rows exceed the viewport; the header stays
visible. Numeric values honor model number formats and the host locale unless
Display Units or Decimal Places supplies an explicit override.

Sort Column Index uses the legacy data indexing: 0 is Row Category,
1 through the numeric measure count are Measures, and the next index is
the latest observed spark value; subsequent indices address Text Columns.
Sort Direction is Ascending or Descending. Missing values sort last in either
direction; ties retain source order.

## Interaction

Click a row to select its category; Ctrl/Command supports multiple selection.
Click the background to clear selection. Selection outlines follow category
identity across sorting and updates, including host-driven selection changes.
Right-click opens the host context menu for the row under the pointer.
Tab reaches rows and column separators. Enter/Space selects a focused row,
Escape clears, Up/Down/Home/End navigates rows, and Shift+F10 opens its menu.
Left/Right resizes a focused separator; Shift increases the step.
Selection, menus and resizing respect the host's interaction permission.
Tooltips include numeric and text columns, the period, latest reading/category,
prior mean, and displayed Delta. High-contrast mode uses the host palette.

## Boundaries

The host data reduction limit is 30,000 raw rows. The visual aggregates the data
it receives and cannot reconstruct omitted readings or model calculations.
Sparklines are compact summaries, not a shared-scale comparison of magnitudes.

Support: https://nexuscodex.nexus/support
