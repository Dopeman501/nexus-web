/** Outline gun glyph using the same 24-unit grid and stroke as the lighting icons. */
export function AudioTriggerIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 5h17v6h-8l-3 9H4l3-9H3z" />
      <path d="M7 5V3m9 2V3m4 4h2v3h-2M11 11v4h3a2 2 0 0 0 2-2v-2" />
    </svg>
  );
}
