/** Speaker-pistol outline shared by the widget and Lighting's Audio Trigger tab. */
export function AudioTriggerGlyph({ size = 24 }: { size?: number | string }) {
  return <svg width={size} height={size} viewBox="0 0 64 64" fill="none" stroke="currentColor"
    strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M25 23H9a3 3 0 0 0-3 3v6a3 3 0 0 0 3 3h18l17 11V12L25 23Z" />
    <path d="m10 35-6 17a2 2 0 0 0 2 3h7a3 3 0 0 0 3-2l6-18M22 35l-3 10h6c5 0 8-4 8-7M25 35c-1 3-1 5 1 7" />
    <path d="M50 22a15 15 0 0 1 0 16M55 16a24 24 0 0 1 0 28" />
  </svg>;
}
