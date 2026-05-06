# Test Plan: pbiSparklineTable

## Functional Tests

### Rendering Tests
- [ ] Verify single row displays correctly with minimum required fields (Row Category, Sparkline Category, at least one Measure)
- [ ] Verify multiple rows display correctly (up to 10 rows)
- [ ] Verify proper rendering when all optional fields are present (Text Columns, Sparkline Value)
- [ ] Verify proper rendering when only required fields are present
- [ ] Verify correct handling of null/empty values in optional fields
- [ ] Verify text truncation/overflow handling for long row category labels
- [ ] Verify proper scaling when container is resized
- [ ] Verify sparkline charts render correctly for each type (Line, Area, Bar)
- [ ] Verify endpoint dot appears when Show Dot is enabled
- [ ] Verify sparkline color, width, and height settings apply correctly
- [ ] Verify table header and row styling (colors, fonts, grid lines) applies correctly
- [ ] Verify column width settings allocate space correctly for each column type

### Data Handling Tests
- [ ] Verify measure values are aggregated correctly (sum for numeric, average for percentage, last value for badge)
- [ ] Verify text columns show last non-null value per row group
- [ ] Verify sparkline values are collected in correct time order based on Sparkline Category
- [ ] Verify leading/trailing zeros are trimmed from sparkline data
- [ ] Verify measure format detection works (integer, decimal, percent, badge from field names/format strings)
- [ ] Verify sorting by Category column works (ascending/descending)
- [ ] Verify sorting by Measure columns works (ascending/descending)
- [ ] Verify sorting by Text Columns works (ascending/descending)
- [ ] Verify sorting by Sparkline end value works (ascending/descending)
- [ ] Verify proper handling of large datasets (approaching 30,000 limit)
- [ ] Verify correct parsing of different data types (integers, decimals, percentages, currency)
- [ ] Verify format strings from data model are respected in display and tooltips
- [ ] Verify date fields work correctly as Row Category and Sparkline Category
- [ ] Verify text fields work correctly as Row Category, Sparkline Category, and Text Columns

### Interaction Tests
- [ ] Verify clicking a row selects it and cross-filters other visuals
- [ ] Verify Ctrl+Click allows multi-selection of rows
- [ ] Verify hover triggers tooltip display with correct data (category, measures, text, sparkline info)
- [ ] Verify tooltip shows all measure values with proper labels and formatting
- [ ] Verify tooltip hides on mouse leave
- [ ] Verify right-click opens standard Power BI context menu
- [ ] Verify context menu includes standard options (Export data, Spotlight, Sort, etc.)
- [ ] Verify visual responds to slicer changes and filters
- [ ] Verify visual clears properly when all data is removed
- [ ] Verify visual shows empty state message when no data bound
- [ ] Verify visual shows appropriate empty state messages for missing required fields

### Formatting Tests
- [ ] Verify Header Background color changes correctly
- [ ] Verify Header Text Color changes correctly
- [ ] Verify Row Color changes correctly
- [ ] Verify Alternate Row Color creates banded rows
- [ ] Verify Text Color changes text column text color
- [ ] Verify Measure Text Color changes measure column text color
- [ ] Verify Font Size changes all text size proportionally
- [ ] Verify Row Height changes row height correctly
- [ ] Verify Show Grid Lines toggles grid visibility
- [ ] Verify Sparkline Width changes sparkline chart width
- [ ] Verify Sparkline Height changes sparkline chart height
- [ ] Verify Sparkline Color changes sparkline line/area/bar color
- [ ] Verify Sparkline Type switches between Line, Area, Bar correctly
- [ ] Verify Show Dot toggles endpoint dot visibility
- [ ] Verify Dot Color changes endpoint dot color
- [ ] Verify Line Width changes sparkline line thickness
- [ ] Verify Column Width Settings allocate correct pixel widths to each column type
- [ ] Verify Sort Column selects correct column for sorting
- [ ] Verify Sort Direction changes between Ascending and Descending

## Performance Tests
- [ ] Verify rendering time with 1 row (<50ms)
- [ ] Verify rendering time with 10 rows (<100ms)
- [ ] Verify rendering time with 100 rows (<500ms)
- [ ] Verify rendering time with 1000 rows (<2000ms)
- [ ] Verify memory usage remains stable during repeated updates
- [ ] Verify no memory leaks during rapid resize events
- [ ] Verify CPU usage spikes are minimal during interactions
- [ ] Verify smooth hover/tooltip performance with many rows
- [ ] Verify initial render completes within reasonable time (<1s for typical datasets)
- [ ] Verify sparkline rendering performance is efficient (SVG elements per row)

## Accessibility Tests
- [ ] Verify all interactive elements (rows) are keyboard accessible (Tab navigation)
- [ ] Verify Enter/Space keys activate rows (trigger click for selection)
- [ ] Verify visible focus indicator when row has keyboard focus
- [ ] Verify arrow keys navigate between rows when applicable
- [ ] Verify screen readers announce row label, measure values, text values, and sparkline trend
- [ ] Verify tooltip content is accessible to screen readers
- [ ] Verify proper behavior in Windows High Contrast mode
- [ ] Verify all text maintains sufficient contrast in HC mode
- [ ] Verify custom colors are ignored in HC mode
- [ ] Verify no reliance on color alone to convey information
- [ ] Verify text scales properly when browser zoom is increased
- [ ] Verify no content is clipped or hidden at 200% zoom
- [ ] Verify layout adapts to increased text sizes without loss of information
- [ ] Verify sparkline SVG elements are accessible (have appropriate labels/roles)

## Security Tests
- [ ] Verify no external network requests are made (using browser dev tools)
- [ ] Verify no data is stored in localStorage, sessionStorage, or cookies
- [ ] Verify no use of eval(), Function constructor, or similar
- [ ] Verify all DOM manipulation uses approved methods (textContent, createElement, SVG)
- [ ] Verify context menu uses standard selection manager approach
- [ ] Verify no insecure DOM injection (innerHTML with untrusted data)
- [ ] Verify proper handling of special characters in data (XSS prevention)
- [ ] Verify no access to privileged APIs or restricted functionality
- [ ] Verify only declared dependencies are loaded and used

## Packaging Tests
- [ ] Verify package builds successfully with npm run build
- [ ] Verify all required files are included in .pbiviz package
- [ ] Verify pbiviz.json contains correct metadata (name, version, description)
- [ ] Verify capabilities.json is valid and properly formatted
- [ ] Verify assets (icon) are present and correctly referenced
- [ ] Verify package can be imported into Power BI Desktop
- [ ] Verify visual appears correctly after import
- [ ] Verify version number increments properly
- [ ] Verify no extraneous files in package (node_modules, source maps, etc.)
- [ ] Verify package size is within reasonable limits
- [ ] Verify digital signature (if applicable) is valid

## Sample PBIX Verification
- [ ] Create test PBIX with sample data demonstrating all features
- [ ] Verify visual works correctly in Power BI Service (published)
- [ ] Verify visual works correctly in Power BI Desktop
- [ ] Verify cross-filtering works between visuals in report
- [ ] Verify slicers affect the visual correctly
- [ ] Verify bookmarks capture and restore visual state
- [ ] Verify drill-through does not interfere with visual (no errors)
- [ ] Verify visual state persists when saving/reopening PBIX
- [ ] Verify performance in published report is acceptable
- [ ] Verify accessibility features work in published report