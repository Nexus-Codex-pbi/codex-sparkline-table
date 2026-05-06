# Security Documentation for Codex Sparkline Table

## External Network Access
The Codex Sparkline Table visual does not make any external network requests or connections. All data processing occurs within the Power BI service environment, and no data is transmitted outside of the Power BI platform.

## Telemetry
The visual does not collect, store, or transmit any telemetry data. No usage analytics, performance metrics, or user interaction data is gathered by the visual itself.

## Data Handling
All data processing is performed client-side within the Power BI visualization framework. The visual receives data through the standard Power BI data view contract and processes it locally without storing or persisting any information beyond the current session.

## Script Safety
The visual does not execute any dynamically generated scripts or evaluate JavaScript expressions. All functionality is implemented through statically compiled TypeScript code that adheres to Power BI's security model.

## Cross-Visual Interaction
Cross-filtering functionality is implemented using Power BI's standard selection manager APIs. Filters are applied through the official Power BI extensibility framework mechanisms without direct DOM manipulation or unsafe practices.

## Dependencies
The visual uses standard Power BI Visuals API libraries, D3.js visualization libraries, and the powerbi-visuals-utils-formattingmodel package for formatting settings management. These dependencies are bundled with the visual and reviewed by Microsoft as part of the AppSource certification process.

## Permissions
The visual does not declare any special permissions or privileges that would allow access to sensitive system resources.

## Summary
The Codex Sparkline Table visual complies with Power BI security standards. It operates entirely within the Power BI service sandbox, makes no external network calls, collects no telemetry, executes no dynamic scripts, and handles all data through secure Power BI APIs.