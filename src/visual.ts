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

import { VisualFormattingSettingsModel, textAlignFor } from "./settings";
import { toRgba } from "./shared/colorHelpers";
import { formatValue, CODEX_TOKENS } from "./utils";

// v3 engine (01-18 Task 3) — shared spark grammar (mirrors 01-16
// pbiKpiSparklineCard) + self-referential band tint (no genuine
// target/goal data role, mirrors the 01-16 Callback Card precedent) +
// corner-bracket card signature + row-hover elevation lift.
import { Theme, band, bandColor, accentToken } from "./shared/bandEngine";
import { surfaceTokens } from "./shared/designTokens";
import { applyBorder } from "./shared/borderSettings";
import { makeCornerBrackets, CardSignatureHandle } from "./shared/cardSignature";
import { applyCardSignature } from "./shared/cardSignatureSettings";

/** Luminance-based theme pick (matches the pbiKpiCard v3 pilot's own
 * 0.55 threshold convention) — this visual's row/background colours are
 * plain ColorPickers (always opaque at their own default), so the
 * configured Row Color is a reliable theme signal. */
function themeFor(hex: string): Theme {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})/i.exec(hex || "");
    if (!m) return "light";
    const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance < 0.5 ? "dark" : "light";
}

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

    // State for the Measure Text Colour fx wiring (TEXT-02) — same per-row
    // firstRawIndex resolution as sparklineColorHelper above (one rendered
    // row aggregates many raw categorical rows — the Plan 07 aggregated-row
    // gotcha), applied to the numeric value-column TEXT colour.
    private measureTextColorHelper: ColorHelper | null = null;

    // Corner-bracket card signature (01-18 Task 3) — attached to
    // `this.target` (never cleared) rather than `this.container` (which
    // this visual fully rebuilds every update via the firstChild-removal
    // loop below), so the bracket elements survive every render.
    private cornerSignature: CardSignatureHandle | null = null;

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

        this.target.style.position = "relative";
        this.cornerSignature = makeCornerBrackets(this.target, "#8f8ab8", {
            variant: "cornerBracket",
            mirror: true,
            muted: true
        });

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
            spkSettings.sparklineColor.altConstantSelector = undefined; // card-level constant persistence: swatch edits apply to ALL instances + round-trip into the pane (first-instance binding persisted a row-0-only override); fx rules stay per-instance via the wildcard selector;
            this.sparklineColorHelper = new ColorHelper(
                this.host.colorPalette,
                { objectName: "sparklineSettings", propertyName: "sparklineColor" },
                spkSettings.sparklineColor.value.value
            );

            // ─── fx wiring — Measure Text Colour (TEXT-02) ──────────────
            // Same per-row pattern as Sparkline Colour above: dataViewWildcard
            // selector + altConstantSelector on the first row's selectionId,
            // resolved per-row at render via ColorHelper.getColorForMeasure
            // against rowCatColumn.objects[row.firstRawIndex] — the existing
            // firstRawIndex field (aggregated-row resolution proven in Plan
            // 07), NOT a loop counter. Applies to the numeric value-column
            // TEXT only; sparkline line/dot colour logic is untouched.
            tblSettings.measureTextColor.selector = dataViewWildcard.createDataViewWildcardSelector(
                dataViewWildcard.DataViewWildcardMatchingOption.InstancesAndTotals
            );
            tblSettings.measureTextColor.altConstantSelector = undefined; // card-level constant persistence: swatch edits apply to ALL instances + round-trip into the pane (first-instance binding persisted a row-0-only override); fx rules stay per-instance via the wildcard selector;
            this.measureTextColorHelper = new ColorHelper(
                this.host.colorPalette,
                { objectName: "tableSettings", propertyName: "measureTextColor" },
                tblSettings.measureTextColor.value.value
            );

            // Theme-source ladder (Neil 2026-07-14 "the colour switch doesn't
            // work"): the VISIBLE surface governs light/dark so changing the
            // Background flips the whole table — not just the Row Color. Order:
            //   1. a painted visual Background (transparency < 100) → its hex
            //   2. else a user-set Row Color (≠ white sentinel) → that
            //   3. else the report-theme palette background
            //   4. else the white sentinel
            const rowColorRaw = tblSettings.rowColor.value.value;
            const rowUserSet = rowColorRaw !== "#ffffff";
            const bgPainted = (outerBgTransparencyPct ?? 100) < 100;
            const reportThemeBg = (this.host.colorPalette as any)?.background?.value as string | undefined;
            const governingBg = bgPainted ? outerBgHex
                : (rowUserSet ? rowColorRaw : (reportThemeBg ?? rowColorRaw));
            const theme: Theme = themeFor(this.isHighContrast ? this.hcBackground : governingBg);
            // D-16 adaptive sweep: untouched LIGHT-theme defaults swap to dark
            // tokens on a dark surface so nothing is invisible. HC wins; a
            // user-set colour is honoured verbatim.
            const dk = surfaceTokens("dark");
            const adapt = (userHex: string, defHex: string, darkTok: string): string =>
                (userHex === defHex && theme === "dark") ? darkTok : userHex;

            // Retrieve settings values, applying high contrast overrides
            const headerBg = this.isHighContrast ? this.hcBackground : adapt(tblSettings.headerBackground.value.value, "#f8f6f0", dk.card);
            const headerTextColor = this.isHighContrast ? this.hcForeground : adapt(tblSettings.headerTextColor.value.value, "#333333", dk.muted);
            // Rows follow the surface: an explicit Row Color is honoured; else
            // the rows go dark on a dark background (so the whole table adapts,
            // not just the text) and stay white on light (D-06 parity).
            const rowColor = this.isHighContrast ? this.hcBackground
                : (rowUserSet ? rowColorRaw : (theme === "dark" ? dk.card : "#ffffff"));
            const altRowColor = this.isHighContrast ? this.hcBackground : adapt(tblSettings.alternateRowColor.value.value, "#faf9f5", dk.canvas);

            const bandTintValueEnabled = tblSettings.bandTintValue?.value ?? true;
            const bandTintDotEnabled = spkSettings.bandTintDot?.value ?? true;
            const rowTransparencyPct = tblSettings.rowTransparency.value ?? 0;
            const textColor = this.isHighContrast ? this.hcForeground : adapt(tblSettings.textColor.value.value, "#333333", dk.text);
            const measureTextColor = this.isHighContrast ? this.hcForeground : adapt(tblSettings.measureTextColor.value.value, "#333333", dk.text);
            const fontSize = tblSettings.fontSize.value;
            const rowHeight = tblSettings.rowHeight.value;
            const showGrid = tblSettings.showGridLines.value;

            const spkHeight = spkSettings.sparklineHeight.value;
            const spkType = spkSettings.sparklineType.value.value as string;
            const spkTransparencyPct = spkSettings.sparklineTransparency.value ?? 0;
            const showDot = spkSettings.showDot.value;
            const dotColor = this.isHighContrast ? this.hcForeground : spkSettings.dotColor.value.value;
            const lineWidth = spkSettings.lineWidth.value;

            // Per-surface text treatment (TEXT-01) — each composite's Font
            // Size 0 = "follow the shared Font Size" (D-06: an old report's
            // customised shared size still governs every cell at defaults);
            // bold-off falls back to each surface's own pre-existing
            // hardcoded weight (header 600, category-cell 500, measure 400).
            const defaultFamily = "Segoe UI, Tahoma, Geneva, Verdana, sans-serif";
            const rowLabelFamily = tblSettings.rowLabelFontFamily?.value || defaultFamily;
            const rowLabelSize = (tblSettings.rowLabelFontSize?.value || 0) > 0 ? tblSettings.rowLabelFontSize.value : fontSize;
            const rowLabelWeight = this.weightFor(tblSettings.rowLabelBold?.value, "500");
            const rowLabelStyle = tblSettings.rowLabelItalic?.value ? "italic" : "normal";
            const rowLabelDecoration = tblSettings.rowLabelUnderline?.value ? "underline" : "none";

            const valueFamily = tblSettings.valueFontFamily?.value || defaultFamily;
            const valueSize = (tblSettings.valueFontSize?.value || 0) > 0 ? tblSettings.valueFontSize.value : fontSize;
            const valueWeight = this.weightFor(tblSettings.valueBold?.value, "400");
            const valueStyle = tblSettings.valueItalic?.value ? "italic" : "normal";
            const valueDecoration = tblSettings.valueUnderline?.value ? "underline" : "none";

            const headerFamily = tblSettings.headerFontFamily?.value || defaultFamily;
            const headerSize = (tblSettings.headerFontSize?.value || 0) > 0 ? tblSettings.headerFontSize.value : fontSize;
            const headerWeight = this.weightFor(tblSettings.headerBold?.value, "600");
            const headerStyle = tblSettings.headerItalic?.value ? "italic" : "normal";
            const headerDecoration = tblSettings.headerUnderline?.value ? "underline" : "none";

            // ─── Custom in-iframe Title (TITLE-01, shared v2 standard) ──
            // Render gate: showTitle && titleText (render-nothing default —
            // showTitle defaults false, D-06). textContent only — no
            // HTML-string injection (cert + XSS). Appended to the container
            // ahead of the table, so contextmenu bubbles to the existing
            // target listener (no new dead zone).
            const titleFmt = this.formattingSettings.titleSettings;
            if (titleFmt?.showTitle?.value && titleFmt?.titleText?.value) {
                const titleEl = document.createElement("div");
                titleEl.className = "sparkline-table-title";
                titleEl.textContent = String(titleFmt.titleText.value);
                titleEl.style.fontFamily = titleFmt.titleFontFamily?.value || "Segoe UI, sans-serif";
                titleEl.style.fontSize = `${titleFmt.titleFontSize?.value ?? 14}px`;
                titleEl.style.fontWeight = this.weightFor(titleFmt.titleBold?.value, "400");
                titleEl.style.fontStyle = titleFmt.titleItalic?.value ? "italic" : "normal";
                titleEl.style.textDecoration = titleFmt.titleUnderline?.value ? "underline" : "none";
                titleEl.style.textAlign = textAlignFor(titleFmt.titleAlign?.value as string);
                // Adaptive default (D-16 sentinel): untouched shared-Title navy
                // swaps to the dark text token on dark surfaces.
                const setTitle = titleFmt.titleColor?.value?.value || "#1a1a2e";
                const adaptiveTitle = setTitle === "#1a1a2e" && theme === "dark"
                    ? surfaceTokens("dark").text : setTitle;
                titleEl.style.color = this.isHighContrast
                    ? this.hcForeground
                    : adaptiveTitle;
                titleEl.style.padding = "8px 12px 4px";
                this.container.appendChild(titleEl);
            }

            // Apply grid class
            this.container.className = "sparkline-table-container " + (showGrid ? "grid-lines" : "no-grid-lines");

            // Build the table
            const table = document.createElement("table");
            table.style.tableLayout = "fixed";
            table.style.width = "100%";

            // Auto column widths (Neil 2026-07-15 — the manual width control is
            // gone). Fixed-layout percentages, computed (not user-set): the
            // TREND gets the lion's share so it runs wide, values get a legible
            // share, Δ a slim slot. Sums to 100 so nothing runs off the card,
            // and it degrades sanely as more value columns are bound.
            const valueColCount = tableMeasures.length + textColCount;
            const catW = 16;
            const deltaW = 10;
            const perValue = valueColCount > 0 ? Math.min(20, Math.max(13, 44 / valueColCount)) : 0;
            const spkW = Math.max(20, 100 - catW - deltaW - perValue * valueColCount);

            const colgroup = document.createElement("colgroup");
            const catCol = document.createElement("col");
            catCol.style.width = catW + "%";
            colgroup.appendChild(catCol);
            for (let m = 0; m < tableMeasures.length; m++) {
                const col = document.createElement("col");
                col.style.width = perValue + "%";
                colgroup.appendChild(col);
            }
            for (let t = 0; t < textColCount; t++) {
                const col = document.createElement("col");
                col.style.width = perValue + "%";
                colgroup.appendChild(col);
            }
            // Sparkline column — 2nd (right after category), gets the wide share.
            const spkCol = document.createElement("col");
            spkCol.style.width = spkW + "%";
            colgroup.insertBefore(spkCol, catCol.nextSibling);
            // Δ pill column (last).
            const deltaCol = document.createElement("col");
            deltaCol.style.width = deltaW + "%";
            colgroup.appendChild(deltaCol);
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
                // Header text treatment (TEXT-01) — size 0 follows the
                // shared Font Size; bold-off rests on pre-existing 600.
                th.style.fontSize = headerSize + "px";
                th.style.fontFamily = headerFamily;
                th.style.fontWeight = headerWeight;
                th.style.fontStyle = headerStyle;
                th.style.textDecoration = headerDecoration;
                th.style.height = rowHeight + "px";
                // Scorecard-board header treatment (Neil 2026-07-15): muted
                // uppercase micro-tracking — the "METRIC · NOW · Δ" eyebrow look.
                th.style.textTransform = "uppercase";
                th.style.letterSpacing = "0.08em";
                headerRow.appendChild(th);
            };

            addTh(rowCategoryName, "category-cell");
            // Trend header states the timeframe (Neil 2026-07-15) — the first→
            // last distinct Sparkline Category label, e.g. "Trend · Jan–Jun".
            const trendBase = this.localizationManager.getDisplayName("Visual_Header_Trend") || "Trend";
            const spkCatSeen = new Set<string>();
            const spkCatLabels: string[] = [];
            for (const v of sparklineCatColumn.values) {
                const s = String(v ?? "").trim();
                if (s && !spkCatSeen.has(s)) { spkCatSeen.add(s); spkCatLabels.push(s); }
            }
            const trendHeader = spkCatLabels.length > 1
                ? `${trendBase} · ${spkCatLabels[0]}–${spkCatLabels[spkCatLabels.length - 1]}`
                : trendBase;
            addTh(trendHeader, "sparkline-cell");
            for (let m = 0; m < tableMeasures.length; m++) {
                addTh(measureNames[m], "measure-cell");
            }
            for (let t = 0; t < textColCount; t++) {
                addTh(textColNames[t], "category-cell");
            }
            addTh("Δ", "measure-cell");
            thead.appendChild(headerRow);
            table.appendChild(thead);

            // Body
            const tbody = document.createElement("tbody");
            // Sparks are rendered in a 2nd pass (after the table lays out) so
            // each fills its cell's ACTUAL width — the flex Trend column.
            const sparkQueue: Array<{ td: HTMLElement; values: number[]; color: string; band: string }> = [];

            for (let r = 0; r < rows.length; r++) {
                const row = rows[r];
                const tr = document.createElement("tr");
                tr.style.height = rowHeight + "px";

                // Row background color — per-region transparency (D-05)
                // applied via toRgba(); high-contrast values are already
                // resolved above (hcBackground) and left untouched (never
                // re-wrapped) to preserve the existing HC short-circuit.
                const rowBaseColor = r % 2 === 1 ? altRowColor : rowColor;
                const rowRestingBg = this.isHighContrast
                    ? rowBaseColor
                    : toRgba(rowBaseColor, rowTransparencyPct);
                tr.style.backgroundColor = rowRestingBg;

                // Row hover lift (01-18 Task 3) — one elevation step via the
                // shared v3 surface tokens (a faint muted-token tint, same
                // mechanism suite-wide, never a per-visual hand-rolled hex).
                // CSS's own `:hover` rule is removed in visual.less so this
                // JS-driven, theme-aware lift is the single source of truth;
                // the existing 0.15s CSS transition (within the 120-200ms
                // glow-transition band) still governs the fade.
                if (!this.isHighContrast) {
                    const hoverBg = toRgba(surfaceTokens(theme).muted, 88);
                    tr.addEventListener("mouseenter", () => { tr.style.backgroundColor = hoverBg; });
                    tr.addEventListener("mouseleave", () => { tr.style.backgroundColor = rowRestingBg; });
                }

                // v3 band engine (01-18 Task 3) — self-referential trend
                // band: this row's latest sparkline point vs. the mean of
                // its own prior points (a bounded, documented baseline
                // derivation since this visual has no genuine target/goal
                // data role, mirroring the 01-16 Callback Card precedent).
                // Drives BOTH the value-column tint and the endpoint dot so
                // they always agree (§2 "one colour token per visual").
                const spkVals = row.sparklineValues;
                const lastSpkVal = spkVals.length > 0 ? spkVals[spkVals.length - 1] : 0;
                const priorSpkVals = spkVals.slice(0, -1);
                const spkBaseline = priorSpkVals.length > 0
                    ? priorSpkVals.reduce((a, b) => a + b, 0) / priorSpkVals.length
                    : lastSpkVal;
                const rowBandColor = bandColor(band(lastSpkVal, spkBaseline), theme);

                // Category cell — row-label text treatment (TEXT-01):
                // size 0 follows the shared Font Size; bold-off rests on
                // the pre-existing category-cell weight 500.
                const catTd = document.createElement("td");
                catTd.className = "category-cell";
                catTd.textContent = row.category;
                catTd.style.fontSize = rowLabelSize + "px";
                catTd.style.fontFamily = rowLabelFamily;
                catTd.style.fontWeight = rowLabelWeight;
                catTd.style.fontStyle = rowLabelStyle;
                catTd.style.textDecoration = rowLabelDecoration;
                catTd.style.color = textColor;
                catTd.style.overflow = "hidden";
                catTd.style.textOverflow = "ellipsis";
                catTd.style.whiteSpace = "nowrap";
                tr.appendChild(catTd);

                // Per-row Measure Text Colour fx resolution (TEXT-02) —
                // resolved once per rendered row against this row's own
                // per-instance object overrides via firstRawIndex (the
                // aggregated-row gotcha from Plan 07 — never a loop counter).
                const rowInstanceObjects = this.rowCatColumnForFx?.objects?.[row.firstRawIndex];
                const resolvedMeasureTextColor = this.isHighContrast
                    ? this.hcForeground
                    : (this.measureTextColorHelper?.getColorForMeasure(rowInstanceObjects, "measureTextColor")
                        ?? measureTextColor);

                // v2 board look (01-18 Task 3) — "band-tinted value column":
                // an active fx RULE on Measure Text Color (a more deliberate
                // override than the flat default) always wins; otherwise the
                // Band-Tint Value Column toggle governs whether the FIRST
                // measure column (the row's headline "value") resolves via
                // rowBandColor instead of the flat Measure Text Color.
                const hasMeasureTextColorOverride = !!(
                    rowInstanceObjects && (rowInstanceObjects as Record<string, unknown>).tableSettings &&
                    ((rowInstanceObjects as any).tableSettings.measureTextColor !== undefined)
                );
                const useValueBandTint = bandTintValueEnabled && !hasMeasureTextColorOverride
                    && !this.isHighContrast && spkVals.length > 1;

                // Numeric measure cells — value-column text treatment
                // (TEXT-01): size 0 follows the shared Font Size; bold-off
                // rests on the pre-existing default weight 400. Applied
                // BEFORE the badge branch so badge chrome (its own colour/
                // background/weight 600) still wins for badge cells.
                for (let m = 0; m < tableMeasures.length; m++) {
                    const td = document.createElement("td");
                    td.className = "measure-cell";
                    td.style.fontFamily = valueFamily;
                    td.style.fontWeight = valueWeight;
                    td.style.fontStyle = valueStyle;
                    td.style.textDecoration = valueDecoration;
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
                    td.style.fontSize = valueSize + "px";
                    // Apply measure text color only for non-badge cells:
                    // per-row fx-resolved (TEXT-02); badge chrome untouched.
                    // The FIRST measure column additionally honours the
                    // band-tint toggle above (D-16: fx rule / toggle-off
                    // still resolve to the flat colour untouched).
                    if (fmt !== "badge") {
                        td.style.color = (m === 0 && useValueBandTint) ? rowBandColor : resolvedMeasureTextColor;
                    }
                    tr.appendChild(td);
                }

                // Text column cells: same row-label text treatment as the
                // category cell (both render via the shared Text Color).
                for (let t = 0; t < textColCount; t++) {
                    const td = document.createElement("td");
                    td.className = "category-cell";
                    td.textContent = row.textValues[t] || "\u2014";
                    td.style.fontSize = rowLabelSize + "px";
                    td.style.fontFamily = rowLabelFamily;
                    td.style.fontWeight = rowLabelWeight;
                    td.style.fontStyle = rowLabelStyle;
                    td.style.textDecoration = rowLabelDecoration;
                    td.style.color = textColor;
                    tr.appendChild(td);
                }

                // Δ pill cell (design render) — the row's % change (last vs
                // prior-average baseline, the same signal that drives the band)
                // as a signal-tinted rounded pill. Appended last; the sparkline
                // is then moved ahead of the measures below.
                const deltaTd = document.createElement("td");
                deltaTd.className = "measure-cell";
                if (spkVals.length > 1 && spkBaseline !== 0) {
                    const deltaPct = ((lastSpkVal - spkBaseline) / spkBaseline) * 100;
                    const up = deltaPct >= 0;
                    const pill = document.createElement("span");
                    pill.textContent = `${up ? "▲" : "▼"} ${up ? "+" : "−"}${Math.abs(deltaPct).toFixed(1)}%`;
                    pill.style.display = "inline-flex";
                    pill.style.alignItems = "center";
                    pill.style.fontSize = "11px";
                    pill.style.fontWeight = "700";
                    pill.style.padding = "2px 8px";
                    pill.style.borderRadius = "999px";
                    pill.style.whiteSpace = "nowrap";
                    if (this.isHighContrast) {
                        pill.style.color = this.hcForeground;
                        pill.style.border = `1px solid ${this.hcForeground}`;
                    } else {
                        pill.style.color = rowBandColor;
                        pill.style.backgroundColor = toRgba(rowBandColor, 85);
                    }
                    deltaTd.appendChild(pill);
                } else {
                    deltaTd.textContent = "—";
                    deltaTd.style.color = textColor;
                }
                tr.appendChild(deltaTd);

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
                    // Band-tinted spark (design render, Neil 2026-07-15): when
                    // the sparkline colour is left at its default, the line +
                    // fill follow the ROW's signal colour (green rising / amber
                    // flat / red falling), matching the scorecard board instead
                    // of a flat cyan. A user-set colour / fx rule is honoured.
                    // Band-tint on BOTH themes (the earlier adapt() only swapped
                    // on dark, so light-theme sparks stayed navy — Neil 2026-07-15):
                    // an untouched default spark colour follows the row signal;
                    // a user-set colour / fx rule is honoured verbatim.
                    const rawSpk = this.sparklineColorHelper?.getColorForMeasure(instanceObjects, "sparklineColor")
                        ?? spkSettings.sparklineColor.value.value;
                    const resolvedSpkColorHex = this.isHighContrast
                        ? this.hcForeground
                        : (rawSpk === "#130064" ? rowBandColor : rawSpk);
                    const spkColorForRow = this.isHighContrast
                        ? resolvedSpkColorHex
                        : toRgba(resolvedSpkColorHex, spkTransparencyPct);
                    // Deferred to the 2nd pass (after table layout) so the spark
                    // fills its cell's ACTUAL width — the flex Trend column.
                    sparkQueue.push({ td: spkTd, values: row.sparklineValues, color: spkColorForRow, band: rowBandColor });
                } else {
                    spkTd.textContent = "\u2014";
                }

                // Move the sparkline to the 2nd column (right after category).
                tr.insertBefore(spkTd, catTd.nextSibling);

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

            // 2nd pass — the table is now laid out, so each spark renders at its
            // cell's REAL width (the flex Trend column, as wide as the card
            // allows). This is what makes the trend fill the card without any
            // manual width control (Neil 2026-07-15).
            for (const q of sparkQueue) {
                const w = Math.max(40, q.td.clientWidth - 8);
                const svg = this.renderSparkline(
                    q.values, w, spkHeight, q.color, spkType,
                    lineWidth, showDot, dotColor,
                    { theme, hc: this.isHighContrast, bandTint: bandTintDotEnabled, bandColorHex: q.band }
                );
                q.td.appendChild(svg);
            }

            // Corner-bracket card signature (01-18 Task 3) — a table has no
            // single governing value/target, so it carries the suite's
            // constant brand accent (never a per-row band colour) rather
            // than the KPI-family visuals' signal-tinted bracket.
            applyCardSignature(this.cornerSignature, this.formattingSettings.cardSignature, {
                autoHex: accentToken(theme),
                hcActive: this.isHighContrast,
                hcColor: this.hcForeground,
                mirror: true,
                glowMix: this.isHighContrast ? 0 : (theme === "dark" ? 55 : 0),
                muted: false
            });

            // Visual's own Border card — CSS border on the render container so
            // it wraps the whole table; Corner Radius rounds it (overflow left
            // as-is — a large table may scroll). fx colour via metadata objects.
            this.container.style.boxSizing = "border-box";
            applyBorder(this.container, this.formattingSettings.visualBorder, {
                hcActive: this.isHighContrast,
                hcColor: this.hcForeground,
                palette: this.host.colorPalette,
                metadataObjects: dataView?.metadata?.objects,
            });

            this.eventService.renderingFinished(options);
        } catch (e) {
            this.eventService.renderingFailed(options, String(e));
        }
    }

    /** weightFor(bold, restWeight) idiom (TEXT-01, D-06) — bold on renders
     *  "700"; bold off falls back to the surface's own pre-existing
     *  hardcoded weight so old saved reports render pixel-identical at the
     *  new property defaults. */
    private weightFor(bold: boolean | undefined, restWeight: string): string {
        return bold ? "700" : restWeight;
    }

    private renderEmpty(message: string): void {
        while (this.container.firstChild) {
            this.container.removeChild(this.container.firstChild);
        }
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = message;
        this.container.appendChild(empty);
        applyCardSignature(this.cornerSignature, this.formattingSettings?.cardSignature, { autoHex: "#8f8ab8", mirror: true, muted: true });
    }

    private renderSparkline(
        data: number[],
        width: number,
        height: number,
        color: string,
        type: string,
        strokeWidth: number,
        showDot: boolean,
        dotColor: string,
        v3: { theme: Theme; hc: boolean; bandTint: boolean; bandColorHex: string }
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
            // Soft area fill under the line — ALWAYS drawn now (the board's
            // spark grammar; the type control is retired). Bolder on dark so
            // the signal-coloured wash reads; softer on light. HC drops it.
            const isDark = v3.theme === "dark" && !v3.hc;
            const areaGen = area<number>()
                .x((_d, i) => xScale(i))
                .y0(height - padding)
                .y1(d => yScale(d))
                .curve(curveMonotoneX);
            const areaPath = document.createElementNS(svgNs, "path");
            areaPath.setAttribute("d", areaGen(data) || "");
            if (v3.hc) {
                areaPath.setAttribute("fill", "none");
            } else {
                areaPath.setAttribute("fill", color);
                areaPath.setAttribute("fill-opacity", isDark ? "0.30" : "0.15");
            }
            svg.appendChild(areaPath);

            const lineGen = line<number>()
                .x((_d, i) => xScale(i))
                .y(d => yScale(d))
                .curve(curveMonotoneX);

            const linePath = document.createElementNS(svgNs, "path");
            linePath.setAttribute("d", lineGen(data) || "");
            linePath.setAttribute("fill", "none");
            linePath.setAttribute("stroke", color);
            linePath.setAttribute("stroke-width", String(strokeWidth));
            linePath.setAttribute("stroke-linecap", "round");
            linePath.setAttribute("stroke-linejoin", "round");
            // Neon glow on dark (per-line inline filter, no shared-id collision
            // across the table's many sparks).
            if (isDark) {
                linePath.style.filter = `drop-shadow(0 0 2px color-mix(in srgb, ${color} 60%, transparent))`;
            }
            svg.appendChild(linePath);

            // v2 board look (01-18 Task 3) — min/max whisper ticks, the
            // SAME shared spark grammar element as pbiKpiSparklineCard
            // (Task 3, 01-16): short muted vertical dashes at the series'
            // two extreme points, skipped when flat (min===max, neither
            // point meaningfully "extreme") and under high-contrast (a
            // plain muted-hex tick is colour-only). Bar type has no line
            // to annotate, so whisker ticks are line/area-only, matching
            // the KPI Sparkline Card original.
            if (!v3.hc && minVal !== maxVal) {
                const whiskerColor = surfaceTokens(v3.theme).muted;
                const minIdx = data.indexOf(minVal);
                const maxIdx = data.indexOf(maxVal);
                [minIdx, maxIdx].forEach((idx) => {
                    const cx = xScale(idx);
                    const cy = yScale(data[idx]);
                    const tick = document.createElementNS(svgNs, "line");
                    tick.setAttribute("x1", String(cx));
                    tick.setAttribute("x2", String(cx));
                    tick.setAttribute("y1", String(cy - 3));
                    tick.setAttribute("y2", String(cy + 3));
                    tick.setAttribute("stroke", whiskerColor);
                    tick.setAttribute("stroke-width", "1");
                    tick.setAttribute("opacity", "0.6");
                    svg.appendChild(tick);
                });
            }
        }

        // Last-point dot — band-tinted (01-18 Task 3, mirrors the
        // pbiKpiSparklineCard endpoint dot) when Band-Tint Endpoint Dot is
        // on and not high-contrast; otherwise the flat, per-row-fx-
        // resolved Dot Color exactly as it rendered before this plan
        // (D-16 — the toggle-off / HC paths are untouched).
        if (showDot && data.length > 0) {
            const lastIdx = data.length - 1;
            const resolvedDotColor = v3.hc
                ? dotColor
                : (v3.bandTint ? v3.bandColorHex : dotColor);
            const circle = document.createElementNS(svgNs, "circle");
            circle.setAttribute("cx", String(xScale(lastIdx)));
            circle.setAttribute("cy", String(yScale(data[lastIdx])));
            circle.setAttribute("r", String(Math.max(2, strokeWidth)));
            circle.setAttribute("fill", resolvedDotColor);
            svg.appendChild(circle);
        }

        return svg;
    }

    public destroy(): void {
        if (this.contextMenuHandler) {
            this.target.removeEventListener("contextmenu", this.contextMenuHandler);
        }
        this.cornerSignature?.destroy();
        this.cornerSignature = null;
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
