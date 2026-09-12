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
import { toRgba, compositeOver, contrastInk, contrastRatio, surfaceTone } from "./shared/colorHelpers";
import { formatModelNumber } from "./shared/numberFormat";
import { applyHighContrast, HighContrastPalette } from "./shared/highContrast";


// v3 engine (01-18 Task 3) — shared spark grammar (mirrors 01-16
// pbiKpiSparklineCard) + self-referential band tint (no genuine
// target/goal data role, mirrors the 01-16 Callback Card precedent) +
// corner-bracket card signature + row-hover elevation lift.
import { Theme, band, bandColor, accentToken } from "./shared/bandEngine";
import { surfaceTokens, mix } from "./shared/designTokens";
import { applyBorder } from "./shared/borderSettings";
import { makeCornerBrackets, CardSignatureHandle } from "./shared/cardSignature";
import { applyCardSignature } from "./shared/cardSignatureSettings";
import { resolveCodexTheme, neonColorFor, neonShadow, neonFilter, flareHexFor } from "./shared/codexThemeSettings";
import { LicenseGate } from "./shared/licensing";

/** Index of the last OBSERVED (non-gap) reading, or -1 when the series is
 *  all gaps (NEXUS cycle-12 §1 — a gap is not a zero). */
function lastObservedIndex(values: (number | null)[]): number {
    for (let i = values.length - 1; i >= 0; i--) {
        if (values[i] != null) return i;
    }
    return -1;
}

/** The last OBSERVED reading, or null when the series is all gaps. */
function lastObserved(values: (number | null)[]): number | null {
    const index = lastObservedIndex(values);
    return index < 0 ? null : (values[index] as number);
}

function categoryKey(value: powerbi.PrimitiveValue): string {
    return value instanceof Date ? "date:" + value.getTime() : typeof value + ":" + String(value);
}

function bounded(value: number, fallback: number, min: number, max: number): number {
    return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

function normalizedWidths(weights: number[]): number[] {
    const largest = Math.max(...weights);
    const total = weights.reduce((sum, weight) => sum + weight / largest, 0);
    const shares = weights.map(weight => (weight / largest) / total * 100);
    const floor = Math.min(6, 50 / weights.length);
    const flexible = shares.map(share => Math.max(0, share - floor));
    const flexibleTotal = flexible.reduce((sum, share) => sum + share, 0);
    return flexible.map(share => floor + share / flexibleTotal * (100 - floor * weights.length));
}

function readableInk(preferred: string, surface: string): string {
    if (contrastRatio(preferred, surface) >= 4.6) return preferred;
    const best = contrastInk(surface, "#000000", "#ffffff");
    for (let amount = 0.05; amount < 1; amount += 0.05) {
        const candidate = mix(preferred, best, amount);
        if (contrastRatio(candidate, surface) >= 4.6) return candidate;
    }
    return best;
}

/** `force` (#819) — a forced Codex mode OWNS the text inks: a pane colour the
 *  user picked for a white card is not a choice about the Codex dark surface,
 *  so "adapt only when the value is still the default" becomes "adapt when
 *  FORCED or default". Auto passes force=false and every pane ink is kept. */
function adaptiveInk(value: string, defaultValue: string, surface: string, force = false): string {
    return (!force && value !== defaultValue) ? value
        : readableInk(contrastInk(surface, defaultValue, surfaceTokens("dark").text), surface);
}

/** One distinct Sparkline Category value — the series is built from these,
 *  not from raw row order (NEXUS cycle-12 §2). */
interface SparkBucket {
    /** identity key: the date's epoch ms, or the trimmed text */
    key: string;
    /** what the Trend header prints for this point */
    label: string;
    /** epoch ms when the host delivered a genuine Date, else null */
    time: number | null;
    /** raw row index of first encounter — the fallback order */
    firstSeen: number;
}

/** Represents a single table row with its measure values and sparkline data */
interface RowData {
    category: string;
    measureValues: number[];        // aggregated numeric values
    measureCounts: number[];        // count of non-null values (0 = NO observed value)
    textValues: (string | null)[];  // text column values (value at the latest bucket)
    textBucketPos: number[];        // bucket position each textValue came from
    sparkSums: number[];            // per-bucket sum of the sparkline measure
    sparkCounts: number[];          // per-bucket count of non-null readings
    sparklineValues: (number | null)[]; // one entry per bucket; null = a genuine GAP
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
    private formattingSettings: VisualFormattingSettingsModel = new VisualFormattingSettingsModel();
    private formattingSettingsService: FormattingSettingsService;
    private host: powerbi.extensibility.visual.IVisualHost;
    private isHighContrast: boolean = false;
    private hcForeground: string = "#000000";
    private hcBackground: string = "#ffffff";
    private contextMenuHandler: (e: MouseEvent) => void;
    private backgroundClickHandler: (e: MouseEvent) => void;
    private selectionRows: Array<{ element: HTMLTableRowElement; identity: ISelectionId }> = [];

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

    private licenseGate: LicenseGate;

    private lastUpdateOptions: VisualUpdateOptions | null = null;

    /** Teardown for an in-flight column drag (NEXUS cycle-12 §12).
     *  A drag's mousemove/mouseup listeners live on `document`, so they outlive
     *  both the table they were created against and the visual itself: a
     *  destroy mid-drag still let mouseup call persistProperties, and a
     *  re-render mid-drag persisted the OLD width vector against the NEW column
     *  shape. Non-null exactly while a drag is outstanding. */
    private cancelDrag: (() => void) | null = null;
    private disposed = false;
    private renderEvents = new AbortController();


    constructor(options: VisualConstructorOptions) {

        // NO FREE TIER — an unlicensed user gets the whole visual blocked.

        // The check is async, so re-run the last update once it resolves.

        this.licenseGate = new LicenseGate(options.host, () => {

            if (this.lastUpdateOptions) this.update(this.lastUpdateOptions);

        });
        this.formattingSettingsService = new FormattingSettingsService();
        this.target = options.element;
        this.host = options.host;
        this.eventService = options.host.eventService;
        this.selectionManager = options.host.createSelectionManager();
        this.selectionManager.registerOnSelectCallback(ids => this.applySelection(ids));
        this.tooltipService = options.host.tooltipService;
        this.localizationManager = options.host.createLocalizationManager();

        // High contrast detection — resolved through the shared HC rule (§8)
        // so every painted surface in this visual reads from ONE palette
        // resolution instead of each site re-deriving it.
        this.readHighContrast((options.host as any).colorPalette);

        this.container = document.createElement("div");
        this.container.className = "sparkline-table-container";
        if (this.isHighContrast) this.container.style.backgroundColor = this.hcBackground;
        this.target.appendChild(this.container);

        this.target.style.position = "relative";
        this.cornerSignature = makeCornerBrackets(this.target, this.isHighContrast ? this.hcForeground : "#8f8ab8", {
            variant: "cornerBracket",
            mirror: true,
            muted: !this.isHighContrast,
            glowMix: this.isHighContrast ? 0 : undefined
        });

        // Context menu
        this.contextMenuHandler = (e: MouseEvent) => {
            e.preventDefault();
            if (this.disposed || !this.interactionsAllowed()) return;
            const element = (e.target as Element)?.closest("tbody tr");
            const identity = this.selectionRows.find(row => row.element === element)?.identity;
            this.selectionManager.showContextMenu(identity ?? {} as powerbi.extensibility.ISelectionId, { x: e.clientX, y: e.clientY });
        };
        this.target.addEventListener("contextmenu", this.contextMenuHandler);
        this.backgroundClickHandler = (e: MouseEvent) => {
            if (this.disposed || !this.interactionsAllowed() || (e.target as Element)?.closest("table")) return;
            this.selectionManager.clear().then(() => this.applySelection([]));
        };
        this.target.addEventListener("click", this.backgroundClickHandler);
    }

    public update(options: VisualUpdateOptions): void {
        if (this.disposed) return;
        this.renderEvents.abort();
        this.renderEvents = new AbortController();
        this.selectionRows = [];
        // §12 — this render replaces the colgroup and the resize handles an
        // in-flight drag closed over, so that drag cannot be allowed to finish:
        // its mouseup was persisting the OLD width vector against the NEW
        // column shape (five widths for six columns).
        this.cancelDrag?.();
        this.eventService.renderingStarted(options);
        this.lastUpdateOptions = options;

        if (this.licenseGate.blockedThisFrame()) {
            this.target.style.display = "none";
            this.eventService.renderingFinished(options);
            return;
        }
        this.target.style.display = "";

        try {
            // Refresh high contrast state each update
            this.readHighContrast((this.host as any).colorPalette);

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
                ? this.hcBackground
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
            if (!sparklineMeasure) {
                this.renderEmpty("Add a numeric Measure or Sparkline Value to draw the trend.");
                this.eventService.renderingFinished(options);
                return;
            }

            // Display names never determine aggregation or status semantics.
            const measureFormat: string[] = tableMeasures.map(m => {
                const fmt = m.source.format || "";
                if (fmt.indexOf("%") >= 0) return "percent";
                if (fmt.indexOf(".") >= 0) return "decimal";
                return "integer";
            });
            // The measure's OWN model format string, kept alongside the coarse
            // kind above (NEXUS cycle-12 §3): the kind alone threw away the
            // currency symbol and the required/optional decimal counts, so a
            // `$#,0.00` measure rendered as `6234.6` and a `0.00%` measure —
            // which Power BI stores as a FRACTION — rendered 100x too small.
            const measureFormatString: string[] = tableMeasures.map(m => m.source.format || "");

            // Column display names
            const measureNames = tableMeasures.map(m => m.source.displayName);
            const rowCategoryName = rowCatColumn.source.displayName;

            // ─── Sparkline time buckets (NEXUS cycle-12 §2) ──────────────
            // ORDER AND IDENTITY CONTRACT. The series is built from the
            // Sparkline Category's own distinct values — one bucket per
            // value — instead of pushing one point per raw categorical row:
            //   · two raw rows carrying the SAME date (an extra grouping
            //     differentiating them) aggregate into ONE point, where
            //     before they became two points and skewed the baseline;
            //   · a row missing a date entirely leaves that bucket a GAP
            //     for that row rather than shortening its series, so every
            //     row's points line up on the same time axis.
            // Buckets are ordered CHRONOLOGICALLY when the host delivers
            // genuine Date values. A text Sparkline Category carries no
            // chronology this renderer can read — inferring one from month
            // names would be a heuristic, not a contract — so its delivered
            // order is preserved verbatim, which is also what Power BI's own
            // query sort provides.
            // Same-date aggregation is SUM, matching this visual's existing
            // (and only) aggregation for ordinary numeric measures.
            const bucketByKey = new Map<string, SparkBucket>();
            const bucketOrder: SparkBucket[] = [];
            const rawBucketKey: string[] = new Array(numRows);
            for (let i = 0; i < numRows; i++) {
                const raw = sparklineCatColumn.values[i];
                const time = raw instanceof Date ? raw.getTime() : null;
                const key = categoryKey(raw);
                rawBucketKey[i] = key;
                if (!bucketByKey.has(key)) {
                    const bucket: SparkBucket = {
                        key,
                        label: this.categoryLabel(raw),
                        time,
                        firstSeen: i
                    };
                    bucketByKey.set(key, bucket);
                    bucketOrder.push(bucket);
                }
            }
            const chronological = bucketOrder.length > 0
                && bucketOrder.every(b => b.time !== null && Number.isFinite(b.time));
            if (chronological) {
                bucketOrder.sort((a, b) => ((a.time as number) - (b.time as number)) || (a.firstSeen - b.firstSeen));
            }
            const bucketPos = new Map<string, number>();
            bucketOrder.forEach((bucket, index) => bucketPos.set(bucket.key, index));
            const bucketCount = bucketOrder.length;

            // Group data by row category
            // Each row in the categorical is a combination of (rowCategory, sparklineCategory)
            // We group by rowCategory and place each reading in its date bucket
            const rowMap = new Map<string, RowData>();
            const rowOrder: string[] = [];

            for (let i = 0; i < numRows; i++) {
                const rowCat = String(rowCatColumn.values[i] ?? "");
                const rowKey = categoryKey(rowCatColumn.values[i]);

                if (!rowMap.has(rowKey)) {
                    const selectionId = this.host.createSelectionIdBuilder()
                        .withCategory(rowCatColumn, i)
                        .createSelectionId();
                    rowMap.set(rowKey, {
                        category: rowCat,
                        measureValues: new Array(tableMeasures.length).fill(0),
                        measureCounts: new Array(tableMeasures.length).fill(0),
                        textValues: new Array(textColCount).fill(null),
                        textBucketPos: new Array(textColCount).fill(-1),
                        sparkSums: new Array(bucketCount).fill(0),
                        sparkCounts: new Array(bucketCount).fill(0),
                        sparklineValues: [],
                        selectionId,
                        firstRawIndex: i
                    });
                    rowOrder.push(rowKey);
                }

                const row = rowMap.get(rowKey)!;
                const pos = bucketPos.get(rawBucketKey[i]) ?? -1;

                // Accumulate numeric measures. measureCounts is the row's
                // MISSINGNESS record (§1): a count of 0 means no value was
                // ever observed, which is not the same fact as a sum of 0.
                for (let m = 0; m < tableMeasures.length; m++) {
                    const v = tableMeasures[m].values[i] as number;
                    if (typeof v === "number" && Number.isFinite(v)) {
                        row.measureValues[m] += v;
                        row.measureCounts[m]++;
                    }
                }

                // Capture text column values. "Most recent" means the value at
                // the LATEST bucket in the order contract above (§2) — raw row
                // order is not chronology. Ties within one bucket keep the last
                // raw row, exactly as before.
                let tIdx = 0;
                const takeText = (raw: powerbi.PrimitiveValue) => {
                    if (pos >= row.textBucketPos[tIdx]) {
                        row.textValues[tIdx] = raw == null ? null : String(raw);
                        row.textBucketPos[tIdx] = pos;
                    }
                };
                for (let t = 0; t < textColsFromCategories.length; t++, tIdx++) {
                    takeText(textColsFromCategories[t].values[i]);
                }
                for (let t = 0; t < textColsFromValues.length; t++, tIdx++) {
                    takeText(textColsFromValues[t].values[i]);
                }

                // Collect the sparkline reading into its date bucket. A null or
                // NaN reading contributes NOTHING (§1): it is not coerced to
                // zero, so "no reading" and "an observed zero" stay distinct.
                const sv = sparklineMeasure.values[i] as number;
                if (pos >= 0 && typeof sv === "number" && Number.isFinite(sv)) {
                    row.sparkSums[pos] += sv;
                    row.sparkCounts[pos]++;
                }
            }

            for (const [, row] of rowMap) {
                // Average percentage measures instead of leaving as sum
                for (let m = 0; m < tableMeasures.length; m++) {
                    if (measureFormat[m] === "percent" && row.measureCounts[m] > 0) {
                        row.measureValues[m] /= row.measureCounts[m];
                    }
                }
                // Resolve each bucket: an observed reading, or a genuine gap.
                // The leading/trailing ZERO TRIM that used to run here is gone
                // (§1) — it deleted real readings, so [10,20,0] plotted as the
                // identical rising line as [0,10,20] and reported ▲ +100.0%
                // when the series had in fact collapsed to zero.
                row.sparklineValues = row.sparkSums.map(
                    (sum, index) => (row.sparkCounts[index] > 0 ? sum : null)
                );
            }

            // Build rows array preserving insertion order
            let rows: RowData[] = rowOrder.map(key => rowMap.get(key)!);

            // Apply sorting
            const tblSettings = this.formattingSettings.tableCardSettings;
            const spkSettings = this.formattingSettings.sparklineCardSettings;
            const sortSettings = this.formattingSettings.sortCardSettings;

            const sortCol = Math.max(0, Math.trunc(sortSettings.sortColumn.value || 0));
            const sortDir = (sortSettings.sortDirection.value.value as string) === "desc" ? -1 : 1;

            const sortValue = (row: RowData): string | number | null => {
                if (sortCol === 0) return row.category.toLowerCase();
                if (sortCol <= tableMeasures.length) {
                    const index = sortCol - 1;
                    return row.measureCounts[index] > 0 ? row.measureValues[index] : null;
                }
                if (sortCol === tableMeasures.length + 1) return lastObserved(row.sparklineValues);
                return row.textValues[sortCol - tableMeasures.length - 2]?.toLowerCase() ?? null;
            };
            rows.sort((a, b) => {
                const aVal = sortValue(a), bVal = sortValue(b);
                if (aVal == null || bVal == null) {
                    return aVal == null && bVal == null ? a.firstRawIndex - b.firstRawIndex : aVal == null ? 1 : -1;
                }
                return sortDir * (aVal < bVal ? -1 : aVal > bVal ? 1 : 0) || a.firstRawIndex - b.firstRawIndex;
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
            let visibleBackground = compositeOver(outerBgHex, outerBgTransparencyPct, reportThemeBg ?? "#ffffff");
            const governingBg = !bgPainted && rowUserSet
                ? compositeOver(rowColorRaw, tblSettings.rowTransparency.value ?? 0, visibleBackground)
                : visibleBackground;
            const autoTheme: Theme = surfaceTone(this.isHighContrast ? this.hcBackground : governingBg);

            // ─── Nexus Codex Theme (#819) ───────────────────────────────
            // ONE mode switch ABOVE the ladder resolved immediately above —
            // this is the visual's only theme derivation, so it is the only
            // place the resolver is called and the single object below is
            // routed through every renderer (rows, sparks, signature).
            //   Auto  — returns exactly the ladder's own answer: same theme,
            //           same fill, same transparency. Zero pixel change.
            //   Dark/Light/Neon — the Codex card token is painted at the
            //           card's own Surface Transparency INSTEAD of the user's
            //           Background colour, and the forced token set governs
            //           the table's surfaces (container, header, rows) and
            //           the text inks. Accent, band, spark and fx colours
            //           stay the user's.
            // High contrast already collapsed to Auto inside the resolver —
            // no HC branch is added here.
            const codex = resolveCodexTheme(this.formattingSettings.codexTheme, {
                hcActive: this.isHighContrast,
                autoTheme,
                autoBgHex: outerBgHex,
                autoTransparencyPct: outerBgTransparencyPct,
                behindHex: reportThemeBg ?? "#ffffff",
            });
            const theme: Theme = codex.theme;
            const inkOverride = codex.mode !== "auto";
            if (inkOverride) {
                // The Codex surface replaces the user's Background as BOTH the
                // painted container fill and the surface every ink below is
                // judged against (rows composite over it at Row Transparency).
                visibleBackground = codex.surfaceHex;
                this.container.style.backgroundColor = toRgba(codex.bgHex, codex.transparencyPct);
            }

            // D-16 adaptive sweep: untouched LIGHT-theme defaults swap to dark
            // tokens on a dark surface so nothing is invisible. HC wins; a
            // user-set colour is honoured verbatim — EXCEPT under a forced
            // Codex mode, where the surface belongs to the mode and a pane
            // colour chosen for another surface is treated as the default.
            const dk = surfaceTokens("dark");
            const adapt = (userHex: string, defHex: string, darkTok: string): string => {
                const effective = inkOverride ? defHex : userHex;
                return (effective === defHex && theme === "dark") ? darkTok : effective;
            };

            // Retrieve settings values, applying high contrast overrides
            const headerBg = this.isHighContrast ? this.hcBackground : adapt(tblSettings.headerBackground.value.value, "#f8f6f0", dk.card);
            const headerTextColor = this.isHighContrast ? this.hcForeground
                : adaptiveInk(tblSettings.headerTextColor.value.value, "#333333", headerBg, inkOverride);
            // Rows follow the surface: an explicit Row Color is honoured; else
            // the rows go dark on a dark background (so the whole table adapts,
            // not just the text) and stay white on light (D-06 parity).
            // A forced Codex mode owns this surface too — the rows ARE the
            // card face on a table, so an opaque white Row Color would hide
            // the Codex surface the mode just painted on the container.
            const rowColor = this.isHighContrast ? this.hcBackground
                : ((rowUserSet && !inkOverride) ? rowColorRaw : (theme === "dark" ? dk.card : "#ffffff"));
            const altRowColor = this.isHighContrast ? this.hcBackground : adapt(tblSettings.alternateRowColor.value.value, "#faf9f5", dk.canvas);

            const bandTintValueEnabled = tblSettings.bandTintValue?.value ?? true;
            const bandTintDotEnabled = spkSettings.bandTintDot?.value ?? true;
            const rowTransparencyPct = tblSettings.rowTransparency.value ?? 0;
            const fontSize = bounded(tblSettings.fontSize.value, 12, 8, 72);
            const rowHeight = bounded(tblSettings.rowHeight.value, 32, 12, 300);
            const showGrid = tblSettings.showGridLines.value;

            const spkHeight = bounded(spkSettings.sparklineHeight.value, 24, 8, 300);
            const spkType = spkSettings.sparklineType.value.value as string;
            const spkTransparencyPct = spkSettings.sparklineTransparency.value ?? 0;
            const showDot = spkSettings.showDot.value;
            const dotColor = this.isHighContrast ? this.hcForeground : spkSettings.dotColor.value.value;
            const lineWidth = bounded(spkSettings.lineWidth.value, 1.5, 0.5, Math.min(12, spkHeight / 2));

            // Per-surface text treatment (TEXT-01) — each composite's Font
            // Size 0 = "follow the shared Font Size" (D-06: an old report's
            // customised shared size still governs every cell at defaults);
            // bold-off falls back to each surface's own pre-existing
            // hardcoded weight (header 600, category-cell 500, measure 400).
            const defaultFamily = "Segoe UI, Tahoma, Geneva, Verdana, sans-serif";
            const rowLabelFamily = tblSettings.rowLabelFontFamily?.value || defaultFamily;
            const rowLabelSize = (tblSettings.rowLabelFontSize?.value || 0) > 0 ? bounded(tblSettings.rowLabelFontSize.value, fontSize, 8, 72) : fontSize;
            const rowLabelWeight = this.weightFor(tblSettings.rowLabelBold?.value, "500");
            const rowLabelStyle = tblSettings.rowLabelItalic?.value ? "italic" : "normal";
            const rowLabelDecoration = tblSettings.rowLabelUnderline?.value ? "underline" : "none";

            const valueFamily = tblSettings.valueFontFamily?.value || defaultFamily;
            const valueSize = (tblSettings.valueFontSize?.value || 0) > 0 ? bounded(tblSettings.valueFontSize.value, fontSize, 8, 72) : fontSize;
            const valueWeight = this.weightFor(tblSettings.valueBold?.value, "400");
            const valueStyle = tblSettings.valueItalic?.value ? "italic" : "normal";
            const valueDecoration = tblSettings.valueUnderline?.value ? "underline" : "none";

            const headerFamily = tblSettings.headerFontFamily?.value || defaultFamily;
            const headerSize = (tblSettings.headerFontSize?.value || 0) > 0 ? bounded(tblSettings.headerFontSize.value, fontSize, 8, 72) : fontSize;
            const headerWeight = this.weightFor(tblSettings.headerBold?.value, "400");
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
                const adaptiveTitle = adaptiveInk(setTitle, "#1a1a2e", visibleBackground, inkOverride);
                titleEl.style.color = this.isHighContrast
                    ? this.hcForeground
                    : adaptiveTitle;
                titleEl.style.padding = "8px 12px 4px";
                this.container.appendChild(titleEl);
            }

            // Apply grid class
            this.container.className = "sparkline-table-container " + (showGrid ? "grid-lines" : "no-grid-lines");

            // §8 — the resize handle's hover tint is the last painted surface
            // that lives in the stylesheet; hand it the palette's foreground so
            // no literal colour reaches the DOM in high contrast.
            if (this.isHighContrast) {
                this.container.style.setProperty("--codex-resize-hover", this.hcForeground);
            } else {
                this.container.style.removeProperty("--codex-resize-hover");
            }

            // Build the table
            const table = document.createElement("table");
            table.setAttribute("role", "grid");
            table.setAttribute("aria-label", rowCategoryName);
            table.setAttribute("aria-multiselectable", "true");
            table.style.tableLayout = "fixed";
            table.style.width = "100%";

            // Column widths (Neil 2026-07-15). DEFAULT = computed auto layout:
            // Trend wide, values legible, Δ slim, sums to 100. These can be
            // click-and-drag resized (handles added on the header below); a drag
            // persists the new widths via persistProperties, and they override
            // the defaults on the next render. DOM/column order:
            //   cat · spark · [measures] · [text] · Δ
            const valueColCount = tableMeasures.length + textColCount;
            const catW = 16;
            const deltaW = 10;
            const perValue = valueColCount > 0 ? Math.min(20, Math.max(13, 44 / valueColCount)) : 0;
            const spkW = Math.max(20, 100 - catW - deltaW - perValue * valueColCount);
            const defaultWidths: number[] = [catW, spkW];
            for (let m = 0; m < tableMeasures.length; m++) defaultWidths.push(perValue);
            for (let t = 0; t < textColCount; t++) defaultWidths.push(perValue);
            defaultWidths.push(deltaW);

            let widths = normalizedWidths(defaultWidths);
            try {
                const rawWidths = (dataView.metadata?.objects?.columnResize as { widths?: string } | undefined)?.widths;
                if (typeof rawWidths === "string" && rawWidths) {
                    const parsed = JSON.parse(rawWidths);
                    if (Array.isArray(parsed) && parsed.length === defaultWidths.length
                        && parsed.every((n) => typeof n === "number" && Number.isFinite(n) && n > 0)) {
                        widths = normalizedWidths(parsed as number[]);
                    }
                }
            } catch { /* bad persisted value — fall back to defaults */ }

            const colgroup = document.createElement("colgroup");
            const cols: HTMLElement[] = [];
            for (let i = 0; i < widths.length; i++) {
                const col = document.createElement("col");
                col.style.width = widths[i] + "%";
                colgroup.appendChild(col);
                cols.push(col);
            }
            table.appendChild(colgroup);

            // Header
            const thead = document.createElement("thead");
            const headerRow = document.createElement("tr");

            // Build headers with matching alignment classes
            const addTh = (text: string, className: string) => {
                const th = document.createElement("th");
                th.textContent = text;
                th.title = text;
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
                th.style.letterSpacing = "0";
                // §8 — the header rule's fixed #e0ddd4 / #d0cdc4 separator is a
                // painted surface and must resolve from the palette in HC.
                if (this.isHighContrast) {
                    th.style.borderBottomColor = this.hcForeground;
                }
                headerRow.appendChild(th);
            };

            addTh(rowCategoryName, "category-cell");
            // Trend header states the timeframe (Neil 2026-07-15) — the first→
            // last distinct Sparkline Category label, e.g. "Trend · Jan–Jun".
            const trendBase = this.localizationManager.getDisplayName("Visual_Header_Trend") || "Trend";
            // Labels come from the ORDERED buckets (§2), so the header states
            // the period's true first→last endpoints rather than the first and
            // last text the raw rows happened to mention. Date buckets carry a
            // locale-formatted label: a native Date stringified raw produced a
            // 1155px header string inside a 329px column.
            const spkCatLabels: string[] = bucketOrder.map(b => b.label).filter(label => label !== "");
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

            // ─── Click-and-drag column resize (Neil 2026-07-15) ─────────────
            // A thin handle on each header cell's right border; dragging trades
            // width between that column and its right neighbour (min 6% each,
            // pair sum preserved so the table always totals 100). On release
            // the new widths persist via persistProperties and override the
            // computed defaults next render. stopPropagation keeps the drag off
            // the header's sort/click + the row context menu.
            const liveWidths = widths.slice();
            let minimumColumnWidths: number[] = [];
            const fitTable = () => {
                table.style.minWidth = Math.ceil(Math.max(0,
                    ...minimumColumnWidths.map((minimum, index) => minimum * 100 / liveWidths[index])
                )) + "px";
            };
            const persistWidths = () => {
                const rounded = liveWidths.map(width => Math.round(width * 1000) / 1000);
                rounded[rounded.length - 1] = Math.round((100 - rounded.slice(0, -1).reduce((sum, width) => sum + width, 0)) * 1000) / 1000;
                this.host.persistProperties({
                    merge: [{ objectName: "columnResize", selector: null as never,
                        properties: { widths: JSON.stringify(rounded) } }]
                });
            };
            const headerThs = Array.from(headerRow.children) as HTMLElement[];
            for (let i = 0; i < headerThs.length - 1 && i < cols.length - 1; i++) {
                const th = headerThs[i];
                th.style.position = "relative";
                const handle = document.createElement("div");
                handle.className = "col-resize-handle";
                handle.tabIndex = this.interactionsAllowed() ? 0 : -1;
                handle.setAttribute("role", "separator");
                handle.setAttribute("aria-orientation", "vertical");
                handle.setAttribute("aria-label", `Resize ${th.textContent}`);
                handle.setAttribute("aria-valuenow", String(Math.round(liveWidths[i])));
                handle.title = `Resize ${th.textContent}`;
                th.appendChild(handle);
                const setPair = (wA: number, wB: number, deltaPct: number, tableW: number) => {
                    const minA = Math.min((wA + wB) / 2, (minimumColumnWidths[i] ?? 1) / tableW * 100);
                    const minB = Math.min((wA + wB) / 2, (minimumColumnWidths[i + 1] ?? 1) / tableW * 100);
                    const newA = Math.max(minA, Math.min(wA + wB - minB, wA + deltaPct));
                    const newB = wA + wB - newA;
                    liveWidths[i] = newA;
                    liveWidths[i + 1] = newB;
                    cols[i].style.width = newA + "%";
                    cols[i + 1].style.width = newB + "%";
                    handle.setAttribute("aria-valuenow", String(Math.round(newA)));
                    fitTable();
                };
                this.listen(handle, "keydown", (e: KeyboardEvent) => {
                    if (!this.interactionsAllowed() || !["ArrowLeft", "ArrowRight"].includes(e.key)) return;
                    e.preventDefault();
                    e.stopPropagation();
                    setPair(liveWidths[i], liveWidths[i + 1],
                        (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 5 : 1),
                        table.getBoundingClientRect().width || 1);
                    persistWidths();
                });
                this.listen(handle, "mousedown", (e: MouseEvent) => {
                    if (!this.interactionsAllowed()) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const startX = e.clientX;
                    const tableW = table.getBoundingClientRect().width || 1;
                    const wA = liveWidths[i];
                    const wB = liveWidths[i + 1];
                    const onMove = (me: MouseEvent) => {
                        setPair(wA, wB, ((me.clientX - startX) / tableW) * 100, tableW);
                    };
                    // §12 — detaching the document listeners is now a named
                    // operation the visual OWNS, so destroy() and the next
                    // update() can both abandon the drag. Abandoning only
                    // detaches; it never persists, because the width vector in
                    // flight belongs to a table that no longer exists.
                    const abandon = () => {
                        document.removeEventListener("mousemove", onMove);
                        document.removeEventListener("mouseup", onUp);
                        if (this.cancelDrag === abandon) this.cancelDrag = null;
                    };
                    const onUp = () => {
                        abandon();
                        persistWidths();
                    };
                    this.cancelDrag?.();   // one drag at a time
                    this.cancelDrag = abandon;
                    document.addEventListener("mousemove", onMove);
                    document.addEventListener("mouseup", onUp);
                });
            }

            // Body
            const tbody = document.createElement("tbody");
            // Sparks are rendered in a 2nd pass (after the table lays out) so
            // each fills its cell's ACTUAL width — the flex Trend column.
            const sparkQueue: Array<{ td: HTMLElement; values: (number | null)[]; color: string; band: string | null; glowHex: string }> = [];

            for (let r = 0; r < rows.length; r++) {
                const row = rows[r];
                const tr = document.createElement("tr");
                tr.tabIndex = this.interactionsAllowed() ? 0 : -1;
                tr.setAttribute("aria-selected", "false");
                if (row.selectionId) this.selectionRows.push({ element: tr, identity: row.selectionId });
                tr.style.height = rowHeight + "px";

                // Row background color — per-region transparency (D-05)
                // applied via toRgba(); high-contrast values are already
                // resolved above (hcBackground) and left untouched (never
                // re-wrapped) to preserve the existing HC short-circuit.
                const rowBaseColor = r % 2 === 1 ? altRowColor : rowColor;
                const rowSurface = this.isHighContrast ? this.hcBackground
                    : compositeOver(rowBaseColor, rowTransparencyPct, visibleBackground);
                const textColor = this.isHighContrast ? this.hcForeground
                    : adaptiveInk(tblSettings.textColor.value.value, "#333333", rowSurface, inkOverride);
                const measureTextColor = this.isHighContrast ? this.hcForeground
                    : adaptiveInk(tblSettings.measureTextColor.value.value, "#333333", rowSurface, inkOverride);
                tr.style.color = textColor;
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
                    const hoverInk = readableInk(surfaceTokens(theme).muted, rowSurface);
                    this.listen(tr, "mouseenter", () => { tr.style.boxShadow = `inset 0 0 0 1px ${hoverInk}`; });
                    this.listen(tr, "mouseleave", () => { tr.style.boxShadow = ""; });
                }

                // v3 band engine (01-18 Task 3) — self-referential trend
                // band: this row's latest sparkline point vs. the mean of
                // its own prior points (a bounded, documented baseline
                // derivation since this visual has no genuine target/goal
                // data role, mirroring the 01-16 Callback Card precedent).
                // Drives BOTH the value-column tint and the endpoint dot so
                // they always agree (§2 "one colour token per visual").
                const spkVals = row.sparklineValues;
                const observedCount = spkVals.reduce<number>((n, v) => n + (v != null ? 1 : 0), 0);
                const lastSpkIdx = lastObservedIndex(spkVals);
                const lastSpkVal = lastSpkIdx < 0 ? null : (spkVals[lastSpkIdx] as number);
                const priorSpkVals = (lastSpkIdx < 0 ? [] : spkVals.slice(0, lastSpkIdx))
                    .filter((v): v is number => v != null);
                const spkBaseline = priorSpkVals.length > 0
                    ? priorSpkVals.reduce((a, b) => a + b, 0) / priorSpkVals.length
                    : null;
                // Relative change against the baseline's MAGNITUDE (§5). The
                // old signed denominator reversed the reading on negative
                // series: [-30,-20,-10] rises but scored ▼ −60.0%, and
                // [-10,-20,-30] falls but scored a green ▲ +100.0%.
                // No baseline, a zero baseline or a non-finite one yields NO
                // percentage at all — the em dash the cell already uses for
                // "no value" — never 0%, Infinity, NaN or −100% (§1/§5).
                const deltaRatio = (lastSpkVal != null && spkBaseline != null
                    && spkBaseline !== 0 && Number.isFinite(spkBaseline) && Number.isFinite(lastSpkVal))
                    ? (lastSpkVal - spkBaseline) / Math.abs(spkBaseline)
                    : null;
                // band(1 + r, 1) is band(value, target)'s OWN law re-expressed
                // on the relative change: for a positive baseline
                // 1 + (v−t)/t === v/t, so every existing threshold and colour
                // is reproduced EXACTLY (no default is changed); for a negative
                // baseline it reads the true direction instead of taking the
                // shared engine's "non-positive target ⇒ success" shortcut,
                // which is why every falling negative series came out green.
                // No computable change ⇒ no band at all: the row falls back to
                // its flat, neutral colours rather than being tinted green.
                const rowBandColor: string | null = deltaRatio == null || deltaRatio === 0
                    ? null
                    : bandColor(band(1 + deltaRatio, 1), theme);

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
                const hasMeasureTextColorOverride = !!(
                    rowInstanceObjects && (rowInstanceObjects as Record<string, unknown>).tableSettings &&
                    ((rowInstanceObjects as any).tableSettings.measureTextColor !== undefined)
                );
                const resolvedMeasureTextColor = this.isHighContrast
                    ? this.hcForeground
                    : (hasMeasureTextColorOverride
                        ? this.measureTextColorHelper?.getColorForMeasure(rowInstanceObjects, "measureTextColor") ?? measureTextColor
                        : measureTextColor);

                // v2 board look (01-18 Task 3) — "band-tinted value column":
                // an active fx RULE on Measure Text Color (a more deliberate
                // override than the flat default) always wins; otherwise the
                // Band-Tint Value Column toggle governs whether the FIRST
                // measure column (the row's headline "value") resolves via
                // rowBandColor instead of the flat Measure Text Color.
                const useValueBandTint = bandTintValueEnabled && !hasMeasureTextColorOverride
                    && !this.isHighContrast && rowBandColor !== null;

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
                    const count = row.measureCounts[m];
                    const fmt = measureFormat[m];
                    if (count <= 0) {
                        // No reading was ever observed for this measure on this
                        // row (\u00A71). A total over missing values is not zero \u2014
                        // render the same em dash the cell already uses for "no
                        // value" rather than asserting an observed 0.
                        td.textContent = "\u2014";
                    } else {
                        td.textContent = this.formatMeasure(num, count, fmt, measureFormatString[m]);
                    }
                    td.style.fontSize = valueSize + "px";
                    // Apply measure text color only for non-badge cells:
                    // per-row fx-resolved (TEXT-02); badge chrome untouched.
                    // The FIRST measure column additionally honours the
                    // band-tint toggle above (D-16: fx rule / toggle-off
                    // still resolve to the flat colour untouched).
                    td.style.color = (m === 0 && useValueBandTint)
                        ? readableInk(rowBandColor as string, rowSurface)
                        : resolvedMeasureTextColor;
                    tr.appendChild(td);
                }

                // Text column cells: same row-label text treatment as the
                // category cell (both render via the shared Text Color).
                for (let t = 0; t < textColCount; t++) {
                    const td = document.createElement("td");
                    td.className = "category-cell";
                    td.textContent = row.textValues[t] ?? "\u2014";
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
                deltaTd.style.color = textColor;
                if (deltaRatio != null) {
                    const deltaPct = deltaRatio * 100;
                    const up = deltaPct >= 0;
                    const pill = document.createElement("span");
                    pill.textContent = deltaRatio === 0 ? "0.0%"
                        : `${up ? "▲" : "▼"} ${up ? "+" : "−"}${Math.abs(deltaPct).toFixed(1)}%`;
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
                        pill.style.color = rowBandColor
                            ? readableInk(rowBandColor, compositeOver(rowBandColor, 85, rowSurface))
                            : textColor;
                        if (rowBandColor) pill.style.backgroundColor = toRgba(rowBandColor, 85);
                        // Neon (#819) — the Δ pill is a CHIP, one of this
                        // visual's primary marks, so it flares. The chip's
                        // own band colour is kept (a user/data colour); only
                        // the halo takes the flare colour under scope
                        // "flare", or the chip's own hue under scope "all".
                        // Its 11px text is body text and never glows.
                        if (codex.neon) {
                            pill.style.boxShadow = neonShadow(
                                neonColorFor(rowBandColor ?? textColor, codex), codex.glow);
                        }
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
                // §8 — the "no trend" em dash this cell can render is painted
                // text and was taking the stylesheet's literal #333 ink in high
                // contrast. Found by the literal-colour audit.
                spkTd.style.color = this.isHighContrast ? this.hcForeground : textColor;

                // Two OBSERVED readings make a trend; one point (or none) does
                // not (§1). An all-gap series shows the "no value" em dash,
                // while a genuine all-zero series is a real flat line and is
                // now drawn as one instead of being trimmed out of existence.
                if (observedCount > 1) {
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
                    const hasSparkColorOverride = instanceObjects?.sparklineSettings?.sparklineColor !== undefined
                        || dataView.metadata?.objects?.sparklineSettings?.sparklineColor !== undefined;
                    const resolvedSpkColorHex = this.isHighContrast
                        ? this.hcForeground
                        : (rawSpk === "#130064" && !hasSparkColorOverride
                            ? (rowBandColor ?? readableInk(rawSpk, rowSurface)) : rawSpk);
                    const spkColorForRow = this.isHighContrast
                        ? resolvedSpkColorHex
                        : toRgba(resolvedSpkColorHex, spkTransparencyPct);
                    // Deferred to the 2nd pass (after table layout) so the spark
                    // fills its cell's ACTUAL width — the flex Trend column.
                    // glowHex — the row spark's OWN resolved hue (opaque form,
                    // never the rgba string): the flare halo's colour under
                    // Neon scope "all". The line/area/bar fill itself is left
                    // exactly as resolved above; a spark is DATA, and the
                    // contract keeps the user's (and the band's) data colours.
                    sparkQueue.push({ td: spkTd, values: row.sparklineValues, color: spkColorForRow, band: rowBandColor, glowHex: resolvedSpkColorHex });
                } else {
                    spkTd.textContent = "\u2014";
                }

                // Move the sparkline to the 2nd column (right after category).
                tr.insertBefore(spkTd, catTd.nextSibling);
                for (const cell of Array.from(tr.cells)) cell.setAttribute("role", "gridcell");

                // §8 — the row's grid separator came from the stylesheet's
                // fixed warm-grey (#e8e5dc) and never saw the palette, so the
                // table kept light-theme rules in a high-contrast report.
                if (this.isHighContrast) {
                    for (const cell of Array.from(tr.cells)) {
                        (cell as HTMLElement).style.borderBottomColor = this.hcForeground;
                    }
                }

                // Tooltip on row hover
                tr.style.cursor = this.interactionsAllowed() ? "pointer" : "default";
                const rowRef = row;
                const rowMeasureNames = measureNames;
                const rowMeasureFormats = measureFormat;
                const rowMeasureFormatStrings = measureFormatString;
                this.listen(tr, "mousemove", (e: MouseEvent) => {
                    const tooltipItems: VisualTooltipDataItem[] = [
                        { displayName: rowCategoryName, value: rowRef.category }
                    ];
                    for (let mi = 0; mi < rowMeasureNames.length; mi++) {
                        // Same number-rendering law as the cell (§1/§3) — the
                        // tooltip previously carried its own copy and so
                        // repeated every formatting defect verbatim.
                        tooltipItems.push({
                            displayName: rowMeasureNames[mi],
                            value: this.formatMeasure(
                                rowRef.measureValues[mi], rowRef.measureCounts[mi],
                                rowMeasureFormats[mi], rowMeasureFormatStrings[mi])
                        });
                    }
                    for (let index = 0; index < textColNames.length; index++) {
                        tooltipItems.push({ displayName: textColNames[index], value: rowRef.textValues[index] ?? "\u2014" });
                    }
                    tooltipItems.push(
                        { displayName: "Period", value: spkCatLabels.length
                            ? `${spkCatLabels[0]} – ${spkCatLabels[spkCatLabels.length - 1]}` : "\u2014" },
                        { displayName: "Latest", value: lastSpkVal == null ? "\u2014"
                            : formatModelNumber(lastSpkVal, sparklineMeasure.source.format, this.host.locale) },
                        { displayName: "Latest category", value: bucketOrder[lastSpkIdx]?.label ?? "\u2014" },
                        { displayName: "Prior mean", value: spkBaseline == null ? "\u2014"
                            : formatModelNumber(spkBaseline, sparklineMeasure.source.format, this.host.locale) },
                        { displayName: "Δ", value: deltaTd.textContent }
                    );
                    this.tooltipService.show({
                        coordinates: [e.clientX, e.clientY],
                        isTouchEvent: false,
                        dataItems: tooltipItems,
                        identities: rowRef.selectionId ? [rowRef.selectionId] : []
                    });
                });
                this.listen(tr, "mouseleave", () => {
                    this.tooltipService.hide({ isTouchEvent: false, immediately: false });
                });

                // Cross-filtering on click
                this.listen(tr, "click", (e: MouseEvent) => {
                    if (this.interactionsAllowed() && rowRef.selectionId) {
                        this.selectionManager.select(rowRef.selectionId, e.ctrlKey || e.metaKey)
                            .then(ids => this.applySelection(ids));
                    }
                    e.stopPropagation();
                });
                this.listen(tr, "keydown", (e: KeyboardEvent) => {
                    if (!this.interactionsAllowed()) return;
                    if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        if (rowRef.selectionId) this.selectionManager.select(rowRef.selectionId, e.ctrlKey || e.metaKey)
                            .then(ids => this.applySelection(ids));
                    } else if (e.key === "Escape") {
                        e.preventDefault();
                        this.selectionManager.clear().then(() => this.applySelection([]));
                    } else if (["ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) {
                        e.preventDefault();
                        const index = this.selectionRows.findIndex(entry => entry.element === tr);
                        const next = e.key === "Home" ? 0 : e.key === "End" ? this.selectionRows.length - 1
                            : Math.max(0, Math.min(this.selectionRows.length - 1, index + (e.key === "ArrowDown" ? 1 : -1)));
                        this.selectionRows[next]?.element.focus();
                    } else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
                        e.preventDefault();
                        const box = tr.getBoundingClientRect();
                        if (rowRef.selectionId) this.selectionManager.showContextMenu(rowRef.selectionId, { x: box.x, y: box.y });
                    }
                });

                tbody.appendChild(tr);
            }

            table.appendChild(tbody);
            this.container.appendChild(table);
            this.applySelection();

            // Measure rendered typography, including pill padding, before
            // laying out sparks. Narrow reports scroll instead of hiding values.
            const measureContext = document.createElement("canvas").getContext("2d");
            minimumColumnWidths = headerThs.map((_header, index) => {
                return Math.ceil(Math.max(...Array.from(table.rows).map(tableRow => {
                    const cell = tableRow.cells[index];
                    if (cell.classList.contains("sparkline-cell") && cell.tagName === "TD") return 120;
                    const textElement = cell.querySelector("span") ?? cell;
                    const style = getComputedStyle(textElement);
                    if (measureContext) measureContext.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
                    const text = style.textTransform === "uppercase" ? textElement.textContent.toUpperCase() : textElement.textContent;
                    const textWidth = measureContext?.measureText(text).width ?? text.length * fontSize;
                    const cellStyle = getComputedStyle(cell);
                    const padding = parseFloat(cellStyle.paddingLeft) + parseFloat(cellStyle.paddingRight)
                        + (textElement !== cell ? parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) : 0);
                    return textWidth + padding + 4;
                })));
            });
            fitTable();

            // 2nd pass — the table is now laid out, so each spark renders at its
            // cell's REAL width (the flex Trend column, as wide as the card
            // allows). This is what makes the trend fill the card without any
            // manual width control (Neil 2026-07-15).
            for (const q of sparkQueue) {
                const savedWidth = dataView.metadata?.objects?.sparklineSettings?.sparklineWidth;
                const availableWidth = Math.max(4, q.td.clientWidth - 8);
                const w = typeof savedWidth === "number" && savedWidth > 0
                    ? Math.max(4, Math.min(availableWidth, savedWidth)) : availableWidth;
                const svg = this.renderSparkline(
                    q.values, w, spkHeight, q.color, spkType,
                    lineWidth, showDot, dotColor,
                    {
                        theme, hc: this.isHighContrast, bandTint: bandTintDotEnabled, bandColorHex: q.band,
                        // Neon (#819) — ONE flare per row, on the row's whole
                        // <svg> group (line + area + bars + endpoint dot), so
                        // the table's primary data marks glow without a
                        // per-element filter stack. null outside Neon and,
                        // via the resolver, under high contrast.
                        neon: codex.neon ? { color: neonColorFor(q.glowHex, codex), glow: codex.glow } : null
                    }
                );
                if (typeof savedWidth === "number" && savedWidth > 0) {
                    svg.style.width = w + "px";
                    svg.style.margin = "0 auto";
                }
                q.td.appendChild(svg);
            }

            // Corner-bracket card signature (01-18 Task 3) — a table has no
            // single governing value/target, so it carries the suite's
            // constant brand accent (never a per-row band colour) rather
            // than the KPI-family visuals' signal-tinted bracket.
            applyCardSignature(this.cornerSignature, this.formattingSettings.cardSignature, {
                // Neon (#819) — the bracket is CHROME, not data: under scope
                // "flare" it takes the flare colour outright (the pilot's
                // rule), and its existing dark-only glow budget becomes the
                // card's Glow Strength.
                autoHex: neonColorFor(accentToken(theme), codex),
                flareHex: flareHexFor(codex),
                hcActive: this.isHighContrast,
                hcColor: this.hcForeground,
                mirror: true,
                glowMix: this.isHighContrast ? 0 : (codex.neon ? codex.glow : (theme === "dark" ? 55 : 0)),
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

    /** Resolve the host's high-contrast state through the shared HC rule (§8).
     *  Identical outcome to the previous hand-rolled read — active only when
     *  the palette says so, foreground/background taken from the palette — but
     *  routed through the one helper the suite shares, so the badge, grid and
     *  empty-state surfaces added below resolve from the same values. */
    private readHighContrast(colorPalette: unknown): void {
        const hc = applyHighContrast(colorPalette as HighContrastPalette, {
            fallbackColor: "#000000",
            fallbackBackground: "#ffffff"
        });
        this.isHighContrast = hc.active;
        if (hc.active) {
            this.hcForeground = hc.color;
            this.hcBackground = hc.background;
        }
    }

    /** The label a Sparkline Category value prints in the Trend header (§2).
     *  A native Date was previously stringified raw — "Sat Aug 01 2026
     *  00:00:00 GMT+1000 (…)" — generating a 1155px header string inside a
     *  329px column. Rendered in the HOST's locale instead. */
    private categoryLabel(raw: powerbi.PrimitiveValue): string {
        if (raw instanceof Date) {
            const locale = this.host?.locale;
            try {
                return raw.toLocaleDateString(locale || undefined);
            } catch {
                return raw.toLocaleDateString();
            }
        }
        return String(raw ?? "");
    }

    /** ONE number-rendering law for measure cells and their tooltips.
     *
     *  §1 — `count` is the row's missingness record. A count of 0 means no
     *  reading was ever observed, which is NOT an observed zero, so it renders
     *  the em dash the visual already uses for "no value".
     *
     *  §3 — when the customer has left BOTH Display Units and Decimal Places
     *  at "auto" (i.e. has expressed no preference), the measure's own model
     *  format and the host locale govern: a `0.00%` measure is a FRACTION and
     *  must be multiplied by 100, and a `$#,0.00` measure keeps its symbol and
     *  its two decimals. Explicit units/precision alter only scale and digits;
     *  model symbols and the host locale still govern. */
    private formatMeasure(value: number, count: number, kind: string, modelFormat: string): string {
        if (count <= 0) return "—";
        const ts = this.formattingSettings.tableCardSettings as any;
        const rawUnits = String(ts.displayUnits?.value?.value ?? "auto");
        const rawDecimals = String(ts.decimalPlaces?.value?.value ?? "auto");
        const explicit = (rawUnits && rawUnits !== "auto") || (rawDecimals && rawDecimals !== "auto");

        if (!explicit) {
            return formatModelNumber(value, modelFormat, this.host?.locale || undefined);
        }

        let format = modelFormat || (kind === "integer" ? "#,0" : "#,0.0");
        const explicitDp = rawDecimals !== "auto" ? Number(rawDecimals) : NaN;
        if (Number.isFinite(explicitDp)) {
            const dp = Math.max(0, Math.min(20, Math.trunc(explicitDp)));
            format = format.replace(/([#0][,#0]*)(?:\.[0#]+)?/g,
                (_match, integer: string) => integer + (dp ? "." + "0".repeat(dp) : ""));
        }
        let divisor = 1;
        let suffix = "";
        if (kind !== "percent") {
            const units = rawUnits === "auto"
                ? (Math.abs(value) >= 1e9 ? "billions" : Math.abs(value) >= 1e6 ? "millions" : "none")
                : rawUnits;
            const scaling: Record<string, [number, string]> = {
                thousands: [1e3, "K"], millions: [1e6, "M"], billions: [1e9, "B"]
            };
            [divisor, suffix] = scaling[units] ?? [1, ""];
        }
        return formatModelNumber(value / divisor, format, this.host?.locale || undefined) + suffix;
    }

    private renderEmpty(message: string): void {
        while (this.container.firstChild) {
            this.container.removeChild(this.container.firstChild);
        }
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = message;
        // §8 — the stylesheet pinned this to #999999, so the empty state stayed
        // mid-grey on black in a high-contrast report instead of taking the
        // palette's foreground.
        if (this.isHighContrast) {
            empty.style.color = this.hcForeground;
        } else {
            const background = this.formattingSettings.background;
            const behind = (this.host.colorPalette as any)?.background?.value ?? "#ffffff";
            let surface = compositeOver(background.backgroundColor.value.value, background.transparency.value, behind);
            // The empty state resolved the Codex card only in update() — a forced
            // Dark/Light stayed on the user's Background here (#819, left open by
            // the Sparkline Table executor). Same resolver, same rule: the mode
            // owns the surface and the ink is judged against it.
            const codex = resolveCodexTheme(this.formattingSettings.codexTheme, {
                hcActive: false, autoTheme: surfaceTone(surface),
                autoBgHex: background.backgroundColor.value.value,
                autoTransparencyPct: background.transparency.value, behindHex: behind,
            });
            if (codex.mode !== "auto") {
                surface = codex.surfaceHex;
                this.container.style.backgroundColor = toRgba(codex.bgHex, codex.transparencyPct);
            }
            empty.style.color = adaptiveInk("#333333", "#333333", surface);
        }
        this.container.appendChild(empty);
        // §8 — the empty state's corner brackets were the one applyCardSignature
        // call site that passed no high-contrast parameters, so they kept
        // painting the brand violet on a high-contrast canvas. Found by the
        // literal-colour audit; no NEXUS check covers this surface, so it is
        // measured by probe-MINE-2.py instead.
        //
        // `muted` must be dropped under HC, not just paired with hcColor:
        // shared/cardSignature.ts's styleBracket does
        //     const color = opts.muted ? opts.mutedColor : bandHex;
        // so a muted bracket DISCARDS the resolved colour and paints its own
        // default #8f8ab8 — passing hcColor alone changed nothing (measured).
        // Un-muting lets the palette colour through and drops the 0.4 opacity,
        // which is the right reading for high contrast anyway; glow is pinned
        // off there per the shared HC rule. Outside HC every argument is
        // unchanged, so the ordinary empty state renders exactly as before.
        applyCardSignature(this.cornerSignature, this.formattingSettings?.cardSignature, {
            autoHex: "#8f8ab8",
            hcActive: this.isHighContrast,
            hcColor: this.hcForeground,
            mirror: true,
            muted: !this.isHighContrast,
            glowMix: this.isHighContrast ? 0 : undefined
        });
    }

    private renderSparkline(
        data: (number | null)[],
        width: number,
        height: number,
        color: string,
        type: string,
        strokeWidth: number,
        showDot: boolean,
        dotColor: string,
        v3: {
            theme: Theme; hc: boolean; bandTint: boolean; bandColorHex: string | null;
            /** Neon flare for this row's whole mark group, or null (#819). */
            neon: { color: string; glow: number } | null;
        }
    ): SVGSVGElement {
        const padding = Math.min(Math.max(2, strokeWidth), width / 2, height / 2);
        const svgNs = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(svgNs, "svg") as SVGSVGElement;
        svg.setAttribute("width", "100%");
        svg.setAttribute("height", String(height));
        svg.setAttribute("viewBox", "0 0 " + width + " " + height);
        svg.setAttribute("preserveAspectRatio", "none");
        svg.classList.add("sparkline-svg");
        // Neon (#819) — ONE filter on the group covers the line, the area
        // wash, the bars and the endpoint dot. It REPLACES the dark-theme
        // per-line drop-shadow below rather than stacking on it, so the glow
        // a viewer sees is always the card's Glow Strength, never 60% plus it.
        if (v3.neon) svg.style.filter = neonFilter(v3.neon.color, v3.neon.glow);

        // §1 — the domain is taken over OBSERVED readings only; a gap must not
        // drag the scale to zero the way the old null-becomes-zero coercion did.
        const observed = data.filter((v): v is number => v != null);
        const minVal = observed.length > 0 ? Math.min(...observed) : 0;
        const maxVal = observed.length > 0 ? Math.max(...observed) : 0;

        const barSlot = (width - padding * 2) / Math.max(1, data.length);
        const xScale = scaleLinear()
            .domain([0, data.length - 1])
            .range(type === "bar"
                ? [padding + barSlot / 2, width - padding - barSlot / 2]
                : [padding, width - padding]);

        const domainMin = type === "bar" ? Math.min(0, minVal) : minVal;
        const domainMax = type === "bar" ? Math.max(0, maxVal) : maxVal;
        const yScale = scaleLinear()
            .domain([domainMin, domainMax === domainMin ? domainMin + 1 : domainMax])
            .range([height - padding, padding]);

        if (type === "bar") {
            // Bar chart sparkline
            const barWidth = Math.max(0, barSlot - Math.min(1, barSlot / 4));
            const zeroY = yScale(0);
            for (let i = 0; i < data.length; i++) {
                // A gap draws NO bar — not a zero-height bar sitting on the
                // axis, which would read as an observed zero (§1).
                if (data[i] == null) continue;
                const rect = document.createElementNS(svgNs, "rect");
                const x = xScale(i) - barWidth / 2;
                const y = yScale(data[i] as number);
                const barHeight = Math.max(1, Math.abs(zeroY - y));
                rect.setAttribute("x", String(x));
                rect.setAttribute("y", String(Math.min(height - padding - barHeight, Math.min(zeroY, y))));
                rect.setAttribute("width", String(barWidth));
                rect.setAttribute("height", String(Math.max(0, barHeight)));
                rect.setAttribute("fill", color);
                rect.setAttribute("fill-opacity", v3.hc ? "1" : "0.7");
                svg.appendChild(rect);
            }
        } else {
            // Line or area
            // Soft area fill under the line — ALWAYS drawn now (the board's
            // spark grammar; the type control is retired). Bolder on dark so
            // the signal-coloured wash reads; softer on light. HC drops it.
            const isDark = v3.theme === "dark" && !v3.hc;
            // .defined() — a missing reading BREAKS the line and the fill (§1).
            // It is not interpolated across and it is not plotted at zero.
            if (type === "area") {
                const areaGen = area<number | null>()
                    .defined(d => d != null)
                    .x((_d, i) => xScale(i))
                    .y0(height - padding)
                    .y1(d => yScale(d as number))
                    .curve(curveMonotoneX);
                const areaPath = document.createElementNS(svgNs, "path");
                areaPath.setAttribute("d", areaGen(data) || "");
                areaPath.setAttribute("fill", v3.hc ? "none" : color);
                if (!v3.hc) areaPath.setAttribute("fill-opacity", isDark ? "0.30" : "0.15");
                svg.appendChild(areaPath);
            }

            const lineGen = line<number | null>()
                .defined(d => d != null)
                .x((_d, i) => xScale(i))
                .y(d => yScale(d as number))
                .curve(curveMonotoneX);

            const linePath = document.createElementNS(svgNs, "path");
            linePath.setAttribute("d", lineGen(data) || "");
            linePath.setAttribute("fill", "none");
            linePath.setAttribute("stroke", color);
            linePath.setAttribute("stroke-width", String(strokeWidth));
            linePath.setAttribute("stroke-linecap", "round");
            linePath.setAttribute("stroke-linejoin", "round");
            // Neon glow on dark (per-line inline filter, no shared-id collision
            // across the table's many sparks). Skipped when the Codex Neon
            // group flare above already owns this row's glow (#819).
            if (isDark && !v3.neon) {
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
            if (!v3.hc && observed.length > 0 && minVal !== maxVal) {
                const whiskerColor = surfaceTokens(v3.theme).muted;
                const minIdx = data.indexOf(minVal);
                const maxIdx = data.indexOf(maxVal);
                [minIdx, maxIdx].forEach((idx) => {
                    const cx = xScale(idx);
                    const cy = yScale(data[idx] as number);
                    const tick = document.createElementNS(svgNs, "line");
                    tick.setAttribute("x1", String(cx));
                    tick.setAttribute("x2", String(cx));
                    tick.setAttribute("y1", String(Math.max(0, cy - 3)));
                    tick.setAttribute("y2", String(Math.min(height, cy + 3)));
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
        // The endpoint dot marks the last OBSERVED reading (§1) — a trailing
        // gap must not plant a dot on the axis at zero. With no band (a zero or
        // absent baseline, §5) the dot falls back to the flat Dot Color rather
        // than inheriting a colour the data does not support.
        const dotIdx = lastObservedIndex(data);
        if (showDot && dotIdx >= 0) {
            const lastIdx = dotIdx;
            const resolvedDotColor = v3.hc
                ? dotColor
                : (v3.bandTint ? (v3.bandColorHex ?? dotColor) : dotColor);
            const circle = document.createElementNS(svgNs, "circle");
            circle.setAttribute("cx", String(xScale(lastIdx)));
            circle.setAttribute("cy", String(yScale(data[lastIdx] as number)));
            circle.setAttribute("r", String(Math.max(2, strokeWidth)));
            circle.setAttribute("fill", resolvedDotColor);
            svg.appendChild(circle);
        }

        return svg;
    }

    private listen<K extends keyof HTMLElementEventMap>(
        element: HTMLElement, type: K, listener: (event: HTMLElementEventMap[K]) => void
    ): void {
        element.addEventListener(type, listener, { signal: this.renderEvents.signal });
    }

    private interactionsAllowed(): boolean {
        return (this.host as typeof this.host & { allowInteractions?: boolean }).allowInteractions !== false;
    }

    private applySelection(ids: powerbi.extensibility.ISelectionId[] = this.selectionManager.getSelectionIds()): void {
        if (this.disposed) return;
        for (const row of this.selectionRows) {
            const selected = ids.some(id => row.identity.equals(id as ISelectionId) || (id as ISelectionId).includes?.(row.identity));
            row.element.setAttribute("aria-selected", String(selected));
            const ink = this.isHighContrast
                ? (this.host.colorPalette as any).foregroundSelected?.value ?? this.hcForeground
                : row.element.style.color;
            row.element.style.outline = selected ? `2px solid ${ink}` : "";
            row.element.style.outlineOffset = "-2px";
        }
    }

    public destroy(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.renderEvents.abort();
        // Drop the in-flight licence check FIRST: its redraw callback replays
        // update() against a torn-down target otherwise (NEXUS lifecycle finding).
        this.licenseGate.dispose();
        // §12 — cancel the document-level drag listeners this visual owns and
        // drop the cached update options, so nothing can persist a width vector
        // or replay a render against a torn-down target after teardown.
        this.cancelDrag?.();
        this.cancelDrag = null;
        this.lastUpdateOptions = null;
        if (this.contextMenuHandler) {
            this.target.removeEventListener("contextmenu", this.contextMenuHandler);
        }
        this.target.removeEventListener("click", this.backgroundClickHandler);
        this.selectionRows = [];
        this.tooltipService.hide({ isTouchEvent: false, immediately: true });
        this.cornerSignature?.destroy();
        this.cornerSignature = null;
        while (this.container && this.container.firstChild) {
            this.container.removeChild(this.container.firstChild);
        }
        this.container?.remove();
        this.container = null;
        this.target = null;
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        this.formattingSettings.codexTheme.reveal();
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }
}
