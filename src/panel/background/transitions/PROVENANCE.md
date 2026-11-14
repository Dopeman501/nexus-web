# Selected production picture engines

Promoted on 14 November 2026 from the selected engines verified by the isolated transition sampler. Production imports only files in this folder and the selected packages; it never imports the sampler, Codrops, Motion or Anime.

- GL Transitions: exact `gl-transitions@3.2.0`, upstream commit `1fe42183109f1585efb7a282c9b6b1c459cd548f`. The package's generated GLSL3 files are used without token rewriting. All 214 entry names/defaults and their individual MIT/BSD notices remain in the package and catalogue metadata. [Source and licences](https://github.com/gl-transitions/gl-transitions/tree/1fe42183109f1585efb7a282c9b6b1c459cd548f).
- Curtains: exact `curtainsjs@8.1.6`, upstream commit `840acaf7d960931350a4e9334b78161aa9b471b7`, MIT. Its twelve authored sampler presets retain the verified shader equations and engine lifecycle. [Source and licence](https://github.com/martinlaxenaire/curtainsjs/tree/840acaf7d960931350a4e9334b78161aa9b471b7).
- Existing Three.js `0.185.1` is retained. The two auxiliary GL masks are deterministic local data, with no copied pictures, external URLs or fonts.

These selected source modules initially copy the measured sampler engines so production callers can be tested independently. The sampler remains its isolated comparison surface; a successful sampler run does not by itself prove production integration, installed-host behaviour or physical rendering.

The product frame source extension borrows decoded images, retained canvas snapshots, live shader mirrors and video elements. Both engines copy canvas/video inputs into their own bounded 2048-side / 4,000,000-pixel buffers; only the incoming live canvas/video buffer is refreshed on paced seeks. Neither renderer owns video playback or decoder release. Curtains' video loader is deliberately unused because its loading/disposal path can create or mutate a decoder, and its canvas disposal must never clear a caller-retained snapshot.
