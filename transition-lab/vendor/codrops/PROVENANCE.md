# Codrops Unveil sample

Retrieved through the read-only GitHub connector on 11 November 2026.

- Repository: <https://github.com/codrops/SlideshowAnimations>
- Pinned commit: `d05e45915cf947e85e651296f84ab2b5364056df`
- Adapted source: <https://github.com/codrops/SlideshowAnimations/blob/d05e45915cf947e85e651296f84ab2b5364056df/js/demo17/slideshow.js>
- Upstream licence: <https://github.com/codrops/SlideshowAnimations/blob/d05e45915cf947e85e651296f84ab2b5364056df/LICENSE>
- Live original: <https://tympanus.net/Development/SlideshowAnimations/index17.html>

`unveilShaders.ts` translates the original TSL curl, shading, reverse-face print and shadow equations into GLSL for the existing Three.js `0.185.1` WebGLRenderer. The seed is fixed for repeatable sample comparison. The original 192-by-120 sheet subdivision is retained. The lab host drives progress and supplies its own images. This does not copy demo navigation, GSAP, fonts, pictures, stage/global listeners or animation loops. The source code is MIT; the original Three.js and any other distribution retain their separate notices.

The GLSL identifier audit uses the complete keyword and future-reserved tables in the [official GLSL ES 3.00 revision 6 specification, sections 3.8–3.9](https://registry.khronos.org/OpenGL/specs/es/3.0/GLSL_ES_Specification_3.00.pdf). The source's JavaScript names `active` and `flat` cannot be copied literally into GLSL; this port uses `foldActivity` and `flatPosition`. The regression checks every custom declaration against those tables and reserved identifier prefixes. It supplements actual browser compilation and pixel acceptance rather than replacing them.

The GL Transitions comparison uses the installed `gl-transitions@3.2.0` WaterDrop source. Its selected shader explicitly declares MIT. Upstream commit: `1fe42183109f1585efb7a282c9b6b1c459cd548f`; <https://github.com/gl-transitions/gl-transitions/blob/1fe42183109f1585efb7a282c9b6b1c459cd548f/transitions/WaterDrop.glsl>. Its complete licence remains in the installed npm package: <https://github.com/gl-transitions/gl-transitions/blob/1fe42183109f1585efb7a282c9b6b1c459cd548f/LICENSE>.
