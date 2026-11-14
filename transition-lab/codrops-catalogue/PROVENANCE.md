# Original Codrops catalogue

Source: [codrops/SlideshowAnimations](https://github.com/codrops/SlideshowAnimations/tree/d05e45915cf947e85e651296f84ab2b5364056df), commit `d05e45915cf947e85e651296f84ab2b5364056df`, retrieved 11 November 2026 through the read-only GitHub connector.

`vendor/` contains the 32 original `Slideshow` implementations, original shared utilities, original WebGPU/WebGL Stage, Stir worker and simulation, original base stylesheet, original bundled GSAP runtime and original Codrops MIT license. These files are unmodified, including their original copyright notices. `upstream-manifest.json` records each original Git blob SHA; the deterministic test verifies every vendored file byte for byte. No upstream scripts, helper commands or installation hooks were executed during retrieval.

The repository's `.gitattributes` marks this pinned vendor directory `-text`, preserving its exact upstream bytes on Windows checkouts with `core.autocrlf=true`. Keep the original notices and the separately identified GSAP terms when redistributing the sampler. Local generated `../builds/` evidence is historical verification output, not a source dependency.

`catalogue.ts` takes names and descriptions from the pinned pages. Variation 01 is labelled Parallax, describing its original push/parallax animation. `markup.ts` copies only each pinned page's slide/decorative DOM and removes all original image URLs. The local runtime supplies the sampler's two decoded fixtures. Original photography, fonts, favicons, navigation, sponsors and analytics are not copied or requested.

Licenses are distinct:

- Codrops animation source, shared utilities and stylesheet: [MIT](vendor/LICENSE), copyright 2009–2026 Codrops.
- Original bundled GSAP **3.15.0**: copyright 2026 GreenSock, subject to the [GSAP standard no-charge license](https://gsap.com/community/standard-license/), checked 11 November 2026. It is **not MIT**. Its original full notice and license URL remain at the beginning of `vendor/js/gsap.min.js`, which Vite emits without transforming it. The GSAP repository supplies this license by URL rather than a standalone LICENSE file. Commercial use is covered; the standard terms restrict competing visual animation builders. This isolated fixed-effect sampler is for comparison; any later product adoption must retain the applicable terms.
- Three.js: existing project dependency **0.185.1**, MIT. The original demo's `three/webgpu` and `three/tsl` imports resolve to that installed version. No upstream minified Three copy is included. Its license is already in the sampler's license notices.

The wrapper changes only demo hosting/lifecycle and playback control. It creates one original Slideshow and pauses its actual GSAP timeline. Forward seeking uses that same timeline, including the original mid-animation callbacks. Backwards seeking restores the initial DOM and creates the same original timeline with a fixed local random seed. Stir retains its initial simulation recording for rewinding. Exact endpoint images are owned by the parent adapter, avoiding a flash while a shader initializes.

Variations 17–22 use the original Three TSL scene/shader source. The preview overrides `Stage.isSoftware()` to permit rendering on a software GPU, where upstream would silently crossfade. This is an explicit sampler-only compatibility adjustment; it can be slower. Unavailable/failed GPU initialization is reported as an error, never presented as the requested effect. The original reduced-motion handling remains intact.

The separate frame has a restrictive CSP and no external requests. The nonce/effect/origin/source-checked message bridge accepts only local image initialization, finite normalized progress and disposal. Its realm owns timers, animation frames, listeners and workers, while the wrapper disposes geometry, materials, textures and renderer before acknowledging retirement. Late asynchronous initialization is guarded. The parent bounds an absent disposal acknowledgement before removing the frame.

Deterministic tests establish metadata coverage, source integrity, boundary validation, cancellation/timeout behavior and resource retirement. They do not establish pixel correctness, GPU support, installed Nexus behavior, physical display results or product integration compatibility; those need the owning browser/host/device checks.

The Shutters replay browser check at a fixed 640 × 288 CSS preview found identical DOM classes, inline styles and computed transforms with a tiny compositor raster difference: 0.0010813% of pixels differed by more than 12 RGB levels; mean channel error was 0.0001694 on the 0–255 scale. A second replay was exact. Reverse/replay checks therefore require exact DOM state and tight image tolerances of less than 0.01% changed pixels and less than 0.005 mean channel error, retaining hashes and PNG evidence. The original effect math is unchanged.
