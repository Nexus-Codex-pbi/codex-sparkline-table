"use strict";

import powerbi from "powerbi-visuals-api";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

import { BackgroundSettings } from "./shared/backgroundSettings";
import { TitleSettings } from "./shared/titleSettings";
import { textAlignFor, makeFontControl } from "./shared/textFormatting";

// TitleSettings + alignment helpers live in _shared/formatting/ (D-13,
// D-14 — frozen v2 standard from Plan 10). Re-exported so visual.ts can
// import them from "./settings" (stable import path, mirrors pbiKpiCard).
export { TitleSettings, textAlignFor };

const ConstantOrRule = powerbi.VisualEnumerationInstanceKinds.ConstantOrRule;

// Matches the pre-existing font-family on .sparkline-table-container in
// style/visual.less so the new font-family defaults render pixel-identical
// on old saved reports (D-06).
const FONT_STACK = "Segoe UI, Tahoma, Geneva, Verdana, sans-serif";

class TableCardSettings extends FormattingSettingsCard {
    headerBackground = new formattingSettings.ColorPicker({
        name: "headerBackground",
        displayName: "Header Background",
        value: { value: "#f8f6f0" },
        instanceKind: ConstantOrRule
    });

    headerTextColor = new formattingSettings.ColorPicker({
        name: "headerTextColor",
        displayName: "Header Text Color",
        value: { value: "#333333" },
        instanceKind: ConstantOrRule
    });

    rowColor = new formattingSettings.ColorPicker({
        name: "rowColor",
        displayName: "Row Background",
        description: "Background color for normal (even) rows",
        value: { value: "#ffffff" },
        instanceKind: ConstantOrRule
    });

    alternateRowColor = new formattingSettings.ColorPicker({
        name: "alternateRowColor",
        displayName: "Alternate Row Color",
        value: { value: "#faf9f5" },
        instanceKind: ConstantOrRule
    });

    // Per-region transparency (D-05) sibling to the row-band colour pair
    // above — applied uniformly to both rowColor and alternateRowColor at
    // render (same "row background" region). Rows are ALWAYS painted a
    // colour today (never "unpainted"), so 0 (opaque) is the correct
    // no-override default (D-06).
    rowTransparency = new formattingSettings.Slider({
        name: "rowTransparency",
        displayName: "Row Background Transparency",
        description: "Transparency applied to both row background colours",
        value: 0,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 100 }
        }
    });

    textColor = new formattingSettings.ColorPicker({
        name: "textColor",
        displayName: "Text Color",
        description: "Color for category and text column cells",
        value: { value: "#333333" },
        instanceKind: ConstantOrRule
    });

    measureTextColor = new formattingSettings.ColorPicker({
        name: "measureTextColor",
        displayName: "Measure Text Color",
        description: "Color for numeric measure cells",
        value: { value: "#333333" },
        instanceKind: ConstantOrRule
    });

    // v2 board look (01-18 Task 3) — band-tints the FIRST measure column
    // (the "value column") via the shared v3 band engine, using each
    // row's own sparkline trend as a self-referential baseline (this
    // visual has no genuine target/goal data role — mirrors the 01-16
    // Callback Card precedent). Defaults ON (D-16 new-default look) but
    // a genuinely optional toggle (mirrors Progress Bar Card's Quantised
    // Mode) so a report author who has customised Measure Text Color or
    // set an fx rule can fall back to that flat colour untouched. An
    // active fx rule on measureTextColor always wins regardless of this
    // toggle (a rule is a more deliberate override than the flat default).
    bandTintValue = new formattingSettings.ToggleSwitch({
        name: "bandTintValue",
        displayName: "Band-Tint Value Column",
        description: "Tint the first measure column by this row's trend vs its own baseline",
        value: true
    });

    // ─── Per-surface text treatment (TEXT-01) ────────────────────────
    // Three FontControl composites via the shared makeFontControl helper
    // (distinct prefixes rowLabel/value/header). Every property is NEW/
    // additive; the pre-existing shared bare `fontSize` below stays the
    // suite-wide base size for all cells. Each composite's Font Size
    // defaults to 0 = "follow the shared Font Size" (the visual's own
    // established 0-as-auto idiom, cf. columnWidthSettings and
    // pbiBulletChart's valueFontSize) so an old saved report with a
    // customised shared Font Size renders pixel-identical (D-06) — a
    // per-surface size only takes over when explicitly set > 0.
    // Bold defaults track each surface's pre-existing hardcoded weight
    // (weightFor idiom): header th weight 600 → Bold true; category-cell
    // weight 500 → Bold false (rest 500); measure-cell no weight (400) →
    // Bold false (rest 400). Alignment omitted — column alignment is
    // layout-determined (category left, measure right, per CSS).
    private rowLabelFontBundle = makeFontControl("rowLabel", { fontFamily: FONT_STACK, fontSize: 0 });
    rowLabelFontFamily = this.rowLabelFontBundle.fontFamily;
    rowLabelFontSize = this.rowLabelFontBundle.fontSize;
    rowLabelBold = this.rowLabelFontBundle.bold;
    rowLabelItalic = this.rowLabelFontBundle.italic;
    rowLabelUnderline = this.rowLabelFontBundle.underline;
    rowLabelFont = this.rowLabelFontBundle.control;

    private valueFontBundle = makeFontControl("value", { fontFamily: FONT_STACK, fontSize: 0 });
    valueFontFamily = this.valueFontBundle.fontFamily;
    valueFontSize = this.valueFontBundle.fontSize;
    valueBold = this.valueFontBundle.bold;
    valueItalic = this.valueFontBundle.italic;
    valueUnderline = this.valueFontBundle.underline;
    valueFont = this.valueFontBundle.control;

    private headerFontBundle = makeFontControl("header", { fontFamily: FONT_STACK, fontSize: 0, bold: true });
    headerFontFamily = this.headerFontBundle.fontFamily;
    headerFontSize = this.headerFontBundle.fontSize;
    headerBold = this.headerFontBundle.bold;
    headerItalic = this.headerFontBundle.italic;
    headerUnderline = this.headerFontBundle.underline;
    headerFont = this.headerFontBundle.control;

    fontSize = new formattingSettings.NumUpDown({
        name: "fontSize",
        displayName: "Font Size",
        value: 12
    });

    rowHeight = new formattingSettings.NumUpDown({
        name: "rowHeight",
        displayName: "Row Height",
        value: 32
    });

    showGridLines = new formattingSettings.ToggleSwitch({
        name: "showGridLines",
        displayName: "Show Grid Lines",
        value: true
    });

    name: string = "tableSettings";
    displayName: string = "Table";
    slices: Array<FormattingSettingsSlice> = [
        this.headerBackground,
        this.headerTextColor,
        this.headerFont,
        this.rowColor,
        this.alternateRowColor,
        this.rowTransparency,
        this.textColor,
        this.rowLabelFont,
        this.measureTextColor,
        this.bandTintValue,
        this.valueFont,
        this.fontSize,
        this.rowHeight,
        this.showGridLines
    ];
}

class SparklineCardSettings extends FormattingSettingsCard {
    sparklineWidth = new formattingSettings.NumUpDown({
        name: "sparklineWidth",
        displayName: "Sparkline Width",
        value: 120
    });

    sparklineHeight = new formattingSettings.NumUpDown({
        name: "sparklineHeight",
        displayName: "Sparkline Height",
        value: 24
    });

    sparklineColor = new formattingSettings.ColorPicker({
        name: "sparklineColor",
        displayName: "Sparkline Color",
        value: { value: "#130064" },
        instanceKind: ConstantOrRule
    });

    // Per-region transparency (D-05) sibling to the sparkline colour above
    // — applied to the line/area/bar stroke+fill colour at render (never
    // to Dot Color, a distinct last-point highlight left unchanged, out of
    // scope per D-09/"invent no new colour surfaces"). Sparklines are
    // ALWAYS painted a colour today (never "unpainted"), so 0 (opaque) is
    // the correct no-override default (D-06).
    sparklineTransparency = new formattingSettings.Slider({
        name: "sparklineTransparency",
        displayName: "Sparkline Transparency",
        description: "Transparency applied to the sparkline line/area/bar colour",
        value: 0,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 100 }
        }
    });

    // v2 board look (01-18 Task 3) — the shared spark grammar (mirrors
    // 01-16's pbiKpiSparklineCard Task 3) ships "soft area fill" as the
    // new default the same way that visual's Show Area Fill flipped
    // false->true: this declared enum default flips Line->Area. An old
    // saved report with an explicit Line/Bar selection keeps its value
    // (D-06/D-16) — only the never-before-set default changes.
    sparklineType = new formattingSettings.ItemDropdown({
        name: "sparklineType",
        displayName: "Sparkline Type",
        items: [
            { displayName: "Line", value: "line" },
            { displayName: "Area", value: "area" },
            { displayName: "Bar", value: "bar" }
        ],
        value: { displayName: "Area", value: "area" }
    });

    showDot = new formattingSettings.ToggleSwitch({
        name: "showDot",
        displayName: "Show Last Point Dot",
        value: true
    });

    dotColor = new formattingSettings.ColorPicker({
        name: "dotColor",
        displayName: "Dot Color",
        value: { value: "#e60e22" },
        instanceKind: ConstantOrRule
    });

    // Endpoint-dot half of the shared spark grammar: same self-referential
    // trend-vs-baseline band as bandTintValue above, applied to the
    // last-point dot (matching pbiKpiSparklineCard's band/direction-tinted
    // endpoint dot). Defaults ON; toggling off restores the flat Dot
    // Color exactly as it rendered before this plan (D-16).
    bandTintDot = new formattingSettings.ToggleSwitch({
        name: "bandTintDot",
        displayName: "Band-Tint Endpoint Dot",
        description: "Tint the last-point dot by this row's trend vs its own baseline",
        value: true
    });

    lineWidth = new formattingSettings.NumUpDown({
        name: "lineWidth",
        displayName: "Line Width",
        value: 1.5
    });

    name: string = "sparklineSettings";
    displayName: string = "Sparkline";
    slices: Array<FormattingSettingsSlice> = [
        this.sparklineWidth,
        this.sparklineHeight,
        this.sparklineColor,
        this.sparklineTransparency,
        this.sparklineType,
        this.showDot,
        this.dotColor,
        this.bandTintDot,
        this.lineWidth
    ];
}

class ColumnWidthSettings extends FormattingSettingsCard {
    categoryWidth = new formattingSettings.NumUpDown({
        name: "categoryWidth",
        displayName: "Category Column %",
        description: "Width percentage for the row category column (0 = auto)",
        value: 0
    });

    measureWidth = new formattingSettings.NumUpDown({
        name: "measureWidth",
        displayName: "Measure Column %",
        description: "Width percentage for each measure column (0 = auto)",
        value: 0
    });

    textWidth = new formattingSettings.NumUpDown({
        name: "textWidth",
        displayName: "Text Column %",
        description: "Width percentage for each text column (0 = auto)",
        value: 0
    });

    sparklineWidth = new formattingSettings.NumUpDown({
        name: "sparklineWidth",
        displayName: "Sparkline Column %",
        description: "Width percentage for the sparkline column (0 = auto, remainder)",
        value: 0
    });

    name: string = "columnWidthSettings";
    displayName: string = "Column Widths";
    slices: Array<FormattingSettingsSlice> = [
        this.categoryWidth,
        this.measureWidth,
        this.textWidth,
        this.sparklineWidth
    ];
}

class SortCardSettings extends FormattingSettingsCard {
    sortColumn = new formattingSettings.NumUpDown({
        name: "sortColumn",
        displayName: "Sort Column Index",
        description: "0-based column index to sort by",
        value: 0
    });

    sortDirection = new formattingSettings.ItemDropdown({
        name: "sortDirection",
        displayName: "Sort Direction",
        items: [
            { displayName: "Ascending", value: "asc" },
            { displayName: "Descending", value: "desc" }
        ],
        value: { displayName: "Ascending", value: "asc" }
    });

    name: string = "sortSettings";
    displayName: string = "Sort";
    slices: Array<FormattingSettingsSlice> = [
        this.sortColumn,
        this.sortDirection
    ];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    titleSettings = new TitleSettings();
    tableCardSettings = new TableCardSettings();
    sparklineCardSettings = new SparklineCardSettings();
    columnWidthSettings = new ColumnWidthSettings();
    sortCardSettings = new SortCardSettings();
    background = new BackgroundSettings();

    constructor() {
        super();
        // D-06 default-preservation override (per-visual instance only —
        // _shared/formatting/backgroundSettings.ts itself is untouched,
        // D-11): pbiSparklineTable's PRE-EXISTING default was "no
        // background ever painted" — confirmed via direct inspection of
        // src/visual.ts: `this.container` (the outer render root appended
        // to options.element) never has a background-color set anywhere;
        // only row-level (tableCardSettings.rowColor/alternateRowColor)
        // and sparkline-level (sparklineCardSettings.sparklineColor)
        // colours are painted, on distinct DOM layers (each <tr>/<svg>),
        // never the container. The frozen shared Background card's own
        // default (opaque white, transparency 0) would regress every old
        // saved report to a suddenly-opaque white container. Overriding
        // the TRANSPARENCY default to 100 makes toRgba(...) resolve to
        // alpha 0 regardless of colour — pixel-identical to "nothing
        // painted".
        this.background.transparency.value = 100;
    }

    cards = [this.titleSettings, this.tableCardSettings, this.sparklineCardSettings, this.columnWidthSettings, this.sortCardSettings, this.background];
}
