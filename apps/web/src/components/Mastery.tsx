// How a level is shown, and how one is chosen.
//
// Both live here because the flashcard deck and the story reader have to agree about what a
// level looks like: a word painted amber in a story and the same word on its card should
// obviously be the same word at the same level, and that only holds if one file draws both.
//
// The colour itself comes from the `data-mastery` attribute, which sets `--m` — see the rule
// at the foot of index.css. That is why `bg-m` and `text-m` below say nothing about which
// level they are drawing: they read whatever the nearest attribute put there.

import { cn } from '@/lib/utils';
import type { Mastery, MasteryValue } from '../study/mastery';
import { MASTERIES, MASTERY_LABEL, MASTERY_NOTE, masteryAttr, masteryLabel } from '../study/mastery';

/** Six pips filled up to the level, with the level's name beside them. */
function MasteryBadge({ level, showLabel = true }: { level: MasteryValue; showLabel?: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-[7px]"
      data-mastery={masteryAttr(level)}
      title={masteryLabel(level)}
    >
      <span className="inline-flex gap-0.5" aria-hidden="true">
        {MASTERIES.map(step => (
          <span
            key={step}
            className={cn(
              'h-3 w-1.5 rounded-[2px]',
              level !== null && step <= level ? 'bg-m' : 'bg-border',
            )}
          />
        ))}
      </span>
      {showLabel && <span className="text-xs font-semibold text-muted-foreground">{masteryLabel(level)}</span>}
    </span>
  );
}

interface PickerProps {
  level: MasteryValue;
  onPick: (level: Mastery) => void;
  /** Offered only where there is something to forget — a word never met cannot be. */
  onForget?: () => void;
  label?: string;
  /** Closes the gaps for the definition card, which is narrower than anywhere else this sits. */
  tight?: boolean;
}

/**
 * The six levels as buttons, low to high, so that they fill in the same direction as the
 * pips above. Setting one by hand also schedules it: saying "I am learning this" and then
 * never being asked about it again would make the label a lie.
 */
export function MasteryPicker({
  level,
  onPick,
  onForget,
  label = 'How well do you know it?',
  tight = false,
}: PickerProps) {
  return (
    <div className="mt-3 border-t border-border pt-2.5">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[11px] tracking-[0.04em] text-faint uppercase">{label}</span>
        <span className="text-xs font-semibold text-muted-foreground">{masteryLabel(level)}</span>
      </div>
      <div className={cn('flex items-stretch gap-1', tight && 'gap-[3px]')} role="group" aria-label={label}>
        {MASTERIES.map(step => (
          <button
            key={step}
            type="button"
            className={cn(
              'min-w-0 flex-1 cursor-pointer rounded-sm border py-1.5 text-[13px] font-semibold transition-colors duration-100',
              'hover:border-m hover:text-m',
              level === step
                ? 'border-m bg-[color-mix(in_srgb,var(--m)_22%,transparent)] text-foreground'
                : 'border-border bg-card text-muted-foreground',
            )}
            data-mastery={step}
            onClick={() => onPick(step)}
            aria-pressed={level === step}
            title={`${MASTERY_LABEL[step]} — ${MASTERY_NOTE[step]}`}
          >
            {step}
          </button>
        ))}
        {onForget && level !== null && (
          <button
            type="button"
            className="cursor-pointer rounded-sm border border-border px-2.5 py-1.5 text-xs text-faint hover:border-border-strong hover:text-foreground"
            onClick={onForget}
            title="Forget this word — back to never seen"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

export default MasteryBadge;
