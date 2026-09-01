# Vasty — AGENTS.md

## Project

Vasty is a static browser tool for playing and diagnosing VAST/VPAID ads.

Repository: https://github.com/frostl-projects/Vasty
Default branch: `main`.

Keep the project simple: HTML, CSS and vanilla JavaScript; no backend and no mandatory build step unless there is a strong reason.

## Runtime

VAST/VPAID playback uses `rmp-vast` 17.2.0 (MIT), currently loaded from jsDelivr.

Support the existing diagnostic use cases:
- VAST 3/4;
- MP4/WebM/HLS;
- JavaScript VPAID 1/2;
- raw VAST XML input;
- VAST URL input;
- runtime event/error logging.

VPAID is legacy but must remain supported because compatibility diagnostics are a core use case.

If `rmp-vast` is vendored into this repository later, preserve its MIT copyright/license notice.

## VAST diagnostics

The lightweight analyzer should continue checking useful problems such as:
- malformed XML;
- VAST version and Ad/Inline/Wrapper counts;
- MediaFile type, delivery, apiFramework and dimensions;
- browser `canPlayType` support;
- VAST 3 element order;
- duplicate `Error` elements;
- unknown tracking events;
- VPAID without a normal video fallback;
- `videos[]` inside JSON-shaped `AdParameters` as a diagnostic heuristic.

Do not describe this analyzer as full XSD validation.

A tag playing successfully does not prove that it is valid VAST; it only proves that the current browser/runtime can execute it.

## Errors and logging

Preserve enough diagnostics to distinguish failures in:
- VAST parsing;
- wrappers;
- VPAID load/init;
- autoplay / `play()`;
- CORS/CSP/network;
- media selection;
- codec/decoder/media playback;
- the runtime itself.

Log VAST/VPAID events, browser media events, JavaScript errors and unhandled promise rejections.

`rmp-vast` uses VAST error code `-1` internally as the initial state meaning no real VAST error is set. Never present `-1` to the user as a VAST error; show `—` until a real code exists.

The UI provides copying the diagnostic report and downloading a ZIP containing the report, event log and source VAST/URL.

## VPAID compatibility

Keep compatibility fixes narrow, structural and evidence-based. Do not gate compatibility on advertiser, partner, vendor, AdSystem, domain or campaign names when the same behavior can be detected from DOM/runtime characteristics.

Current structural compatibility patterns:
- remote-style input bridge: visible controls live in the VPAID slot while keyboard handling lives in the hidden execution iframe; only controls with explicit or semantic left/right/activation signals are bridged;
- composite video layout: a background image and an absolutely positioned Plyr-backed video layer share the same content root; Vasty anchors the initial video layer to the slot and preserves the creative's own later geometry/transition.

Do not apply these fixes globally to every VPAID. If the structural signature is absent, leave the creative untouched.

Avoid partner/vendor-specific names in source comments, logs and public documentation unless they are technically required for interoperability.

## Privacy

Do not collect or export user personal data.

Vasty must not read or log:
- cookies;
- localStorage/sessionStorage;
- referrer;
- IP address;
- clipboard contents;
- account/profile data;
- local files or browsing history.

User-Agent is allowed and useful for browser/OS diagnostics.

Raw VAST XML may be included in the diagnostic report exactly as supplied because it is required to reproduce the ad case.

Runtime URLs generated during playback should be logged without query strings or fragments where possible, because ad URLs may contain identifiers/tokens.

## UI

The UI is Russian, compact and engineering-oriented. Avoid unnecessary explanatory or marketing copy.

Keep these main actions available:
- VAST XML / VAST URL;
- load sample;
- start / stop;
- analyze only;
- clear VAST;
- clear log;
- copy report;
- download report ZIP.

`Очистить VAST` clears the XML/URL and analysis result but must not clear the event log.

## Deployment

The app must remain deployable as static files both on GitHub Pages and in a CDN subdirectory.
Use relative paths for project files.

Current GitHub Pages setup is expected to publish from `main` → `/(root)` and the repository contains `.nojekyll`.

## Development approach

Before changing behavior, protect diagnostic value and privacy first.
Prefer small dependencies and simple code.
Do not turn Vasty into a production ad player.
Do not hide runtime errors.
When changing VAST/VPAID behavior, add or update relevant checks/tests where practical.
If a diagnostic report is insufficient to identify the root cause, say what additional browser data is needed (for example Network or Console) instead of guessing.
