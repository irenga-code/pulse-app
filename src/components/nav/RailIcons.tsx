/** WhatsApp-style rail icons lucide does not have, drawn on lucide's 24px grid so they line up with the rest. */
type IconProps = { className?: string; strokeWidth?: number | string };

const svg = (strokeWidth: number | string = 2) => ({
  xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true,
});

/** Status: a segmented ring around a solid dot. */
export function StatusIcon({ className, strokeWidth }: IconProps) {
  return (
    <svg {...svg(strokeWidth)} className={className}>
      <circle cx="12" cy="12" r="9.5" strokeDasharray="12.4 2.5" transform="rotate(-80 12 12)" />
      <circle cx="12" cy="12" r="5" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Channels: a speech bubble with a broadcast "(·)" inside. */
export function ChannelsIcon({ className, strokeWidth }: IconProps) {
  return (
    <svg {...svg(strokeWidth)} className={className}>
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
      <circle cx="12" cy="12" r="1.25" fill="currentColor" stroke="none" />
      <path d="M9.2 9.2a4 4 0 0 0 0 5.6" />
      <path d="M14.8 9.2a4 4 0 0 1 0 5.6" />
    </svg>
  );
}

/** Business tools: a little shop front with a scalloped awning and a door. */
export function BusinessToolsIcon({ className, strokeWidth }: IconProps) {
  return (
    <svg {...svg(strokeWidth)} className={className}>
      <path d="M4 4h16l1.5 5H2.5Z" />
      <path d="M2.5 9a2.4 2.4 0 0 0 4.75 0a2.4 2.4 0 0 0 4.75 0a2.4 2.4 0 0 0 4.75 0a2.4 2.4 0 0 0 4.75 0" />
      <path d="M4 11.4V20h16v-8.6" />
      <path d="M10 20v-5h4v5" />
    </svg>
  );
}
