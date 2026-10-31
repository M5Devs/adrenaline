# Project memory — EchoLab

Browser-based audio studio: Vite 6 + React + TypeScript + Firebase + Web Audio API.
Scripts: `npm run dev` (5173), `npm run build`, `npm run typecheck` (`tsc --noEmit`).

## Build & environment
- Firebase config is read from `import.meta.env` at module load. This is now
  **optional** — a missing `.env` no longer breaks the build or the app (see
  "Firebase is optional" below). `.env` is gitignored; `.env.example` is the
  template. Copying the example values is enough for a build.
- Playwright is not a dependency — see "Verification" for the working setup.
- The dev server serves *transformed* TS: Vite rewrites quotes, so source-string
  assertions must use regexes, not literals.
- `page.add_init_script` with an arrow-function string is evaluated as an
  expression and never runs — wrap it as `(function(){...})();`.

## AudioEngine (src/utils/AudioEngine.ts)
- Master chain: `... → pannerNode → compressorNode → volumeNode → StudioFxChain
  → analyser → mediaStreamDestination` (falls back to `ctx.destination`).
- `renderOffline()` mirrors the live graph exactly; it is the single source of
  truth for export. Offline FX tails are added to the render length.
- Construct the engine exactly once (`useState(() => new AudioEngine())`).
  `useRef(new AudioEngine())` builds a throwaway engine every render — the
  AudioContext, oscillators, MediaStream destination and hidden `<audio>` leak.
- `dispose()` releases all of that; wire it to a mount-only effect, not to the
  engine-wiring effect whose cleanup runs on every dependency change.
- Audio uploads are strictly in-memory: `file.arrayBuffer()` → `decodeAudioData()`.

## Studio FX rack (src/utils/studioFx.ts)
- `StudioFxChain(ctx: BaseAudioContext, settings, smooth)` runs on both live and
  offline contexts, so the export matches what the user hears.
- Order: input → Echo → Reverb → Saturation → Widener → Chorus → output.
- Bypass is a mix ramp to 100% dry, never a rewire (click-free toggles).
- `makeSaturationCurve` output must be normalised into [-1,1]; the tape bias
  subtraction otherwise pushes the negative half past -1 and the WaveShaper adds
  gain instead of saturating.
- Reverb IR is synthesised in-engine (decaying noise + early reflections), no asset.
- Knob smoothing uses `setTargetAtTime(v, ctx.currentTime, 0.015)`.
- Echo feedback is hard-clamped to `ECHO_MAX_FEEDBACK = 0.9`.

## Storage (src/utils/storage.ts)
- `safeLocalStorageSet/Get/Remove`, `resetLocalCache`, `isQuotaError`.
- Legacy aliases `safeSetItem/safeGetItem/safeRemoveItem` still exist and are still
  imported by `src/utils/eruda.ts` — keep them or migrate eruda too.
- Playlists persist metadata only (`toStoredPlaylists` in AudioContext.tsx):
  `{id,name,duration,trackCount,createdAt}`. Never persist AudioBuffers, base64,
  blob URLs or peak arrays. The same helper guards Firestore's 1 MB doc cap.
- `resetLocalCache` removes `echolab_*` keys, then falls back to `storage.clear()`.

## MediaSession / mobile
- Master output feeds `createMediaStreamDestination()` → a hidden `<audio>` element
  appended to `document.body`, deliberately **unmuted** (muting it makes Chrome
  Android drop the OS notification and kill headset controls).
- All 7 handlers registered (play, pause, seekto, seekforward, seekbackward,
  previoustrack, nexttrack). `playbackState` + `setPositionState` are polled on a
  1 s interval because playback advances without React re-rendering.
- MediaSession times are speed-adjusted (`engine time / effects.speed`).

## CORS audio proxy
- **One core, three adapters.** All request handling lives in
  `cloudflare-worker/src/proxy.js` (`handleAudioProxy(request, {allowList,
  chunkBytes})`, Web-standard `Request`→`Response`). The Cloudflare Worker
  (`cloudflare-worker/src/index.js`), the Vercel Function (`api/audio-proxy.ts`)
  and the Vite middleware (`tools/devAudioProxy.ts`) are thin adapters. The
  per-target copies had drifted badly (resolver wired into the Worker but not
  the client; a missing `HttpError` import made every resolve failure a
  `ReferenceError`) — never reintroduce a second copy.
- Cloudflare Worker (wrangler): CORS headers + `Range` pass-through (206 +
  `Content-Range`), plus a host allow-list so it is not an open relay. Client:
  `src/utils/audioProxy.ts` (`getProxiedAudioUrl`, `fetchAudioWithProxy`,
  `assembleChunkedResponse`, `AudioProxyError`).
- Endpoint comes from `VITE_AUDIO_PROXY_URL`, else same-origin `/api/audio-proxy`.
- **Vercel: the SPA rewrite must exclude `/api/`.** `vercel.json`'s
  `"/((?!.*\\.).*)"` also matched `/api/audio-proxy` and rewrote it to
  `index.html` — the route 404s in production. Correct source:
  `"/((?!api/|.*\\.).*)"`. (Well-known trap; see vercel/vercel discussion #5448.)
- **Vercel caps a function's response body at 4.5 MB** (no streaming exemption;
  over it → `413 FUNCTION_PAYLOAD_TOO_LARGE`). A stitched SoundCloud track is
  routinely larger (the 4-min acceptance track is 5.0 MB), so the Vercel adapter
  passes `chunkBytes: PROXY_CHUNK_BYTES` (4 MB) and the core serves one ranged
  206 with `Content-Range: bytes S-E/total` + `Accept-Ranges: bytes`; the client
  follows it to completion. The Worker/dev middleware pass no `chunkBytes` and
  serve the whole payload (no cap).
  - **The served span must be clamped to one chunk even when the client asks for
    more.** `Range: bytes=0-` (or `bytes=0-<total-1>`) otherwise returns the
    whole 5 MB and trips the very cap the chunking exists to stay under.
  - A client that asked for its own `Range` must get that 206 passed through
    **untouched** — only a 206 the proxy produced on its own gets reassembled,
    else a deliberate 100-byte read becomes a full download.
  - Follow-ups resume from `last chunk start + bytes received`, not from the
    advertised `Content-Range` end, so a short read cannot leave a hole.
- **SoundCloud resolver** (`cloudflare-worker/src/soundcloud.js`, shared): a track
  *page* URL is resolved to audio before it is returned. SoundCloud has **no
  progressive MP3** anymore — only **HLS, and that HLS is fragmented MP4**
  (`init.mp4` + `.m4s`), not MPEG-TS. The whole story is in
  `window.__sc_hydration` (`sound` → transcodings + `track_authorization`;
  `apiClient.id` → `client_id`); no asset scraping or `/resolve` call needed. The
  resolver stitches the fMP4 into one file and serves it with an exact
  `Content-Length` and **no `Accept-Ranges`** (there is no upstream range to
  forward; claiming `bytes` breaks seeking). Segments are fetched with bounded
  concurrency (6). Client-side `isSoundCloudTrackUrl` drives a "Resolving
  SoundCloud track…" toast.
- `tools/test_worker.mjs` tests the worker with a stubbed `fetch` (no browser /
  no network); `tools/test_upstream.py` serves a SoundCloud-shaped fixture tree.
- Testing the proxy without a browser: bundle the function
  (`npx esbuild api/audio-proxy.ts --bundle --platform=node --format=esm
  --external:@vercel/node`) and serve it behind a tiny `http.createServer` that
  shims Vercel's `res.status/send/json` — that emulates a real deployment.
- `tools/ts-resolve-hooks.mjs` + `register_ts_resolve.mjs` let plain `node
  --experimental-transform-types --import ./tools/register_ts_resolve.mjs`
  import the browser TS modules (Node does not resolve Vite's extensionless
  relative imports). `import.meta.env` is undefined outside Vite — use
  `import.meta.env?.X`.

## Firebase is optional — offline-first degradation
- `src/firebase.ts` must not initialise at import time: with no `.env`, `apiKey`
  is `undefined`, `getAuth()` throws `auth/invalid-api-key` **during module
  evaluation** — before React mounts — so `ErrorBoundary` can never catch it and
  the user gets a blank page with no "Reset Local Cache" escape hatch. (A
  placeholder `.env` does not crash; it only fails later at network time, which
  is why the bug looked like "missing config" specifically.)
- `buildFirebase()` accepts only `isUsable()` values (non-empty, not a `your_…`
  placeholder) and wraps init in try/catch; exports `isFirebaseConfigured` plus
  `app`/`auth`/`db` typed `| null`. Auth/Firestore helpers go through
  `requireAuth()`/`requireDb()`, which throw `Error(CLOUD_DISABLED_MESSAGE)` — no
  `auth!` assertions left.
- `useFirebase.tsx`: `authLoading` starts at `isFirebaseConfigured` (NOT `true`,
  or `AuthPanel` spins forever since the listener that clears it is never
  attached); `onAuthStateChanged` is skipped when unconfigured; context exposes
  `isOfflineMode`; `wrap()` short-circuits with `toast.info(CLOUD_DISABLED_MESSAGE)`.
- UI: `AuthPanel` shows a muted "Local only" badge instead of a Sign-in button;
  `ProjectsPanel` cloud tab shows "Cloud sync is unavailable" instead of a CTA
  that can never succeed.

## Git / PR gotchas
- PRs here get **squash-merged**: after PR #6 landed, `main` (`dd2d599`) was
  byte-identical to PR #6's head. Pushing a follow-up commit onto the old PR
  branch makes the new PR re-apply the *whole* merged diff (23 files,
  `mergeable_state: dirty`). Fix: `git checkout -B <new> origin/main` then
  `git cherry-pick <fix commit>` and force-push — the PR then shows only the new
  files. Never reuse a merged branch for new work.
- The repo has no `.github/workflows` and no PR template.

## Audio payload validation (the "EncodingError" fix)
- `loadUrl` used to hand whatever the fetch returned to `decodeAudioData`. A
  SoundCloud *page*, a Cloudflare/captcha 403 body, a login redirect or an HLS
  `.m3u8` are all valid HTTP responses that are not audio → opaque
  `DOMException: EncodingError: Unable to decode audio data`.
- `src/utils/audioFormat.ts`: `rejectByContentType` (html/mpegurl/json/text) +
  `sniffAudioContainer` magic bytes (WAV/AIFF/OggS/fLaC/ftyp/EBML/ID3/MPEG
  sync/ADTS-AAC) + `validateAudioPayload` + `describeUnsupportedPageUrl`.
  `AudioEngine.loadBuffer(arrayBuffer, contentType?)` gates **before** decoding;
  `loadUrl` forwards the response Content-Type.
- Decisions worth keeping: an absent/`application/octet-stream` Content-Type gets
  the benefit of the doubt (many CDNs label audio that way) and falls to magic
  bytes; skip a UTF-8 BOM + leading whitespace before the `<` test; and detect
  UTF-16 HTML (`FF FE 3C`) explicitly — otherwise `0xFF` matches the MPEG frame
  sync and a web page is misread as MP3.
- Three failure classes must stay distinguishable: bad *payload* (format gate,
  decoder never reached), bad *URL/network* (`AudioProxyError`, "not found"),
  bad *server* ("temporarily unavailable"). An HTML body on a non-OK response is
  reported as a web page even at 403 — a captcha is HTML, not "geo-restricted".

## Verification
- `tools/verify_echolab.py` — Playwright suite against the dev server. It
  dynamically imports the real TS modules, so it exercises a real AudioContext /
  DOMException / MediaSession rather than mocks.
- **Self-contained**: `main()` starts `tools/test_upstream.py` (a foreign-origin
  server with `/page`, `/captcha` 403 HTML, `/playlist.m3u8`, `/api.json`,
  `/mislabelled.mp3` = HTML with a lying `audio/mpeg`, `/song.mp3` + Range/206,
  `/notfound.mp3` 404, `/boom.mp3` 500) and tears it down, and writes its own
  `/tmp/echolab_fixtures/tone.wav`. No `/tmp` setup needed; byte assertions read
  the fixture size from the module.
- **`playwright` is not installed in a fresh session** — `pip install playwright`
  is enough; it drives the pre-existing `/usr/bin/chromium` (no
  `playwright install`).
- The suite is **mode-adaptive**: 96 checks with no `.env`, same count when
  Firebase is configured. The invariant (safe handles, `auth`/`db` null iff
  unconfigured, no unhandled page errors) is asserted in both; offline-only UX
  (badge, offline toast, local save) only in offline mode. Run it both ways.
- The `no unhandled page errors` check excludes `boundary-probe-boom` — the
  ErrorBoundary test throws that on purpose.
- Python's `http.server` ignores `Range`, hence the custom upstream.
- Fixture gotchas: `TextEncoder` cannot build magic-byte fixtures (`'\u00ff'`
  becomes U+FFFD EF BF BF) — use `atob(base64)` → `Uint8Array`. The sniffer needs
  ≥12 bytes, so a bare 10-byte `ID3` header is rejected as "too short". And a
  `\n` inside a Python triple-quoted JS string becomes a real newline and breaks
  the JS literal → write `\\n`.


### Verifying UI→engine wiring (the technique)
- The `AudioEngine` instance lives inside `AudioProvider`, so there is no global
  handle. To observe what the UI does to it, **patch the prototype** after the app
  has mounted: `AudioEngine.prototype.applyStudioFx = function (fx) { record(fx);
  return orig.call(this, fx); }`. Calls made through the captured instance are then
  visible. This is how the FX rack wiring is tested.
- Radix `Slider` renders `[role=slider]` with `aria-valuenow/min/max`; the label
  lives in a sibling `<span>`. Look up a knob with
  `span.find(s => s.textContent.trim() === 'Drive').closest('div.space-y-2')
  .querySelector('[role=slider]')`, then `focus()` + `ArrowRight` to drive it —
  a real user gesture, not a synthetic event.
- Radix `Switch` renders `[role=switch]` with `data-state` and the `aria-label`
  passed by `UnitCard` (`Toggle Echo / Tape Delay`, …).
- To test `ErrorBoundary` for real, import React in the page
  (`/@id/react`, `/@id/react-dom/client` resolve through Vite's optimizer) and
  render a component that throws into a scratch host div. Silence `console.error`
  first — React logs every caught error.
- A sonner toast is queryable as `[data-sonner-toast]`.
- Assert on **network requests** (`page.on('request')`) to prove the UI routes
  through the proxy, and on **rendered pixels/samples** to prove export FX.

### Export FX verification (dry vs wet, same source)
- Render a short 440 Hz burst then silence; any energy after the burst can only
  come from delay/reverb tails. Measured: dry tail ≈ 0, wet tail ≈ 4.3e4.
- `renderOffline` lengthens the render to fit the tail (44100 → 304291 samples
  with a 3 s cathedral reverb), and saturation moves the peak (0.51 → 0.99).
- FX order is defined **once**, in the `StudioFxChain` constructor
  (echo→reverb→saturation→widener→chorus); live and offline both instantiate that
  class (only `smooth` differs), so order identity is structural.

See `.openhands/memory/2026-10-30.md` for the full work log.

## Heavy stress benchmark suite (Adrenaline vs Electron)
- `benchmarks/stress-suite/` — shared app (`app/{config,backend,harness,renderer,index.html,preload,hash-worker}.js`),
  `adrenaline-runner.js`, `electron-runner.js`, `profiler.js`, `run.js`, `report.js`,
  `tools/reaper.c`. `npm run benchmark` = `run.js && report.js`.
- Output: `benchmarks/STRESS_TEST.md`; raw evidence `benchmarks/stress-suite/profiles-combined.json`.
- Profiler runs each runtime **sequentially** under `xvfb-run -a`, 500 ms sampling for 30 s.
- Metrics: PSS (`/proc/[pid]/smaps_rollup`, summed tree-wide — never naive RSS sum),
  Private = Private_Clean+Private_Dirty, CPU from Σ(utime+stime) deltas / wallclock,
  IPC round-trip via hrtime (p50/90/95/99), startup = spawn→first-paint IPC.

### Environment quirks that cost real time
- **Adrenaline launches with `node`; Electron must launch with the Electron binary**
  (`node_modules/electron/dist/electron`, path in `electron/path.json`/`path.txt`).
  `run.js` `launcherFor()` handles this; profiler takes a `launcher` option.
- **WebKitGTK children are forked from a non-main thread**, so
  `/proc/<pid>/task/<pid>/children` does NOT list WebKitWebProcess/WebKitNetworkProcess.
  Walk the tree from a full `/proc` scan keyed on the stat PPID field instead.
- **Container PID 1 (openhands-agent-server) does not reap orphans** → SIGKILLed
  grandchildren become permanent zombies. Fix: run the runner detached under the
  subreaper wrapper `tools/reaper.c` (PR_SET_CHILD_SUBREAPER), which must **linger
  ~2 s after its main child dies** (ECHILD fires before orphans reparent). Then
  SIGTERM the group and let it reap; only SIGKILL if it still has live members.
  With this, zombie delta across a run is 0.
- **Idle baseline contamination**: start the SHA-256 CPU workers in `beginStorm()`,
  not at boot, or the idle PSS sample includes hashing load.
- Electron needs `--no-sandbox --disable-gpu` in this container (also set via
  `app.commandLine.appendSwitch`).
- Result-file wait loop in `profileRun` must NOT be gated on the child being alive —
  the runner writes results *during* shutdown, after which it exits.

### Representative 30 s result (4-core EPYC 9B14, 16 GB, Debian 13)
- Peak PSS: Electron ~700 MB (11 procs) vs Adrenaline ~512 MB (8 procs).
- Idle PSS: Electron ~300 MB vs Adrenaline ~392 MB (WebKit reserves up front).
- CPU: both ~260–280 % (2 SHA-256 workers dominate). IPC p95: ~1.8 ms vs ~5.1 ms.
- Startup: ~345 ms vs ~520 ms. Shipped size: 273.7 MB vs 121.5 MB (node+addon).
