/** Provider marks, drawn in `currentColor` so the registry accent colors them. */

export function ClaudeGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M9 3v12M3 9h12M4.8 4.8l8.4 8.4M13.2 4.8l-8.4 8.4" />
      </g>
    </svg>
  );
}

export function CodexGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function GenericGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <rect
        x="4"
        y="4"
        width="10"
        height="10"
        rx="2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  );
}
