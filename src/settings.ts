"use strict";

import powerbi from "powerbi-visuals-api";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

import { BackgroundSettings } from "../../_shared/formatting/backgroundSettings";

const ConstantOrRule = powerbi.VisualEnumerationInstanceKinds.ConstantOrRule;

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
        this.rowColor,
        this.alternateRowColor,
        this.rowTransparency,
        this.textColor,
        this.measureTextColor,
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

    sparklineType = new formattingSettings.ItemDropdown({
        name: "sparklineType",
        displayName: "Sparkline Type",
        items: [
            { displayName: "Line", value: "line" },
            { displayName: "Area", value: "area" },
            { displayName: "Bar", value: "bar" }
        ],
        value: { displayName: "Line", value: "line" }
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

    cards = [this.tableCardSettings, this.sparklineCardSettings, this.columnWidthSettings, this.sortCardSettings, this.background];
}
