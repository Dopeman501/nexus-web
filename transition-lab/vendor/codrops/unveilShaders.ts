/**
 * GLSL adaptation of Codrops SlideshowAnimations demo17 (Unveil).
 * Upstream d05e45915cf947e85e651296f84ab2b5364056df/js/demo17/slideshow.js.
 * Copyright (c) 2009–2026 Codrops. MIT; see LICENSE and PROVENANCE.md.
 * The original TSL sheet geometry, fold, shading and shadow equations are retained.
 */
export const foldShader = `
const float PI = 3.141592653589793;
vec2 across() { return normalize(vec2(-1.0, -0.8)); }
vec2 along() { vec2 a = across(); return vec2(-a.y, a.x); }
float reach() { return dot(-viewport, across()); }
float radius() { return min(viewport.x, viewport.y) * 0.11; }
float foldActivity() { return sin(progress * PI); }
float foldAt(float side) {
  float sweep = mix(reach() * -0.02, reach() + radius() * PI + reach() * 0.02, progress);
  float seed = 1.7;
  return sweep + (sin(side * 9.5 / reach() + seed) * 0.6
    + sin(side * 4.1 / reach() + seed * 1.9)) * radius() * 0.9 * foldActivity();
}
vec3 sheet(vec2 p) {
  vec2 corner = viewport * 0.5;
  float x = dot(p - corner, across());
  float y = dot(p - corner, along());
  float past = foldAt(y) - x;
  float angle = clamp(past / radius(), 0.0, PI);
  float rolled = past < radius() * PI ? foldAt(y) - radius() * sin(angle)
    : foldAt(y) + past - radius() * PI;
  float height = past < radius() * PI ? radius() * (1.0 - cos(angle)) : radius() * 2.0;
  vec2 position = corner + across() * (past > 0.0 ? rolled : x) + along() * y;
  return vec3(position, past > 0.0 ? height : 0.0);
}
`;

export const sheetVertexShader = `
uniform vec2 viewport;
uniform float progress;
varying vec2 vUv;
varying vec3 vNormal;
varying vec2 vOnSheet;
${foldShader}
void main() {
  vUv = uv;
  vec2 flatPosition = position.xy * viewport;
  vec3 bent = sheet(flatPosition);
  vNormal = normalize(cross(sheet(flatPosition + vec2(1.0, 0.0)) - bent,
    sheet(flatPosition + vec2(0.0, 1.0)) - bent));
  vOnSheet = flatPosition - viewport * 0.5;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(bent, 1.0);
}
`;

/** imageShader must precede these fragments to supply samplers, uniforms and cover UVs. */
export const underneathFragmentShader = `
${foldShader}
void main() {
  float settle = pow(1.0 - progress, 2.0);
  vec2 st = (vUv - 0.5) / (settle * 0.04 + 1.0) + 0.5;
  vec2 p = vUv * viewport - viewport * 0.5;
  float open = max(foldAt(dot(p, along())) - dot(p, across()), 0.0);
  float shadow = exp(-open / (radius() * 1.3)) * 0.5 * foldActivity();
  vec4 image = getToColor(st);
  gl_FragColor = vec4(image.rgb * (1.0 - settle * 0.25) * (1.0 - shadow), image.a);
  #include <colorspace_fragment>
}
`;

export const sheetFragmentShader = `
varying vec3 vNormal;
varying vec2 vOnSheet;
${foldShader}
void main() {
  vec4 image = getFromColor(vUv);
  float gray = dot(image.rgb, vec3(0.2126, 0.7152, 0.0722));
  vec3 back = mix(vec3(0.86, 0.84, 0.8), vec3(gray), 0.22);
  vec3 facing = gl_FrontFacing ? normalize(vNormal) : -normalize(vNormal);
  vec3 base = gl_FrontFacing ? image.rgb : back;
  vec3 light = normalize(vec3(-0.45, 0.55, 0.7));
  vec3 halfway = normalize(light + vec3(0.0, 0.0, 1.0));
  float shade = (dot(facing, light) - light.z) * 1.1;
  float sheen = max(pow(max(dot(facing, halfway), 0.0), 24.0) - pow(halfway.z, 24.0), 0.0) * 0.3;
  float x = dot(vOnSheet, across());
  float tip = foldAt(dot(vOnSheet, along())) * 2.0 - radius() * PI;
  float tipShadow = (x > tip ? exp(-(x - tip) / (radius() * 0.7)) : 0.0) * 0.35 * foldActivity();
  gl_FragColor = vec4((base * (shade + 1.0) + sheen) * (1.0 - tipShadow),
    gl_FrontFacing ? image.a : 1.0);
  #include <colorspace_fragment>
}
`;
