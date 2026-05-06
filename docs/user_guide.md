# User Guide: pbiSparklineTable

## Adding the Visual
1. From the Power BI Desktop Visualizations pane, click the three dots (...) → Get more visuals
2. Search for "pbiSparklineTable" or browse to find the visual
3. Select the visual and click Add
4. The visual icon will appear in your Visualizations pane
5. Drag the icon onto your report canvas to add an instance of the visual

## Data Binding
The visual requires specific data fields to function properly:

### Required Fields
- **Row Category** (grouping): Text field that defines each row (e.g., "Beat", "BatteryCode", "Product")
- **Sparkline Category** (grouping): Time axis for sparklines (e.g., "Date", "Month", "Timestamp")
- **Measures** (measure): At least one numeric metric column displayed in the table

### Optional Fields
- **Text Columns** (grouping or measure): Text columns displayed after numeric measures
- **Sparkline Value** (measure): Numeric measure for the sparkline trend chart (if not specified, the last numeric measure is used)

### Field Requirements
- Row Category: Text or category data type (strings, dates, etc.)
- Sparkline Category: Text or category data type (typically date/time)
- Measures: Numeric data type (whole numbers, decimals, percentages, currency)
- Text Columns: Text or category data type
- Sparkline Value: Numeric data type
- Minimum: Row Category + Sparkline Category + at least one Measure
- Maximum: All field types can be used simultaneously

### How Data Maps to Visual
Each unique value in the Row Category field creates a row in the table. Within each row:
- The Row Category value appears in the first column
- Measure values appear as aggregated numbers (sum, average for percentages, last value for badges)
- Text Column values appear as text (last non-null value per row)
- A sparkline chart shows the trend of the Sparkline Value over the Sparkline Category
- Rows can be sorted by any column (category, measure, or sparkline end value)

## Formatting Options
All formatting options are available in the Format pane when the visual is selected.

### Table Settings
- **Header Background**: Background color for column headers
- **Header Text Color**: Text color for column headers
- **Row Color**: Background color for rows
- **Alternate Row Color**: Background color for alternating rows (for banded rows)
- **Text Color**: Text color for text columns
- **Measure Text Color**: Text color for measure/numeric columns
- **Font Size**: Base font size for all text in the table (8-24pt)
- **Row Height**: Height of each table row (20-60px)
- **Show Grid Lines**: Toggle display of grid lines between rows and columns

### Sparkline Settings
- **Sparkline Width**: Width of the sparkline chart in pixels (20-200px)
- **Sparkline Height**: Height of the sparkline chart in pixels (15-50px)
- **Sparkline Color**: Color of the sparkline line/area/bar
- **Sparkline Type**: Choose between Line, Area, or Bar chart types
- **Show Dot**: Toggle display of a dot on the last data point of the sparkline
- **Dot Color**: Color of the dot on the sparkline endpoint
- **Line Width**: Thickness of the sparkline line (1-5px)

### Column Width Settings
- **Category Width**: Width allocated for the Row Category column (50-300px)
- **Measure Width**: Width allocated for each measure column (60-150px)
- **Text Width**: Width allocated for each text column (80-200px)
- **Sparkline Width**: Width allocated for the sparkline column (30-250px)

### Sort Settings
- **Sort Column**: Select which column to sort by (0 = Category, 1+ = Measures, last = Sparkline end value)
- **Sort Direction**: Choose Ascending or Descending order

## Features
- **Compact Trend Visualization**: Combines detailed tabular data with inline sparkline trends
- **Interactive Table**: Click any row to cross-filter other visuals in the report
- **Tooltips**: Hover over rows or sparklines to see detailed information
- **Context Menu**: Right-click any row for standard Power BI options (export data, spotlight, etc.)
- **Flexible Column Types**: Support for numeric measures, text columns, and sparkline trends
- **Configurable Sparkline Types**: Line, area, or bar charts for different visualization needs
- **Customizable Formatting**: Extensive color, font, spacing, and width options
- **Sorting Capability**: Sort by any column including calculated sparkline end values
- **Responsive Design**: Adapts to available space with horizontal scrolling when needed
- **High Contrast Support**: Automatically adapts to Windows High Contrast mode
- **Accessible**: Keyboard navigable with visible focus indicators

## Limitations
- Maximum of 30,000 rows (limited by data reduction algorithm)
- Requires at least Row Category, Sparkline Category, and one Measure to display
- Sparkline values are automatically trimmed of leading/trailing zeros to remove dead space
- Percentage measures are averaged rather than summed when aggregated
- Badge format takes the last non-null value rather than summing
- Does not support drill-through functionality
- Does not support bookmark interactions beyond standard filtering
- Very wide tables may require horizontal scrolling to view all columns

## Known Issues
None reported in the current version.

## Support
For technical support or questions about this visual:
- Visit: https://nexuscodex.nexus/support
- Email: support@nexuscodex.nexus
- GitHub Issues: https://github.com/Nexus-Codex-pbi/sparkline-table/issues