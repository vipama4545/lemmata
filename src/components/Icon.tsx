// Line icons drawn on a 24x24 grid, stroked in currentColor so they take the colour and
// weight of the text beside them. They replace the emoji this UI used to label controls
// with: emoji render in the platform's own palette and metrics, which never match the
// surrounding type and change shape from one device to the next.
//
// Icons are decorative by default (aria-hidden). A button whose only content is an icon
// needs its own aria-label.

import type { ReactNode } from 'react';

const PATHS = {
  sun: (
    <>
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </>
  ),
  moon: <path d="M20.5 14.8A8.5 8.5 0 0 1 9.2 3.5a8.5 8.5 0 1 0 11.3 11.3Z" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5 21 21" />
    </>
  ),
  cards: (
    <>
      <rect x="3" y="7" width="13" height="13" rx="2" />
      <path d="M7.5 4h10A2.5 2.5 0 0 1 20 6.5v10" />
    </>
  ),
  download: <path d="M12 3v12M7 10.5l5 5 5-5M4 20h16" />,
  eye: (
    <>
      <path d="M2.5 12S6.5 5.5 12 5.5 21.5 12 21.5 12 17.5 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.75" />
    </>
  ),
  'eye-off': (
    <>
      <path d="M4 4 20 20" />
      <path d="M9.9 5.9A9.7 9.7 0 0 1 12 5.5c5.5 0 9.5 6.5 9.5 6.5a17.3 17.3 0 0 1-3.4 3.9" />
      <path d="M6.4 8.1A17.3 17.3 0 0 0 2.5 12S6.5 18.5 12 18.5a9.8 9.8 0 0 0 3.6-.7" />
      <path d="M10.1 10.1a2.75 2.75 0 0 0 3.8 3.8" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="M3.5 16.5 8 12l3.5 3.5L15 12l5.5 5.5" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  sliders: (
    <>
      <path d="M4 7h16M4 12h16M4 17h16" />
      <circle cx="9" cy="7" r="2" />
      <circle cx="15" cy="12" r="2" />
      <circle cx="8" cy="17" r="2" />
    </>
  ),
  shuffle: <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />,
  check: <path d="M5 12.5 10 17.5 19 6.5" />,
  'arrow-left': <path d="M19 12H5M11 6l-6 6 6 6" />,
  'arrow-right': <path d="M5 12h14M13 6l6 6-6 6" />,
  refresh: (
    <>
      <path d="M20 12a8 8 0 1 1-3.2-6.4" />
      <path d="M15.2 1.9 16.8 5.6 12.8 5.1" />
    </>
  ),
  list: <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />,
  chevron: <path d="M6 9.5 12 15.5 18 9.5" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  grid: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </>
  ),
  book: (
    <>
      <path d="M4 4.5h5a3 3 0 0 1 3 3v12a2.5 2.5 0 0 0-2.5-2.5H4Z" />
      <path d="M20 4.5h-5a3 3 0 0 0-3 3v12a2.5 2.5 0 0 1 2.5-2.5H20Z" />
    </>
  ),
  type: <path d="M4 7V4.5h16V7M12 4.5v15M9 19.5h6" />,
  table: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <path d="M3 9.5h18M9.5 9.5v10" />
    </>
  ),
  hash: <path d="M9 3.5 7.5 20.5M16.5 3.5 15 20.5M4 8.5h16M3.5 15.5h16" />,
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 4.9a3.5 3.5 0 0 1 0 6.2M17.5 14.2A6.5 6.5 0 0 1 21.5 20" />
    </>
  ),
  link: (
    <>
      <path d="M10 13.5a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2" />
      <path d="M14 10.5a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2" />
    </>
  ),
  message: <path d="M20.5 12.5a7.5 7.5 0 0 1-10.7 6.8L4 21l1.7-5.4A7.5 7.5 0 1 1 20.5 12.5Z" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5.3l3.3 2" />
    </>
  ),
  layers: <path d="M12 3 3 8l9 5 9-5-9-5ZM3.5 13 12 17.6 20.5 13" />,
  flag: <path d="M5.5 21V3.5M5.5 4.5h11l-2.2 3.6 2.2 3.6h-11" />,
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
      <circle cx="12" cy="14.5" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
} satisfies Record<string, ReactNode>;

/** The names Icon accepts — the keys of the set above, so the two cannot drift apart. */
export type IconName = keyof typeof PATHS;

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
}

function Icon({ name, size = 18, className = '' }: IconProps) {
  const glyph = PATHS[name];
  if (!glyph) return null;

  return (
    <svg
      className={`icon ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {glyph}
    </svg>
  );
}

export default Icon;
