"use strict";

import powerbi from "powerbi-visuals-api";
import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import { scaleLinear } from "d3-scale";
import { line, area, curveMonotoneX } from "d3-shape";
import "./../style/visual.less";

import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import IVisualEventService = powerbi.extensibility.IVisualEventService;
import ILocalizationManager = powerbi.extensibility.ILocalizationManager;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import ISelectionId = powerbi.visuals.ISelectionId;
import ITooltipService = powerbi.extensibility.ITooltipService;
import VisualTooltipDataItem = powerbi.extensibility.VisualTooltipDataItem;
import DataView = powerbi.DataView;

import { dataViewWildcard } from "powerbi-visuals-utils-dataviewutils";
import { ColorHelper } from "powerbi-visuals-utils-colorutils";

import { VisualFormattingSettingsModel } from "./settings";
import { toRgba } from "../../_shared/formatting/colorHelpers";
import { formatValue, CODEX_TOKENS } from "./utils";

/** Represents a single table row with its measure values and sparkline data */
interface RowData {
    category: string;
    measureValues: number[];        // aggregated numeric values
    measureCounts: number[];        // count of non-null values (for averaging)
    textValues: string[];           // text column values (last non-null per row)
    sparklineValues: number[];      // time-series values for the sparkline
    selectionId: ISelectionId | null;
    // Raw dataView row index at first encounter of this row's category —
    // used to resolve the Sparkline Colour fx rule against this row's own
    // per-instance object overrides (rowCatColumn.objects[firstRawIndex]).
    firstRawIndex: number;
}

export class Visual implements IVisual {
    private target: HTMLElement;
    private container: HTMLElement;
    private eventService: IVisualEventService;
    private selectionManager: ISelectionManager;
    private tooltipService: ITooltipService;
    private localizationManager: ILocalizationManager;
    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;
    private host: powerbi.extensibility.visual.IVisualHost;
    private isHighContrast: boolean = false;
    private hcForeground: string = "#000000";
    private hcBackground: string = "#ffffff";
    private contextMenuHandler: (e: MouseEvent) => void;

    // State for the Sparkline Colour fx wiring (TRANS-04) — per-row object
    // overrides live on the raw DataViewCategoryColumn.objects, indexed by
    // each row's firstRawIndex (RowData).
    private rowCatColumnForFx: powerbi.DataViewCategoryColumn | undefined;
    private sparklineColorHelper: ColorHelper | null = null;

    constructor(options: VisualConstructorOptions) {
        this.formattingSettingsService = new FormattingSettingsService();
        this.target = options.element;
        this.host = options.host;
        this.eventService = options.host.eventService;
        this.selectionManager = options.host.createSelectionManager();
        this.tooltipService = options.host.tooltipService;
        this.localizationManager = options.host.createLocalizationManager();

        // High contrast detection
        const colorPalette = (options.host as any).colorPalette;
        if (colorPalette) {
            this.isHighContrast = !!colorPalette.isHighContrast;
            if (this.isHighContrast) {
                this.hcForeground = colorPalette.foreground.value;
                this.hcBackground = colorPalette.background.value;
            }
        }

        this.container = document.createElement("div");
        this.container.className = "sparkline-table-container";
        this.target.appendChild(this.container);

        // Context menu
        this.contextMenuHandler = (e: MouseEvent) => {
            this.selectionManager.showContextMenu({} as powerbi.extensibility.ISelectionId, { x: e.clientX, y: e.clientY });
            e.preventDefault();
        };
        this.target.addEventListener("contextmenu", this.contextMenuHandler);
    }

    public update(options: VisualUpdateOptions): void {
        this.eventService.renderingStarted(options);

        try {
            // Refresh high contrast state each update
            const colorPalette = (this.host as any).colorPalette;
            if (colorPalette) {
                this.isHighContrast = !!colorPalette.isHighContrast;
                if (this.isHighContrast) {
                    this.hcForeground = colorPalette.foreground.value;
                    this.hcBackground = colorPalette.background.value;
                }
            }

            const dataView: DataView = options.dataViews && options.dataViews[0];
            this.formattingSettings = this.formattingSettingsService.populateFormattingSettingsModel(
                VisualFormattingSettingsModel, dataView
            );

            // ─── Dedicated background layer (D-05) ─────────────────────
            // Suite-wide shared Background card (Colour + Transparency,
            // sourced from _shared/formatting/), painted on `this.container`
            // — the outer render root appended directly to options.element
            // — never on the existing row-band colours
            // (tableCardSettings.rowColor/alternateRowColor) or the
            // sparkline colour (sparklineCardSettings.sparklineColor,
            // rendered on each <tr>/<svg>). Applied unconditionally
            // (before the empty-state early return) so an empty-state
            // render also honours it. Its transparency default is
            // overridden to 100 in settings.ts specifically so an OLD
            // saved report (this property never previously existed)
            // renders alpha 0 — pixel-identical to "nothing painted" (D-06).
            const background = this.formattingSettings.background;
            const outerBgHex = background.backgroundColor.value?.value ?? "#ffffff";
            const outerBgTransparencyPct = background.transparency.value ?? 100;
            this.container.style.backgroundColor = this.isHighContrast
                ? ""
                : toRgba(outerBgHex, outerBgTransparencyPct);

            // Clear previous content
            while (this.container.firstChild) {
                this.container.removeChild(this.container.firstChild);
            }

            if (!dataView || !dataView.categorical || !dataView.categorical.categories || !dataView.categorical.values) {
                this.renderEmpty(this.localizationManager.getDisplayName("Visual_Empty_DropFields") || "Drop a Row Category, Sparkline Category, and Measures");
                this.eventService.renderingFinished(options);
                return;
            }

            const categorical = dataView.categorical;
            const categories = categorical.categories;
            const valueColumns = categorical.values;

            // Find the row category and sparkline category columns
            let rowCatIndex = -1;
            let sparklineCatIndex = -1;

            for (let i = 0; i < categories.length; i++) {
                const roles = categories[i].source.roles;
                if (roles && roles["rowCategory"]) rowCatIndex = i;
                if (roles && roles["sparklineCategory"]) sparklineCatIndex = i;
            }

            if (rowCatIndex < 0 || sparklineCatIndex < 0 || valueColumns.length === 0) {
                this.renderEmpty(this.localizationManager.getDisplayName("Visual_Empty_RequiresFields") || "Requires Row Category, Sparkline Category, and at least one Measure");
                this.eventService.renderingFinished(options);
                return;
            }

            const rowCatColumn = categories[rowCatIndex];
            const sparklineCatColumn = categories[sparklineCatIndex];
            const numRows = rowCatColumn.values.length;

            // Identify numeric measures, text columns, and sparkline value
            // Text columns can appear in either categories (GroupingOrMeasure as grouping)
            // or values (GroupingOrMeasure as measure), so check both arrays.
            const tableMeasures: powerbi.DataViewValueColumn[] = [];
            const textColsFromValues: powerbi.DataViewValueColumn[] = [];
            const textColsFromCategories: powerbi.DataViewCategoryColumn[] = [];
            let sparklineMeasure: powerbi.DataViewValueColumn | null = null;

            for (let i = 0; i < valueColumns.length; i++) {
                const roles = valueColumns[i].source.roles;
                if (roles && roles["sparklineValue"]) {
                    sparklineMeasure = valueColumns[i];
                }
                if (roles && roles["measures"]) {
                    tableMeasures.push(valueColumns[i]);
                }
                if (roles && roles["textColumns"]) {
                    textColsFromValues.push(valueColumns[i]);
                }
            }

            // Check categories array for text columns placed as groupings
            for (let i = 0; i < categories.length; i++) {
                const roles = categories[i].source.roles;
                if (roles && roles["textColumns"]) {
                    textColsFromCategories.push(categories[i]);
                }
            }

            // Unified text column info for header names and value extraction
            const textColNames: string[] = [
                ...textColsFromCategories.map(c => c.source.displayName),
                ...textColsFromValues.map(c => c.source.displayName)
            ];
            const textColCount = textColNames.length;

            if (tableMeasures.length === 0 && textColCount === 0) {
                this.renderEmpty(this.localizationManager.getDisplayName("Visual_Empty_NeedMeasure") || "Drop at least one Measure or Text Column");
                this.eventService.renderingFinished(options);
                return;
            }

            // Fall back: if no dedicated sparkline role, use last numeric measure
            if (!sparklineMeasure && tableMeasures.length > 0) {
                sparklineMeasure = tableMeasures[tableMeasures.length - 1];
            }

            // Detect measure format (percentage, integer, decimal, badge)
            const measureFormat: string[] = tableMeasures.map(m => {
                const name = (m.source.displayName || "").toLowerCase();
                const fmt = m.source.format || "";
                if (name.indexOf("score") >= 0 || name.indexOf("badge") >= 0) return "badge";
                if (fmt.indexOf("%") >= 0) return "percent";
                if (fmt.indexOf(".") >= 0) return "decimal";
                return "integer";
            });

            // Column display names
            const measureNames = tableMeasures.map(m => m.source.displayName);
            const rowCategoryName = rowCatColumn.source.displayName;

            // Group data by row category
            // Each row in the categorical is a combination of (rowCategory, sparklineCategory)
            // We need to group by rowCategory and collect sparkline values in order
            const rowMap = new Map<string, RowData>();
            const rowOrder: string[] = [];

            for (let i = 0; i < numRows; i++) {
                const rowCat = String(rowCatColumn.values[i] ?? "");

                if (!rowMap.has(rowCat)) {
                    const selectionId = this.host.createSelectionIdBuilder()
                        .withCategory(rowCatColumn, i)
                        .createSelectionId();
                    rowMap.set(rowCat, {
                        category: rowCat,
                        measureValues: new Array(tableMeasures.length).fill(0),
                        measureCounts: new Array(tableMeasures.length).fill(0),
                        textValues: new Array(textColCount).fill(""),
                        sparklineValues: [],
                        selectionId,
                        firstRawIndex: i
                    });
                    rowOrder.push(rowCat);
                }

                const row = rowMap.get(rowCat)!;

                // Accumulate numeric measures
                for (let m = 0; m < tableMeasures.length; m++) {
                    const v = tableMeasures[m].values[i] as number;
                    if (v != null && !isNaN(v)) {
                        if (measureFormat[m] === "badge") {
                            // Badge: take last non-null value (don't sum)
                            row.measureValues[m] = v;
                        } else {
                            row.measureValues[m] += v;
                        }
                        row.measureCounts[m]++;
                    }
                }

                // Capture text column values (take last non-null per row — most recent)
                // First from categories (grouping text columns), then from values (measure text columns)
                let tIdx = 0;
                for (let t = 0; t < textColsFromCategories.length; t++, tIdx++) {
                    const raw = textColsFromCategories[t].values[i];
                    if (raw != null && String(raw).trim() !== "") {
                        row.textValues[tIdx] = String(raw);
                    }
                }
                for (let t = 0; t < textColsFromValues.length; t++, tIdx++) {
                    const raw = textColsFromValues[t].values[i];
                    if (raw != null && String(raw).trim() !== "") {
                        row.textValues[tIdx] = String(raw);
                    }
                }

                // Collect sparkline measure value at this time point
                const sv = sparklineMeasure!.values[i] as number;
                row.sparklineValues.push(sv != null && !isNaN(sv) ? sv : 0);
            }

            // Average percentage measures instead of leaving as sum
            for (const [, row] of rowMap) {
                for (let m = 0; m < tableMeasures.length; m++) {
                    if (measureFormat[m] === "percent" && row.measureCounts[m] > 0) {
                        row.measureValues[m] /= row.measureCounts[m];
                    }
                }
            }

            // Trim leading and trailing zeros from sparkline data to remove dead space
            for (const [, row] of rowMap) {
                const vals = row.sparklineValues;
                let start = 0;
                let end = vals.length - 1;
                while (start < end && vals[start] === 0) start++;
                while (end > start && vals[end] === 0) end--;
                row.sparklineValues = vals.slice(start, end + 1);
            }

            // Build rows array preserving insertion order
            let rows: RowData[] = rowOrder.map(key => rowMap.get(key)!);

            // Apply sorting
            const tblSettings = this.formattingSettings.tableCardSettings;
            const spkSettings = this.formattingSettings.sparklineCardSettings;
            const sortSettings = this.formattingSettings.sortCardSettings;

            const sortCol = sortSettings.sortColumn.value;
            const sortDir = (sortSettings.sortDirection.value.value as string) === "desc" ? -1 : 1;

            rows.sort((a, b) => {
                let aVal: string | number;
                let bVal: string | number;

                if (sortCol === 0) {
                    // Sort by category name
                    aVal = a.category.toLowerCase();
                    bVal = b.category.toLowerCase();
                    return sortDir * (aVal < bVal ? -1 : aVal > bVal ? 1 : 0);
                } else {
                    // Sort by measure value (1-indexed after category column)
                    const mIdx = sortCol - 1;
                    if (mIdx < tableMeasures.length) {
                        aVal = a.measureValues[mIdx] ?? 0;
                        bVal = b.measureValues[mIdx] ?? 0;
                    } else {
                        // Sort by last sparkline value
                        aVal = a.sparklineValues[a.sparklineValues.length - 1] ?? 0;
                        bVal = b.sparklineValues[b.sparklineValues.length - 1] ?? 0;
                    }
                    return sortDir * ((aVal as number) - (bVal as number));
                }
            });

            // ─── Conditional formatting (fx) wiring — Sparkline Colour (TRANS-04) ──
            // sparklineCardSettings.sparklineColor already carried a bare
            // `instanceKind: ConstantOrRule` declaration, but with no
            // `selector`/`altConstantSelector` wired it was inert (Pitfall
            // 5). Wired here: a dataViewWildcard selector (so a rule can
            // match this property's instances/totals) + an
            // altConstantSelector bound to the first row's selectionId
            // (the "set for all" swatch edit path), resolved per-row at
            // render via ColorHelper.getColorForMeasure against
            // rowCatColumn.objects[row.firstRawIndex] — same per-instance
            // pattern already proven on pbiProgressBarCard's Fixed Colour /
            // pbiHeatmapMatrix's Zero/Null Colour.
            this.rowCatColumnForFx = rowCatColumn;
            spkSettings.sparklineColor.selector = dataViewWildcard.createDataViewWildcardSelector(
                dataViewWildcard.DataViewWildcardMatchingOption.InstancesAndTotals
            );
            spkSettings.sparklineColor.altConstantSelector = rows[0]?.selectionId
                ? rows[0].selectionId.getSelector()
                : undefined;
            this.sparklineColorHelper = new ColorHelper(
                this.host.colorPalette,
                { objectName: "sparklineSettings", propertyName: "sparklineColor" },
                spkSettings.sparklineColor.value.value
            );

            // Retrieve settings values, applying high contrast overrides
            const headerBg = this.isHighContrast ? this.hcBackground : tblSettings.headerBackground.value.value;
            const headerTextColor = this.isHighContrast ? this.hcForeground : tblSettings.headerTextColor.value.value;
            const rowColor = this.isHighContrast ? this.hcBackground : tblSettings.rowColor.value.value;
            const altRowColor = this.isHighContrast ? this.hcBackground : tblSettings.alternateRowColor.value.value;
            const rowTransparencyPct = tblSettings.rowTransparency.value ?? 0;
            const textColor = this.isHighContrast ? this.hcForeground : tblSettings.textColor.value.value;
            const measureTextColor = this.isHighContrast ? this.hcForeground : tblSettings.measureTextColor.value.value;
            const fontSize = tblSettings.fontSize.value;
            const rowHeight = tblSettings.rowHeight.value;
            const showGrid = tblSettings.showGridLines.value;

            const spkWidth = spkSettings.sparklineWidth.value;
            const spkHeight = spkSettings.sparklineHeight.value;
            const spkType = spkSettings.sparklineType.value.value as string;
            const spkTransparencyPct = spkSettings.sparklineTransparency.value ?? 0;
            const showDot = spkSettings.showDot.value;
            const dotColor = this.isHighContrast ? this.hcForeground : spkSettings.dotColor.value.value;
            const lineWidth = spkSettings.lineWidth.value;

            // Apply grid class
            this.container.className = "sparkline-table-container " + (showGrid ? "grid-lines" : "no-grid-lines");

            // Build the table
            const table = document.createElement("table");
            table.style.tableLayout = "fixed";
            table.style.width = "100%";

            // Column group for width distribution
            const colgroup = document.createElement("colgroup");
            const cwSettings = this.formattingSettings.columnWidthSettings;
            const totalDataCols = 1 + tableMeasures.length + textColCount;

            // User-configured widths (0 = auto)
            const cfgCatW = cwSettings.categoryWidth.value || 0;
            const cfgMeasureW = cwSettings.measureWidth.value || 0;
            const cfgTextW = cwSettings.textWidth.value || 0;
            const cfgSpkW = cwSettings.sparklineWidth.value || 0;

            // Calculate total assigned width
            const assignedWidth = cfgCatW
                + (cfgMeasureW * tableMeasures.length)
                + (cfgTextW * textColCount)
                + cfgSpkW;

            // Auto-distribute: if user set some widths, auto columns split the remainder
            // If nothing is set, fall back to even distribution with sparkline getting 40%
            let catW: number, measureW: number, textW: number, spkW: number;

            if (assignedWidth > 0) {
                // Use configured values; auto (0) columns split the remainder equally
                const remainder = Math.max(0, 100 - assignedWidth);
                const autoCount = (cfgCatW ? 0 : 1)
                    + (cfgMeasureW ? 0 : tableMeasures.length)
                    + (cfgTextW ? 0 : textColCount)
                    + (cfgSpkW ? 0 : 1);
                const autoShare = autoCount > 0 ? remainder / autoCount : 0;

                catW = cfgCatW || autoShare;
                measureW = cfgMeasureW || autoShare;
                textW = cfgTextW || autoShare;
                spkW = cfgSpkW || autoShare;
            } else {
                // Default: data columns share 60%, sparkline gets 40%
                const defaultColW = Math.min(100, Math.floor(60 / totalDataCols));
                catW = defaultColW;
                measureW = defaultColW;
                textW = defaultColW + 2;
                spkW = 100 - defaultColW * totalDataCols;
            }

            // Row category column
            const catCol = document.createElement("col");
            catCol.style.width = catW + "%";
            colgroup.appendChild(catCol);

            // Measure columns
            for (let m = 0; m < tableMeasures.length; m++) {
                const col = document.createElement("col");
                col.style.width = measureW + "%";
                colgroup.appendChild(col);
            }

            // Text columns
            for (let t = 0; t < textColCount; t++) {
                const col = document.createElement("col");
                col.style.width = textW + "%";
                colgroup.appendChild(col);
            }

            // Sparkline column
            const spkCol = document.createElement("col");
            spkCol.style.width = spkW + "%";
            colgroup.appendChild(spkCol);

            table.appendChild(colgroup);

            // Header
            const thead = document.createElement("thead");
            const headerRow = document.createElement("tr");

            // Build headers with matching alignment classes
            const addTh = (text: string, className: string) => {
                const th = document.createElement("th");
                th.textContent = text;
                th.className = className;
                th.style.backgroundColor = headerBg;
                th.style.color = headerTextColor;
                th.style.fontSize = fontSize + "px";
                th.style.height = rowHeight + "px";
                headerRow.appendChild(th);
            };

            addTh(rowCategoryName, "category-cell");
            for (let m = 0; m < tableMeasures.length; m++) {
                addTh(measureNames[m], "measure-cell");
            }
            for (let t = 0; t < textColCount; t++) {
                addTh(textColNames[t], "category-cell");
            }
            addTh(this.localizationManager.getDisplayName("Visual_Header_Trend") || "Trend", "sparkline-cell");
            thead.appendChild(headerRow);
            table.appendChild(thead);

            // Body
            const tbody = document.createElement("tbody");

            for (let r = 0; r < rows.length; r++) {
                const row = rows[r];
                const tr = document.createElement("tr");
                tr.style.height = rowHeight + "px";

                // Row background color — per-region transparency (D-05)
                // applied via toRgba(); high-contrast values are already
                // resolved above (hcBackground) and left untouched (never
                // re-wrapped) to preserve the existing HC short-circuit.
                const rowBaseColor = r % 2 === 1 ? altRowColor : rowColor;
                tr.style.backgroundColor = this.isHighContrast
                    ? rowBaseColor
                    : toRgba(rowBaseColor, rowTransparencyPct);

                // Category cell
                const catTd = document.createElement("td");
                catTd.className = "category-cell";
                catTd.textContent = row.category;
                catTd.style.fontSize = fontSize + "px";
                catTd.style.color = textColor;
                catTd.style.overflow = "hidden";
                catTd.style.textOverflow = "ellipsis";
                catTd.style.whiteSpace = "nowrap";
                tr.appendChild(catTd);

                // Numeric measure cells
                for (let m = 0; m < tableMeasures.length; m++) {
                    const td = document.createElement("td");
                    td.className = "measure-cell";
                    const num = row.measureValues[m];
                    const fmt = measureFormat[m];
                    if (fmt === "badge") {
                        // Map score to badge text and colour
                        const badgeMap: Record<number, [string, string, string]> = {
                            1: ["\u2713 On track", "#005a4e", "#e0f5ef"],
                            2: ["\u26A0 Watch", "#7a5600", "#fef3d6"],
                            3: ["\u2717 Action needed", "#a30d1e", "#fde8ea"]
                        };
                        const badge = badgeMap[Math.round(num)];
                        if (badge) {
                            td.textContent = badge[0];
                            td.style.color = badge[1];
                            td.style.backgroundColor = badge[2];
                            td.style.borderRadius = "4px";
                            td.style.textAlign = "center";
                            td.style.fontWeight = "600";
                        } else {
                            td.textContent = "\u2014";
                        }
                    } else if (fmt === "percent") {
                        td.textContent = num.toFixed(1) + "%";
                    } else if (fmt === "integer") {
                        td.textContent = formatValue(num, "auto", 0);
                    } else {
                        td.textContent = formatValue(num, "auto", 1);
                    }
                    td.style.fontSize = fontSize + "px";
                    // Apply measure text color only for non-badge cells
                    if (fmt !== "badge") {
                        td.style.color = measureTextColor;
                    }
                    tr.appendChild(td);
                }

                // Text column cells
                for (let t = 0; t < textColCount; t++) {
                    const td = document.createElement("td");
                    td.className = "category-cell";
                    td.textContent = row.textValues[t] || "\u2014";
                    td.style.fontSize = fontSize + "px";
                    td.style.color = textColor;
                    tr.appendChild(td);
                }

                // Sparkline cell
                const spkTd = document.createElement("td");
                spkTd.className = "sparkline-cell";
                spkTd.style.overflow = "hidden";
                spkTd.style.padding = "2px 4px";

                if (row.sparklineValues.length > 1) {
                    // Per-row fx resolution (rule-evaluated if set, else
                    // static swatch) + per-region transparency (D-05),
                    // applied uniformly to line/area/bar (never Dot Color).
                    const instanceObjects = this.rowCatColumnForFx?.objects?.[row.firstRawIndex];
                    const resolvedSpkColorHex = this.isHighContrast
                        ? this.hcForeground
                        : (this.sparklineColorHelper?.getColorForMeasure(instanceObjects, "sparklineColor")
                            ?? spkSettings.sparklineColor.value.value);
                    const spkColorForRow = this.isHighContrast
                        ? resolvedSpkColorHex
                        : toRgba(resolvedSpkColorHex, spkTransparencyPct);
                    const svg = this.renderSparkline(
                        row.sparklineValues,
                        spkWidth, spkHeight,
                        spkColorForRow, spkType,
                        lineWidth, showDot, dotColor
                    );
                    spkTd.appendChild(svg);
                } else {
                    spkTd.textContent = "\u2014";
                }

                tr.appendChild(spkTd);

                // Tooltip on row hover
                tr.style.cursor = "pointer";
                const rowRef = row;
                const rowMeasureNames = measureNames;
                const rowMeasureFormats = measureFormat;
                tr.addEventListener("mousemove", (e: MouseEvent) => {
                    const tooltipItems: VisualTooltipDataItem[] = [
                        { displayName: rowCategoryName, value: rowRef.category }
                    ];
                    for (let mi = 0; mi < rowMeasureNames.length; mi++) {
                        const num = rowRef.measureValues[mi];
                        const fmt = rowMeasureFormats[mi];
                        let valStr: string;
                        if (fmt === "percent") valStr = num.toFixed(1) + "%";
                        else if (fmt === "integer") valStr = formatValue(num, "auto", 0);
                        else valStr = formatValue(num, "auto", 1);
                        tooltipItems.push({ displayName: rowMeasureNames[mi], value: valStr });
                    }
                    this.tooltipService.show({
                        coordinates: [e.clientX, e.clientY],
                        isTouchEvent: false,
                        dataItems: tooltipItems,
                        identities: rowRef.selectionId ? [rowRef.selectionId] : []
                    });
                });
                tr.addEventListener("mouseleave", () => {
                    this.tooltipService.hide({ isTouchEvent: false, immediately: false });
                });

                // Cross-filtering on click
                tr.addEventListener("click", (e: MouseEvent) => {
                    if (rowRef.selectionId) {
                        this.selectionManager.select(rowRef.selectionId, e.ctrlKey || e.metaKey);
                    }
                    e.stopPropagation();
                });

                tbody.appendChild(tr);
            }

            table.appendChild(tbody);
            this.container.appendChild(table);

            this.eventService.renderingFinished(options);
        } catch (e) {
            this.eventService.renderingFailed(options, String(e));
        }
    }

    private renderEmpty(message: string): void {
        while (this.container.firstChild) {
            this.container.removeChild(this.container.firstChild);
        }
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = message;
        this.container.appendChild(empty);
    }

    private renderSparkline(
        data: number[],
        width: number,
        height: number,
        color: string,
        type: string,
        strokeWidth: number,
        showDot: boolean,
        dotColor: string
    ): SVGSVGElement {
        const padding = 2;
        const svgNs = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(svgNs, "svg") as SVGSVGElement;
        svg.setAttribute("width", "100%");
        svg.setAttribute("height", String(height));
        svg.setAttribute("viewBox", "0 0 " + width + " " + height);
        svg.setAttribute("preserveAspectRatio", "none");
        svg.classList.add("sparkline-svg");

        const minVal = Math.min(...data);
        const maxVal = Math.max(...data);

        const xScale = scaleLinear()
            .domain([0, data.length - 1])
            .range([padding, width - padding]);

        const yScale = scaleLinear()
            .domain([minVal, maxVal === minVal ? minVal + 1 : maxVal])
            .range([height - padding, padding]);

        if (type === "bar") {
            // Bar chart sparkline
            const barWidth = Math.max(1, (width - padding * 2) / data.length - 1);
            for (let i = 0; i < data.length; i++) {
                const rect = document.createElementNS(svgNs, "rect");
                const x = xScale(i) - barWidth / 2;
                const y = yScale(data[i]);
                const barHeight = height - padding - y;
                rect.setAttribute("x", String(Math.max(padding, x)));
                rect.setAttribute("y", String(y));
                rect.setAttribute("width", String(barWidth));
                rect.setAttribute("height", String(Math.max(0, barHeight)));
                rect.setAttribute("fill", color);
                rect.setAttribute("fill-opacity", "0.7");
                svg.appendChild(rect);
            }
        } else {
            // Line or area
            if (type === "area") {
                const areaGen = area<number>()
                    .x((_d, i) => xScale(i))
                    .y0(height - padding)
                    .y1(d => yScale(d))
                    .curve(curveMonotoneX);

                const areaPath = document.createElementNS(svgNs, "path");
                areaPath.setAttribute("d", areaGen(data) || "");
                areaPath.setAttribute("fill", color);
                areaPath.setAttribute("fill-opacity", "0.15");
                svg.appendChild(areaPath);
            }

            const lineGen = line<number>()
                .x((_d, i) => xScale(i))
                .y(d => yScale(d))
                .curve(curveMonotoneX);

            const linePath = document.createElementNS(svgNs, "path");
            linePath.setAttribute("d", lineGen(data) || "");
            linePath.setAttribute("fill", "none");
            linePath.setAttribute("stroke", color);
            linePath.setAttribute("stroke-width", String(strokeWidth));
            svg.appendChild(linePath);
        }

        // Last-point dot
        if (showDot && data.length > 0) {
            const lastIdx = data.length - 1;
            const circle = document.createElementNS(svgNs, "circle");
            circle.setAttribute("cx", String(xScale(lastIdx)));
            circle.setAttribute("cy", String(yScale(data[lastIdx])));
            circle.setAttribute("r", String(Math.max(2, strokeWidth)));
            circle.setAttribute("fill", dotColor);
            svg.appendChild(circle);
        }

        return svg;
    }

    public destroy(): void {
        if (this.contextMenuHandler) {
            this.target.removeEventListener("contextmenu", this.contextMenuHandler);
        }
        while (this.container && this.container.firstChild) {
            this.container.removeChild(this.container.firstChild);
        }
        this.container = null;
        this.target = null;
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }
}
