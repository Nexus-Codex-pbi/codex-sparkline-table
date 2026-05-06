# User Guide – Codex Sparkline Table

## Overview
Data table with inline sparkline trend lines for compact trend visualization.

## 1. Adding the Visual
1. Import the `.pbiviz` file into Power BI Desktop
2. Locate the visual in the Visualizations pane
3. Drag it onto the report canvas

## 2. Data Binding
- Row Category: What each row represents (e.g. Beat, BatteryCode)
- Sparkline Category: Time axis for sparklines (e.g. Date)
- Measures: Numeric metric columns displayed in the table.
- Text Columns: Text columns displayed after numeric measures.
- Sparkline Value: Numeric measure for the sparkline trend chart.

## 3. Formatting Options
- Table Settings: Header Background, Header Text Color, Row Color, Alternate Row Color, Text Color, Measure Text Color, Font Size, Row Height, Show Grid Lines
- Sparkline Settings: Sparkline Width, Sparkline Height, Sparkline Color, Sparkline Type (Line/Area/Bar), Show Dot, Dot Color, Line Width
- Column Width Settings: Category Width, Measure Width, Text Width, Sparkline Width
- Sort Settings: Sort Column, Sort Direction (Ascending/Descending)

## 4. Features
- Inline sparkline trends for each measure
- Support for multiple numeric measures and text columns
- Configurable sparkline types (line, area, bar)
- Customizable column widths and sorting
- High contrast mode support
- Tooltips and cross-filtering

## 5. Limitations
- Sparkline values are aggregated per row category (sum, except for percentages which are averaged)
- Text columns show the last non-null value per row
- Large datasets may be truncated to 30,000 rows for performance

## 6. Support
For help or questions, visit https://nexuscodex.nexus/support