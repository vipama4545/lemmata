// How a level is shown, and how one is chosen.
//
// Both live here because the flashcard deck and the story reader have to agree about what a
// level looks like: a word painted amber in a story and the same word on its card should
// obviously be the same word at the same level, and that only holds if one file draws both.

import type { Mastery, MasteryValue } from '../study/mastery';
import { MASTERIES, MASTERY_LABEL, MASTERY_NOTE, masteryAttr, masteryLabel } from '../study/mastery';

/** Six pips filled up to the level, with the level's name beside them. */
function MasteryBadge({ level, showLabel = true }: { level: MasteryValue; showLabel?: boolean }) {
  return (
    <span className="mastery" data-mastery={masteryAttr(level)} title={masteryLabel(level)}>
      <span className="mastery-pips" aria-hidden="true">
        {MASTERIES.map(step => (
          <span key={step} className={`mastery-pip${level !== null && step <= level ? ' is-on' : ''}`} />
        ))}
      </span>
      {showLabel && <span className="mastery-label">{masteryLabel(level)}</span>}
    </span>
  );
}

interface PickerProps {
  level: MasteryValue;
  onPick: (level: Mastery) => void;
  /** Offered only where there is something to forget — a word never met cannot be. */
  onForget?: () => void;
  label?: string;
}

/**
 * The six levels as buttons, low to high, so that they fill in the same direction as the
 * pips above. Setting one by hand also schedules it: saying "I am learning this" and then
 * never being asked about it again would make the label a lie.
 */
export function MasteryPicker({ level, onPick, onForget, label = 'How well do you know it?' }: PickerProps) {
  return (
    <div className="mastery-picker">
      <div className="mastery-picker-head">
        <span className="mastery-picker-label">{label}</span>
        <span className="mastery-picker-current">{masteryLabel(level)}</span>
      </div>
      <div className="mastery-picker-row" role="group" aria-label={label}>
        {MASTERIES.map(step => (
          <button
            key={step}
            type="button"
            className={`mastery-step${level === step ? ' is-on' : ''}`}
            data-mastery={step}
            onClick={() => onPick(step)}
            aria-pressed={level === step}
            title={`${MASTERY_LABEL[step]} — ${MASTERY_NOTE[step]}`}
          >
            {step}
          </button>
        ))}
        {onForget && level !== null && (
          <button type="button" className="mastery-forget" onClick={onForget} title="Forget this word — back to never seen">
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

export default MasteryBadge;
