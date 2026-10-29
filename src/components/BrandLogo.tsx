import { Activity } from 'lucide-react';
import { useTheme, type Accent } from '@/context/ThemeContext';

type Brand = { tile: string; icon: string; text: string };

// full class strings so Tailwind keeps them. Dark mode uses the -400 family; light mode a deeper shade of the same
// colour so the logo stays readable on white.
const BRAND: Record<Exclude<Accent, 'auto'>, Brand> = {
  emerald: {
    tile: 'bg-emerald-500/10 ring-emerald-500/30 shadow-[0_0_16px_rgba(16,185,129,0.35)]',
    icon: 'text-emerald-600 dark:text-emerald-400',
    text: 'from-emerald-600 via-teal-500 to-cyan-500 dark:from-emerald-400 dark:via-teal-300 dark:to-cyan-400',
  },
  whatsapp: {
    tile: 'bg-[#25D366]/10 ring-[#25D366]/30 shadow-[0_0_16px_rgba(37,211,102,0.35)]',
    icon: 'text-[#1DAA61] dark:text-[#25D366]',
    text: 'from-[#1DAA61] via-[#25D366] to-[#00A884] dark:from-[#25D366] dark:via-[#4ADE80] dark:to-[#00A884]',
  },
  blue: {
    tile: 'bg-blue-500/10 ring-blue-500/30 shadow-[0_0_16px_rgba(59,130,246,0.35)]',
    icon: 'text-blue-600 dark:text-blue-400',
    text: 'from-blue-600 via-sky-500 to-cyan-500 dark:from-blue-400 dark:via-sky-300 dark:to-cyan-400',
  },
  navy: {
    tile: 'bg-indigo-500/15 ring-indigo-500/30 shadow-[0_0_16px_rgba(99,102,241,0.35)]',
    icon: 'text-indigo-700 dark:text-indigo-400',
    text: 'from-indigo-700 via-blue-600 to-cyan-600 dark:from-indigo-400 dark:via-blue-400 dark:to-cyan-400',
  },
  violet: {
    tile: 'bg-violet-500/10 ring-violet-500/30 shadow-[0_0_16px_rgba(139,92,246,0.35)]',
    icon: 'text-violet-600 dark:text-violet-400',
    text: 'from-violet-600 via-purple-500 to-fuchsia-500 dark:from-violet-400 dark:via-purple-300 dark:to-fuchsia-400',
  },
  amber: {
    tile: 'bg-amber-500/10 ring-amber-500/30 shadow-[0_0_16px_rgba(245,158,11,0.35)]',
    icon: 'text-amber-600 dark:text-amber-400',
    text: 'from-amber-600 via-yellow-500 to-orange-500 dark:from-amber-400 dark:via-yellow-300 dark:to-orange-400',
  },
  yellow: {
    tile: 'bg-yellow-400/10 ring-yellow-400/30 shadow-[0_0_16px_rgba(250,204,21,0.35)]',
    icon: 'text-yellow-600 dark:text-yellow-400',
    text: 'from-yellow-500 via-amber-500 to-orange-500 dark:from-yellow-300 dark:via-amber-300 dark:to-orange-300',
  },
  hotpink: {
    tile: 'bg-pink-500/10 ring-pink-500/30 shadow-[0_0_16px_rgba(236,72,153,0.35)]',
    icon: 'text-pink-600 dark:text-pink-400',
    text: 'from-pink-600 via-rose-500 to-fuchsia-500 dark:from-pink-500 dark:via-rose-400 dark:to-fuchsia-400',
  },
  softpink: {
    tile: 'bg-rose-400/10 ring-rose-400/30 shadow-[0_0_16px_rgba(251,113,133,0.35)]',
    icon: 'text-rose-500 dark:text-rose-300',
    text: 'from-rose-500 via-pink-400 to-fuchsia-400 dark:from-rose-300 dark:via-pink-200 dark:to-fuchsia-300',
  },
  orange: {
    tile: 'bg-orange-500/10 ring-orange-500/30 shadow-[0_0_16px_rgba(249,115,22,0.35)]',
    icon: 'text-orange-600 dark:text-orange-400',
    text: 'from-orange-600 via-amber-500 to-yellow-500 dark:from-orange-400 dark:via-amber-300 dark:to-yellow-400',
  },
};

/** The PULSE wordmark, in the family of the accent colour on screen (Settings > Appearance). */
export default function BrandLogo({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const { activeAccent } = useTheme();
  const b = BRAND[activeAccent];
  const lg = size === 'lg';
  return (
    <span className={`flex items-center ${lg ? 'flex-col gap-3' : 'gap-2.5'}`} role="img" aria-label="Pulse" data-accent={activeAccent}>
      <span aria-hidden="true" className={`flex items-center justify-center ring-1 transition-colors ${lg ? 'w-14 h-14 rounded-2xl' : 'w-9 h-9 rounded-xl'} ${b.tile}`}>
        <Activity className={`${lg ? 'w-7 h-7' : 'w-5 h-5'} ${b.icon}`} strokeWidth={2.5} />
      </span>
      <span aria-hidden="true" className={`bg-gradient-to-r ${b.text} bg-clip-text text-transparent font-black tracking-wider text-xl`}>PULSE</span>
    </span>
  );
}
