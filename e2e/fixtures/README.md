# Portable background-transition acceptance fixtures

These test-only entries import the production GL Transitions/Curtains catalogue and engines. They never import the five-library sampler or connect to Nexus, user settings or hardware. `transition-engines/` sweeps renderer pixels and cleanup; `video-core/` checks decoded video frames and renderer ownership. Production SPA, installed host and physical display acceptance remain separate.

From `nexus-web`, install the lockfile dependencies with `npm ci`. The browser suites use an existing Microsoft Edge installation. Video suites also need existing local FFmpeg with the `lavfi` generator and `libx264`/`libvpx` encoders, plus FFprobe. Setup never downloads tools or reads an old published package.

Tool selection:

- `NEXUS_TEST_FFMPEG`: optional MP4 encoder executable. Otherwise use the existing sibling service's `Bundled/<rid>/ffmpeg/ffmpeg[.exe]`, then `ffmpeg` on PATH.
- `NEXUS_TEST_FFMPEG_GENERATOR`: optional full FFmpeg executable for synthetic input and VP8 WebM; defaults to `ffmpeg` on PATH. The minimal service build omits `lavfi`.
- `NEXUS_TEST_FFPROBE`: optional FFprobe executable; defaults to `ffprobe` on PATH.

Generated media lives under ignored `.playwright/video-media/`. Setup validates H.264 Main level 3.0 or VP8, YUV420P, 320×144, 15 fps, one stream and the specified duration before use. SHA-256, probe metadata and selected local tool versions are recorded in the ignored `../builds/video-transitions-20261114/media-metadata.json` evidence output. Cached clips are checked on every setup; an incompatible cache fails clearly and can be removed from `.playwright/video-media/` before regeneration.

Playwright global setup builds the owned harness sources with the existing Vite dependency into ignored `.playwright/transition-engines/` or `.playwright/video-core/`. A fresh checkout needs no fixture `dist`, archived payload or video checked into Git.

```powershell
node node_modules/vitest/vitest.mjs run --config e2e/fixtures/vitest.config.ts
node node_modules/typescript/bin/tsc -p e2e/fixtures/tsconfig.json --noEmit
node node_modules/typescript/bin/tsc -p e2e/fixtures/tsconfig.tools.json --noEmit
node node_modules/@playwright/test/cli.js test -c playwright.background-transitions-engines.config.ts
node node_modules/@playwright/test/cli.js test -c playwright.background-video-transitions.config.ts
```

Production-route suites read an explicit compiled dashboard or default `dist/`; build that normally before running them. Shared-picker and Audio Trigger beat acceptance require a pinned index hash:

```powershell
$env:BACKGROUND_TRANSITIONS_ASSET_ROOT = (Resolve-Path dist).Path
$env:BACKGROUND_TRANSITIONS_EXPECTED_INDEX_SHA256 = (Get-FileHash dist/index.html -Algorithm SHA256).Hash.ToLowerInvariant()
node node_modules/@playwright/test/cli.js test -c playwright.shared-background-transitions.config.ts
node node_modules/@playwright/test/cli.js test -c e2e/audioBeatTransitions.config.ts
```

The beat configuration now runs the same video setup, including its MP4 round-trip input. Every browser fixture intercepts its HTTP/socket requests and reads compiled files directly; it starts no Nexus listener. Run GPU suites sequentially. Windows process restrictions can prevent Edge startup independently of a product failure.

## Stability and efficiency

`e2e/efficiency.spec.ts` runs against an explicit service dashboard asset root and pinned index hash using the same intercepted production router. It observes actual WebGL draws, canvas mirrors and program creation without replacing the rendering calls. It covers Q60/remote capture eligibility, unsaved local Audio Trigger previews, normal/audio sleep, source changes during sleep, Web View final release/re-add, and video/Finish Videos continuation. A virtual-clock case verifies that page revival restores reload intervals without a native state echo and final release retires them; its clock advance is not a performance measurement.

The D215 is display-only and has no native Screen sleep input. The circle case therefore builds `efficiency-circle/` from the actual circle owners and `PanelScreenSleep` into ignored `.playwright/efficiency-circle/`, then drives that isolated UI's real fade/wake events. It proves those components' render-only pause behavior; it does not establish a native D215 sleep command. The fixture stays outside product `dist`, installation and hardware flows.

Use the asset/hash environment variables above, set a distinct `EFFICIENCY_RUN`, and run:

```powershell
node node_modules/@playwright/test/cli.js test -c playwright.efficiency.config.ts
node node_modules/vitest/vitest.mjs run --config vitest.efficiency.config.ts --coverage src/panel/background src/panel/d215 src/panel/webview src/panel/widgets/web-view src/panel/PanelApp --maxWorkers=2
```

The coverage config retains complete changed owners and enforces 80% lines and branches per file without excluding failure paths. `PanelApp.integrationCoverage.test.tsx` exercises actual editor, layout, surface and recovery flows; its public drag-event adapter does not claim pointer-sensor coverage. The browser's short work counts prove eliminated work, not matched CPU/memory savings or installed/physical behavior.

For repeatable long probes, `node scripts/run-efficiency-probe.mjs` bundles the checked-in `e2e/efficiencyRuntimeProbe.ts` into an ignored cache. Set `EFFICIENCY_CANDIDATE_ASSET_ROOT` and `EFFICIENCY_CANDIDATE_INDEX_SHA256` to a frozen compiled tree, and choose a unique `EFFICIENCY_PROBE_RUN`. `EFFICIENCY_MODE=soak` warms for two minutes, measures the fixed scene for 30 minutes, then creates/closes 20 fresh contexts. `EFFICIENCY_SCENARIO` selects `local`, `q60`, `sleep`, or `composite`; composite runs the three surfaces concurrently in isolated contexts in one Edge tree. All requests stay intercepted. Its weak program counters, draw/copy counts, DOM/heap samples and own-browser CPU/private bytes/handles/threads are recorded under `../builds/nexus-efficiency-20261117/web/runtime/`. Aggregate browser CPU/private memory cannot be attributed to an individual surface; each page retains separate TaskDuration and work counters.

`EFFICIENCY_MODE=benchmark` additionally requires `EFFICIENCY_BASELINE_ASSET_ROOT` and `EFFICIENCY_BASELINE_INDEX_SHA256`. It runs three sequential baseline/candidate pairs with two-minute warmups and five-minute measurement windows. It freezes the observed baseline CPU/committed-memory ranges before comparing candidate results. CPU comparisons normalize by actual elapsed time. `EFFICIENCY_QUIET=1` is valid only after builds/tests and competing profiling stop; otherwise the output explicitly withholds a CPU savings verdict. Set `EFFICIENCY_INTERFERENCE` to the actual conditions. `EFFICIENCY_SMOKE=1` runs short launcher checks and never qualifies as the long acceptance protocol. These probes cover their isolated Edge tree; installed Nexus service/overlay and physical delivery require separate evidence.

Optional `EFFICIENCY_CAPTURE_DRIVER=1` adds the source-owned synthetic Windows capture workload from `nexus-overlay/tests/Nexus.Overlay.Bench`. Build the fixed `../builds/nexus-efficiency-20261117/overlay/bench-{baseline,candidate}-layered/Nexus.Overlay.Bench.exe` files first. The launcher hashes each complete driver tree, starts its executable directly with hidden console and no shell, awaits readiness before warming, captures bounded stdout/stderr and validated JSON, and waits for retirement. It records that process's CPU/private memory separately from Edge; a combined CPU/sec comparison explicitly sums the two rates. The driver's two own offscreen opaque layered windows use an unclipped memory DC, WGC and hardware encoding, without Nexus APIs, installed settings or physical devices. Physical 800×800 geometry, renderer/position metadata and authored 30 fps counters must match across repetitions; raw authored/captured/encoded frame counts remain available. Source bindings and quiet conditions must cover both components.

## Y70 Home and page reordering

The Y70 production-route suites reuse the isolated router above. They require the lockfile dependencies (`npm ci`) and an existing Microsoft Edge installation; native touch input is delivered through CDP. Neither configuration runs video setup or needs FFmpeg/FFprobe.

Build the **service** dashboard, then pin that compiled tree explicitly. The generic `npm run build` selects the website target instead. Run from `nexus-web`:

```powershell
npm run build:service
$env:Y70_HOME_ASSET_ROOT = (Resolve-Path -LiteralPath dist).Path
$env:Y70_HOME_EXPECTED_INDEX_SHA256 = (Get-FileHash -LiteralPath (Join-Path $env:Y70_HOME_ASSET_ROOT 'index.html') -Algorithm SHA256).Hash.ToLowerInvariant()
$env:Y70_HOME_RUN = 'home-local'
$env:Y70_REORDER_RUN = 'pages-local'
node node_modules/@playwright/test/cli.js test -c e2e/y70Home.config.ts
node node_modules/@playwright/test/cli.js test -c e2e/y70PageReorder.config.ts
```

Use distinct run names to retain separate reports. Results and screenshots go under ignored `../builds/y70-home-20261114/`, with the Home run name or `reorder-` plus the reorder run name. Those artifacts are outputs, not clean-checkout prerequisites.

All HTTP, WebSocket and simulator-iframe traffic is intercepted; `localhost:9400` is a virtual origin and no listener is started. Records, settings and save failures are synthetic. No running Nexus service, saved user data or hardware is needed or accessed. Selecting another compiled asset root still tests those files against mocks; it does not establish live-service or physical-display behavior.

`../builds/` links in historical reports identify local, ignored verification artifacts; they are not repository prerequisites and are absent from a clean clone. The fixtures and setup here are the reproducible source.

## K55 CORE Type Reactive

The CORE production-route cases add a synthetic ten-zone keyboard to the Lighting card list, then check physical-layout selection, supported effects, streamed zone colours, zone clicks and saved-config reopening. A second case retires a pending modal draft during a same-card profile-generation reload, then verifies fresh config and epoch-scoped saving. A third retires drafts and preview geometry when the same card becomes a two-zone slice or changes its ordered projection/disabled mask, and checks the captured revision on saves, previews and simulated presses. All HTTP and WebSocket traffic is intercepted before navigation; no server/listener is started and no installed Nexus settings or hardware are accessed.

```powershell
npm run build:service
$env:K55_CORE_ASSET_ROOT = (Resolve-Path -LiteralPath dist).Path
$env:K55_CORE_EXPECTED_INDEX_SHA256 = (Get-FileHash -LiteralPath dist/index.html -Algorithm SHA256).Hash.ToLowerInvariant()
$env:K55_CORE_RUN = 'core-local'
node node_modules/@playwright/test/cli.js test -c e2e/k55Core.config.ts
```

The existing Microsoft Edge installation is required. Reports/screenshots go under ignored `.playwright/k55-core/` in `nexus-web`; use a distinct run name to preserve separate evidence. This proves the compiled dashboard behavior against mocked capabilities/output, not native detection, real key input or physical lighting.
