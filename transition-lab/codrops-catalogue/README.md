# Codrops preview entry

This is an isolated local preview of all 32 pinned original Codrops SlideshowAnimations variations. See [PROVENANCE.md](PROVENANCE.md) for source/license details and the limited hosting adaptations.

The sampler imports `codropsOptions` from `catalogue.ts` and obtains an existing `AdapterFactory` with `createCodropsCatalogueAdapter('codrops-01')` through `codrops-32` from `adapter.ts`. The parent controller supplies decoded local images, progress, and an optional abort signal. Factory readiness is asynchronous and bounded to 30 seconds. Disposal waits for explicit frame cleanup or a bounded 300 ms fallback.

`frame.html` is the sampler's second Vite HTML input and is served only by its loopback preview. Each effect loads its original source on demand. It must not be added to the production SPA/native payload. Browser tests should inspect the iframe's document for a GPU canvas; parent-stage image overlays provide exact progress 0 and 1.
