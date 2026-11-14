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

`../builds/` links in historical reports identify local, ignored verification artifacts; they are not repository prerequisites and are absent from a clean clone. The fixtures and setup here are the reproducible source.
