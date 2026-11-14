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
