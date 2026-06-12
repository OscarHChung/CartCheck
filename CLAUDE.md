# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

CartCheck is a **Snap Spectacles AR lens** built in Lens Studio 5.15.4+. It lets users tap/pinch to scan a product in view, then shows an AR HUD comparing the in-store shelf price to the Amazon price, with a one-line shopping verdict.

The entire app logic lives in a single TypeScript file: `Assets/CartCheck.ts`.

## Development Environment

This project is opened and run inside **Lens Studio** (not a terminal). There are no build commands — Lens Studio compiles the TypeScript internally and runs it in its emulator or on real Spectacles hardware.

To type-check locally (no output generated):
```
npx tsc --noEmit
```

`tsconfig.json` is configured with `noEmit: true` targeting ES2021. The Lens Studio built-in API types come from `Support/StudioLib.d.ts` and are available at runtime via `global.*`.

API keys are set in the Lens Studio Inspector as `@input` fields on the `CartCheck` script component — not in code or config files.

## Architecture

### Scan Pipeline (`runScanPipeline`)

Every scan runs through an async pipeline, guarded by `scanId` to discard results from dismissed scans:

1. **Capture** — `captureStillImage()` tries the modern `createImageRequest` API, falls back to `requestCamera`, then base64-encodes the texture via `global.Base64.encodeTextureAsync`.
2. **Identify** — `analyzeImage()` sends the image to **OpenAI gpt-4o-mini** vision. Returns `{ brand, name, size, shelfPrice, found }`. `shelfPrice` is only populated when a price tag is physically readable in the frame.
3. **Price lookup** — `lookupAmazonPrice()` tries up to 3 progressively shorter query strings against **SerpApi** Amazon search.
4. **Verdict** — `generateVerdict()` sends a compact prompt to **Claude Haiku** (`claude-haiku-4-5-20251001`) for a ≤15-word shopping recommendation.
5. **Display** — `showResult()` updates the HUD text, animates the price counters, and colors the card and price blocks based on which side is cheaper.

### `scanId` Guard

`scanId` is incremented on every new scan and on `dismissAll()`. Every async step checks `if (myScanId !== this.scanId) return` to avoid updating the UI after the user has already dismissed or re-scanned.

### UI / Animation

- The HUD card (`hudCard`) fades in with an `easeOutBack` bounce and fades out with `easeOutCubic`, driven by `updateAnimation` on every frame.
- During loading, `verdictText` shows animated dots and the card pulses via a sine-wave alpha (`updateLoadingPulse`).
- Card background color encodes the verdict: red (Amazon 20%+ cheaper), orange (Amazon slightly cheaper), green (store wins), blue (Amazon only), gray (no comparison).
- Price block colors (`hereBlockImage`, `onlineBlockImage`) are set in `setBlockColor`: green for the winning side, red for the losing side, gray when no comparison.

### Lens Studio Runtime APIs

- `require("LensStudio:InternetModule")` — used for all HTTP calls (`httpPost`, `httpGet`)
- `require("LensStudio:CameraModule")` — used for still capture
- `global.Base64.encodeTextureAsync` — texture→base64 encoding
- `global.RemoteServiceHttpRequest` — the HTTP request class
- `this.createEvent("UpdateEvent")` / `"TapEvent"` / `"DelayedCallbackEvent"` — Lens Studio event system

## API Services

| Service | Model/Endpoint | Purpose |
|---------|---------------|---------|
| OpenAI | `gpt-4o-mini` | Vision: identify product and read shelf price |
| SerpApi | Amazon search | Real-time Amazon price lookup |
| Anthropic | `claude-haiku-4-5-20251001` | Shopping verdict (≤15 words) |
