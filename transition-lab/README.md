# Background transition comparison lab

290 selectable effects across five candidates, originally developed on `feature/background-transitions` from the verified installed-feature main source on 11 November 2026. This isolated sampler does not connect to Nexus APIs, read Nexus settings, capture audio or send hardware commands. The separately built Nexus candidate integrates only the user's selected GL Transitions and Curtains engines; Codrops, Motion and Anime remain sampler-only. The historical [selected production build record](../../builds/background-transitions-20261114/Verification.md) is a local ignored verification artifact, absent from a clean clone and not required to run this sampler.

## Run

From the dashboard checkout, install the lockfile dependencies and build the separate sampler:

```powershell
npm ci
node node_modules/vite/bin/vite.js build --config transition-lab/vite.config.ts
node node_modules/vite/bin/vite.js preview --config transition-lab/vite.config.ts
```

Open <http://127.0.0.1:19431/>. `Launch.ps1` runs these same commands from any working directory. The preview binds only loopback and fails if its dedicated port is already owned; it never reuses an installed Nexus listener. Stop it with Ctrl+C.

Choose Library, then an effect in Transition or the searchable cards. Previous/Next transition navigates the filtered list and automatically plays the selected effect. Play transition replays it; Next picture swaps the two local fixtures. Progress allows scrubbing. The preview uses the D215 landscape or portrait aspect ratio, scaled to the browser layout; it is not a physical display test.

Add effects to Your shortlist. Choices persist only in this sampler origin's browser storage. Export choices downloads `nexus-transition-shortlist.json` with stable library/effect IDs for the later integration decision. Nothing is written to Nexus. Simulate 6 beats sends six local selections 120ms apart; it uses no audio feed. Clear retires current/pending rendering, and Mount sample starts a new instance.

## Samples and provenance

| Candidate | Actual implementation | Version/source |
| --- | --- | --- |
| GL Transitions · 214 | Every effect shipped in the package, using its actual generated GLSL3 source and parameter defaults through existing Three.js | `gl-transitions` **3.2.0**; MIT with two retained BSD exceptions |
| Codrops · 32 | All original named SlideshowAnimations implementations, including their original GPU effects, hosted in a local frame with paused original GSAP timelines | Pinned **`d05e45915cf947e85e651296f84ab2b5364056df`**; [source, hosting changes and licences](codrops-catalogue/PROVENANCE.md) |
| Curtains.js · 12 | Authored full-frame wave/liquid/ripple/swirl/zoom/chromatic/pixel/wave-direction/twist/melt presets using actual Curtains Plane rendering | `curtainsjs` **8.1.6** |
| Motion for React · 16 | Authored full-frame fades, slides, wipes, zooms, rotation, flip and circle reveal using actual Motion React values/transforms | `motion` **14.12.0** |
| Anime.js · 16 | The same authored preset set, using actual paused v4 animations, deterministic `seek()` and `revert()` cleanup | `animejs` **4.5.0** |

GL and Codrops have finite catalogues; all their entries are included. Motion, Anime.js and Curtains are general animation/rendering engines with no finite list of all possible transitions, so their entries are explicitly labelled authored engine presets. These are working engine implementations, not the engines' official catalogues. GL DisplacementMap and LumaWipe use deterministic local masks for their additional sampler inputs. Fade through black/white deliberately has a solid midpoint.

The four added npm packages use exact pins: GL Transitions 3.2.0 and Curtains.js 8.1.6 are production dependencies; Motion 14.12.0 and Anime.js 4.5.0 are development dependencies used only by this sampler. Existing React 19.2.4 and Three.js 0.185.1 remain unchanged. Codrops' original bundled GSAP **3.15.0** is retained under its GreenSock standard no-charge licence, **not MIT**. The two SVG landscape illustrations were authored locally; no external demo photographs, fonts or user assets are copied. Source and built-preview licence notices are retained under [public/licenses](public/licenses). The older single-effect Unveil WebGL port remains as a regression fixture, with its own [adaptation record](vendor/codrops/PROVENANCE.md); the catalogue runs the original Codrops classes.

## Tests

```powershell
node node_modules/vitest/vitest.mjs run --config transition-lab/vitest.config.ts
node node_modules/typescript/bin/tsc -p transition-lab/tsconfig.json --noEmit
node node_modules/@playwright/test/cli.js test -c transition-lab/playwright.config.ts
node node_modules/@playwright/test/cli.js test -c transition-lab/playwright.catalogue.config.ts
```

Build the lab before browser tests. Browser fixtures fulfill every asset request from the local compiled lab and block application/external/WebSocket traffic; they do not need an HTTP server or the installed service. Playwright uses headless Microsoft Edge. On Windows, the restricted process environment may prevent Edge startup; a separately authorized local retry outside that restriction is distinct from a product failure.

The host owns a single playback clock and current selection; adapters own their rendering resources. A new request supersedes an older request rather than adding to a queue. Codrops frame messages validate origin, source window, session nonce, catalogue ID and commands. Its same-origin frame isolates trusted pinned demo styles/lifecycle; it is not a boundary against hostile JavaScript. The frame has a local-only CSP and explicit timer/worker/GPU cleanup. Pending frame teardown is invisible while connected until acknowledgement or its bounded disposal deadline. GPU endpoints use original decoded images so endpoint colour/cover pixels remain exact; intermediate frames are rendered and browser-checked separately.

Browser frame intervals are observation data, not a fair speed ranking: effects and compositor paths differ. They exclude native WebView capture, JPEG encoding, USB and physical display timing. These first samples prove still-image behavior only; video, GIF/alpha, solid/shader sources and integration with real Audio Trigger preview/cadence are explicit gates in the implementation plan. Numerical coverage is not claimed when the configured provider is absent.

Production builds use the original root Vite entry and the separate selected production module. Lab output lives only under `transition-lab/dist/`, separately from product `dist/`. Running this sampler produces no native package or installed update; the selected production candidate has its own build/acceptance record linked above.

The portable product-engine/video test entries and local tool prerequisites live under [e2e/fixtures](../e2e/fixtures/README.md). Their sources are independent of this sampler. Generated browser reports, compiled fixtures, media and local `../builds/` evidence remain ignored; they are regenerated from source rather than published as package payloads.
