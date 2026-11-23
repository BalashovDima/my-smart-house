import type { ReactNode } from 'react';

export type Tone = 'slate' | 'green' | 'amber' | 'rose' | 'sky';

const TONES: Record<Tone, string> = {
  slate: 'border-slate-700 bg-slate-800/60 text-slate-300',
  green: 'border-emerald-600/50 bg-emerald-500/10 text-emerald-300',
  amber: 'border-amber-600/50 bg-amber-500/10 text-amber-200',
  rose: 'border-rose-600/50 bg-rose-500/10 text-rose-300',
  sky: 'border-sky-600/50 bg-sky-500/10 text-sky-300',
};

export function StatusPill({
  children,
  tone = 'slate',
  className = '',
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function Dot({ tone = 'slate' }: { tone?: Tone }) {
  const colors: Record<Tone, string> = {
    slate: 'bg-slate-500',
    green: 'bg-emerald-400',
    amber: 'bg-amber-400',
    rose: 'bg-rose-400',
    sky: 'bg-sky-400',
  };
  return <span className={`h-1.5 w-1.5 rounded-full ${colors[tone]}`} aria-hidden="true" />;
}
