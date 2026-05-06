# Codex Sparkline Table

## Overview
Data table with inline sparkline trend lines for compact trend visualization.

## Features
- Displays a table with rows defined by Row Category
- Columns include numeric measures, optional text columns, and a sparkline chart
- Sparkline shows trend over Sparkline Category (e.g., time)
- Configurable sparkline type: Line, Area, or Bar
- Optional dot on the last point of the sparkline
- Adjustable sparkline width, height, line width, and color
- Column width settings for category, measure, text, and sparkline columns
- Sorting by any column (category, measure, or sparkline last value) ascending or descending
- Alternating row colors for readability
- Tooltips showing row, measure values, text values, and sparkline details
- Click to cross-filter other visuals by row category
- Right-click context menu for cross-filtering and other interactions
- High contrast mode support
- Responsive layout with horizontal and vertical scrolling when container is too small
- Supports keyboard focus and screen readers

## Data Roles
| Role | Display Name | Kind | Required? | Data Type | Description |
|------|--------------|------|-----------|-----------|-------------|
| rowCategory | Row Category | Grouping | No (max 1) | Text or Grouping | What each row represents (e.g. Beat, BatteryCode) |
| sparklineCategory | Sparkline Category | Grouping | No (max 1) | Text or Grouping | Time axis for sparklines (e.g. Date) |
| measures | Measures | Measure | No (min 1) | Numeric | Numeric metric columns displayed in the table. |
| textColumns | Text Columns | GroupingOrMeasure | No (multiple) | Text or Numeric | Text columns displayed after numeric measures. |
| sparklineValue | Sparkline Value | Measure | No (max 1) | Numeric | Numeric measure for the sparkline trend chart. |

Note: At least one of Measures or Text Columns is required. Sparkline Value is optional; if not bound, the last numeric measure is used for the sparkline.

## Formatting Options
The visual provides the following format pane cards:

### Table Settings
- Header Background: Background color of column headers
- Header Text Color: Text color of column headers
- Row Color: Background color of rows
- Alternate Row Color: Background color of alternating rows
- Text Color: Text color for text columns
- Measure Text Color: Text color for measure columns
- Font Size: Font size for all text in pixels
- Row Height: Height of each row in pixels
- Show Grid Lines: Toggle visibility of horizontal grid lines

### Sparkline Settings
- Sparkline Width: Width of the sparkline chart in pixels
- Sparkline Height: Height of the sparkline chart in pixels
- Sparkline Color: Color of the sparkline line/area/bars
- Sparkline Type: Line, Area, or Bar
- Show Dot: Toggle visibility of a dot on the last data point
- Dot Color: Color of the dot on the last point
- Line Width: Thickness of the sparkline line in pixels (for Line and Area types)

### Column Width Settings
- Category Width: Width of the row category column in pixels
- Measure Width: Width of each measure column in pixels
- Text Width: Width of each text column in pixels
- Sparkline Width: Width of the sparkline column in pixels

### Sort Settings
- Sort Column: Numeric index of the column to sort by (0 = Category, 1 = first measure, etc.)
- Sort Direction: Ascending or Descending

## How to Use
1. Import the `.pbiviz` file into Power BI Desktop (from the Visuals pane -> ... -> Import from file).
2. Locate the visual in the Visualizations pane and add it to the report canvas.
3. Bind data to the data roles:
   - Row Category: Required for row grouping (text or grouping field)
   - Sparkline Category: Optional time field for sparkline X-axis (text or grouping)
   - Measures: One or more numeric measures to display as values
   - Text Columns: Optional text or numeric columns to display after measures
   - Sparkline Value: Optional numeric measure for the sparkline (defaults to last measure if not bound)
4. Use the format pane to adjust appearance:
   - Set table colors, fonts, row height, and grid lines
   - Configure sparkline appearance (type, colors, dimensions, dot)
   - Adjust column widths
   - Choose sort column and direction
5. Interact:
   - Click a row to cross-filter other visuals by that row category
   - Right-click for the context menu
   - Hover to see a tooltip with row, measure values, text values, and sparkline details

## Limitations
- The visual expects numeric values for Measures and Sparkline Value. Non-numeric values are treated as zero.
- Text Columns can be text or numeric; numeric values are displayed as formatted numbers.
- Each data role can have multiple fields bound (except Row Category, Sparkline Category, and Sparkline Value which are limited to one).
- Sparkline Category, if bound, must be a column with sortable values (e.g., date, numeric, text).
- The visual uses a data reduction algorithm (top 30,000 rows) which may limit the number of rows displayed.
- Sparkline charts are compressed to fit the column width; very wide sparklines may lose detail.
- The visual does not support drill-through or bookmark selection.

## Support
For help or questions, visit https://nexuscodex.nexus/support