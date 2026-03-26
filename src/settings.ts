"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

class TableCardSettings extends FormattingSettingsCard {
    headerBackground = new formattingSettings.ColorPicker({
        name: "headerBackground",
        displayName: "Header Background",
        value: { value: "#f8f6f0" }
    });

    alternateRowColor = new formattingSettings.ColorPicker({
        name: "alternateRowColor",
        displayName: "Alternate Row Color",
        value: { value: "#faf9f5" }
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
        this.alternateRowColor,
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
        value: { value: "#130064" }
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
        value: { value: "#e60e22" }
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

    cards = [this.tableCardSettings, this.sparklineCardSettings, this.columnWidthSettings, this.sortCardSettings];
}
