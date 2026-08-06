# Codex Sparkline Table — Cert Notes (licensing resubmission wave)

**Version:** 1.0.0.19 (visual.version) · production GUID unchanged (`codexSparklineTable…`) · API 5.11.0 / pbiviz 7.0.2 (pinned).

**Live version:** 1.0.0.17, certified 4 Aug 2026. Everything shipped before that date has been
reviewed — this wave carries the licensing change **and nothing else**.

## Licensing (the only change this wave carries)

The visual now calls the Power BI **licensing API** and raises Power BI's own licence
notification. It is deliberately a **prompt, never a block**:

- `licenseManager.getAvailableServicePlans()` is called once on construction.
- When no Active/Warning plan is present, `notifyLicenseRequired(LicenseNotificationType.General)`
  is raised. `General` is used, **not** `VisualIsBlocked` — Microsoft enforces `General` only in
  Edit scenarios, so a report viewer is never interrupted and the visual keeps rendering for
  everyone. Verified in the built bundle: the compiled call is `notifyLicenseRequired(0)` and the
  string `VisualIsBlocked` does not appear.
- The check **fails open** in every case where the platform cannot answer truthfully —
  `isLicenseInfoAvailable === false`, `isLicenseUnsupportedEnv === true` (Publish to Web, PaaS
  embed, national clouds, Report Server, PDF/PPT export), or the API being absent on an older
  host. A licence check must never blank a customer's report.
- **No network calls of any kind were added.** Verified in the built bundle: no `fetch`, no
  `XMLHttpRequest`, no `WebSocket`. Licence state comes solely from the host API.
- `capabilities.json` is **byte-identical** to the certified 1.0.0.17 — no new privileges,
  `"privileges": []`, `"supportsHighlight": false`.

`src/shared/suiteKey.ts` is present in the repo but imported by nothing, so webpack tree-shakes it
out: the bundle contains no `crypto.subtle`, no `NCX1`, no `ECDSA`.

Sample `.pbix` re-embedded to this exact build (1.0.0.19) and verified byte-level before upload.

## Already certified — do not re-litigate

- **1180.2.2 cross-filtering** (`accad30`, shipped 1.0.0.17): `"supportsHighlight": true` was
  declared but never honoured, which suppressed row filtering. Removed; the host now filters
  `values[]` per the documented default.
- eslint 9 → 10 for the `npm audit` gate (`cd78c0b`, shipped 1.0.0.16). devDependencies only.

## Pending fixes riding this wave

None outstanding.
