/**
 * teChia Jobs brand mark — a stylised "Jt" monogram.
 *
 * Silver "J" + gold "t" on an obsidian tile with a champagne→gold metallic
 * gradient on the accent letter and a thin baseline rail. Static gradient ids
 * are intentional: every instance renders identical stops, so duplicate ids are
 * visually safe and keep the markup dependency-free.
 */
export function BrandMark({
  size = 36,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="tj-tile" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#222836" />
          <stop offset="1" stopColor="#0A0C10" />
        </linearGradient>
        <radialGradient id="tj-glow" cx="0.24" cy="0.16" r="0.85">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.14" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="tj-silver" x1="0" y1="0" x2="0.2" y2="1">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#B4BBC7" />
        </linearGradient>
        <linearGradient id="tj-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F7E7B8" />
          <stop offset="0.5" stopColor="#E3C463" />
          <stop offset="1" stopColor="#C29E24" />
        </linearGradient>
      </defs>

      <rect width="64" height="64" rx="15" fill="url(#tj-tile)" />
      <rect width="64" height="64" rx="15" fill="url(#tj-glow)" />
      <rect
        x="0.75"
        y="0.75"
        width="62.5"
        height="62.5"
        rx="14.25"
        fill="none"
        stroke="#FFFFFF"
        strokeOpacity="0.11"
        strokeWidth="1.5"
      />

      <path
        d="M29 17 V36 A11 11 0 0 1 18 47"
        fill="none"
        stroke="url(#tj-silver)"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <path
        d="M17 48.5 H48"
        fill="none"
        stroke="#C9CED6"
        strokeOpacity="0.5"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M42 20 V44 A6 6 0 0 0 48 50"
        fill="none"
        stroke="url(#tj-gold)"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <path
        d="M35 29 H52"
        fill="none"
        stroke="url(#tj-gold)"
        strokeWidth="7"
        strokeLinecap="round"
      />
    </svg>
  );
}