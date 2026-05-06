# Developer Guide: pbiSparklineTable

## Architecture
The pbiSparklineTable follows a modular structure typical of Power BI visuals:

### File Structure
```
/src
  /visual.ts          - Main visual class implementing IVisual interface
  /settings.ts        - Settings model using powerbi-visuals-utils-formattingmodel
  /utils.ts           - Utility functions (formatValue, CODEX_TOKENS, etc.)
/style
  /visual.less        - Styling for table and sparkline elements
/stringResources
  /en-US/resources.resjson - Localization strings
```

### Rendering Model
1. **Constructor**: Initializes DOM elements, sets up event listeners, creates services, detects high contrast mode
2. **Update Method**: Main entry point called by Power BI when data or size changes
   - Processes dataView
   - Updates formatting settings
   - Parses and groups data by row category
   - Calculates measure values, text values, and sparkline data
   - Applies sorting
   - Renders the table with embedded sparklines
3. **Render Process**:
   - Clears container
   - Creates table element with thead and tbody
   - Builds header row from column names (row category, measures, text columns, sparkline)
   - For each row:
     * Creates table cells for category, measures (formatted), text columns
     * Creates SVG element for sparkline chart
     * Draws sparkline based on type (line, area, bar)
     * Adds optional endpoint dot
     * Attaches event listeners for tooltip and selection
   - Applies high contrast overrides if needed

### Data Flow
Power BI DataView → Data parsing/grouping → Internal Model (RowData[]) → Table Rendering with Sparklines

## Capabilities.json Summary
Key aspects from capabilities.json:

### Data Roles
- **rowCategory** (Grouping): What each row represents - creates distinct table rows
- **sparklineCategory** (Grouping): Time axis for sparklines - determines X-axis of sparkline charts
- **measures** (Measure): Numeric metric columns - displayed as table columns
- **textColumns** (GroupingOrMeasure): Text columns displayed after numeric measures
- **sparklineValue** (Measure): Numeric measure for sparkline trend chart

### Data Mapping
- Categorical: Three category fields (rowCategory, sparklineCategory, textColumns) with top 30,000 reduction
- Values: Three measure fields (measures, textColumns as measures, sparklineValue)

### Features Enabled
- Highlight support (standard visual highlighting)
- Keyboard focus support
- Empty data view support (shows guidance messages)
- Multi-selection support
- Tooltips (default and canvas types)
- No special privileges required

### Formatting Objects
- **tableSettings**: Controls table appearance (colors, fonts, grid lines, row height)
- **sparklineSettings**: Controls sparkline appearance (type, color, size, dot, line width)
- **columnWidthSettings**: Controls width allocation for different column types
- **sortSettings**: Controls which column to sort by and direction

## APIs Used
The visual utilizes these Power BI APIs:

### Core APIs
- **IVisual/IHost**: Main interface for visual-host communication
- **IVisualEventService**: For rendering lifecycle events (started, finished, failed)
- **ISelectionManager**: Handles selection, cross-filtering, and context menus
- **ISelectionId**: Identifies data points (rows) for selection
- **ITooltipService**: Manages tooltip display and hiding
- **ILocalizationManager**: For localizing strings (empty state messages)

### Utility Services
- **FormattingSettingsService**: From powerbi-visuals-utils-formattingmodel for managing format pane properties
- **ColorPalette**: Accessed via host for theme and high contrast colors

### D3 Usage
- **d3-scale**: For creating linear scales for sparkline charts
- **d3-shape**: For line, area, and curveMonotoneX generators
- Used to create SVG elements for sparkline charts within table cells

## Performance Considerations
### Rendering Optimization
- **Data Grouping**: Efficiently groups data by row category using Map structures
- **Sparkline Data Preparation**: Trims leading/trailing zeros to remove dead space
- **Measure Aggregation**: Sums numeric measures, averages percentages, takes last value for badges
- **DOM Updates**: Clears and rebuilds table each update (acceptable for typical row counts <1000)
- **SVG per Cell**: Creates lightweight SVG elements only for sparkline cells

### Data Processing
- **Role Detection**: Scans all columns to identify their roles from the DataView
- **Text Column Handling**: Checks both categories and values arrays for text columns
- **Format Detection**: Automatically detects measure format (integer, decimal, percent, badge) from field names and format strings
- **Selection ID Creation**: Creates one SelectionId per row for cross-filtering

### Memory Management
- No persistent data storage between renders
- RowData objects are recreated each update
- DOM elements are properly cleaned up on each render
- SVG elements are lightweight and short-lived

## Accessibility Implementation
### Keyboard Support
- Table rows are made focusable through implicit tabIndex (tr elements are naturally focusable when interactive)
- Click and keyboard handlers both trigger the same selection action
- Focus styling relies on browser defaults enhanced by active interaction states
- Navigation between rows using Arrow keys when focus is in table

### ARIA and Screen Readers
- Uses native table semantics (table, thead, tbody, tr, th, td)
- Scope headers implicitly through structure
- Sparkline SVG elements have aria-label attributes describing the trend
- Tooltips provide additional context for screen reader users

### High Contrast Mode
- Detects high contrast via `host.colorPalette.isHighContrast`
- Uses system colors (`foreground.value`, `background.value`) when in HC mode
- Ignores custom color properties in HC mode to ensure readability
- Ensures sufficient contrast in all modes

### Motion and Animation
- No automatic animations
- Only user-initiated interactions cause visual changes (hover, click)
- Respects system preferences through lack of animated transitions

## Security Compliance
As detailed in the security documentation:
- No external network requests
- No eval or dynamic code execution
- No data persistence (no localStorage, cookies, etc.)
- All DOM manipulation through approved methods (textContent, createElement, SVG)
- Context menu uses standard selection manager approach
- Only uses bundled dependencies (D3, Office UI Fabric utilities)

## Build & Packaging
### Development Setup
1. `npm install` - installs dependencies
2. `npm start` - starts webpack dev server for rapid development
3. `npm run build` - creates production build in /dist folder

### Dependencies
- **powerbi-visuals-api**: Core Power BI interfaces
- **powerbi-visuals-utils-formattingmodel**: For strongly-typed settings
- **d3-scale**: For sparkline scaling
- **d3-shape**: For sparkline line/area generators
- **@types/** packages: TypeScript definitions

### Packaging Process
1. Webpack bundles all source files
2. pbiviz.json defines metadata and asset locations
3. Resources (images, schema) are copied to appropriate locations
4. Final .pbiviz package created for distribution

### Configuration
- **tsconfig.json**: TypeScript configuration targeting ES2015
- **package.json**: Scripts, dependencies, and package metadata
- **webpack.config.js**: (implied) Bundling configuration
- **eslint.config.mjs**: Linting rules

## Extensibility Points
While designed as a closed visual, the following areas could be extended:
- **utils.ts**: Add different sparkline types or formatting functions
- **settings.ts**: Add new formatting properties (e.g., conditional formatting)
- **visual.ts**: Add new column types or visualization enhancements
- **style/visual.less**: Add CSS classes for complex styling or themes

## Compatibility
- Built with API version 5.11.0
- Compatible with Power BI Desktop and Service
- Tested with modern browsers supported by Power BI
- Backward compatibility maintained within semantic versioning