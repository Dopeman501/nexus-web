import { useId, useRef, useState } from 'react';
import { Pipette } from 'lucide-react';
import type { KeyReaction } from '../../../api/keyReactive';
import { useTranslation } from '../../../lib/i18n';
import { contrastTextOn } from '../../../lib/settings';
import { HsvPicker } from '../HsvPicker/HsvPicker';
import { Popover } from '../Popover/Popover';
import { KEY_REACTION_PRESETS } from './keyReactionsUtils';
import { MAX_REACTION_COLORS, selectedReactionColors, toggleReactionColor } from './reactionPaletteUtils';
import styles from './TypeReactivePalette.module.scss';

interface TypeReactivePaletteProps {
  config: Pick<KeyReaction, 'color' | 'colors'>;
  onChange: (colors: string[]) => void;
}

/** Custom colours advance once per accepted press, in the order shown on the swatches. */
export function TypeReactivePalette({ config, onChange }: TypeReactivePaletteProps) {
  const { t } = useTranslation();
  const selected = selectedReactionColors(config);
  const choices = [...KEY_REACTION_PRESETS, ...selected.filter(color => !KEY_REACTION_PRESETS.includes(color))];
  const atLimit = selected.length >= MAX_REACTION_COLORS;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(selected[0]);
  const anchor = useRef<HTMLButtonElement>(null);
  const hintId = useId();
  const toggle = (color: string) => {
    const next = toggleReactionColor(selected, color);
    if (next) onChange(next);
  };
  const addCustom = () => {
    if (atLimit || selected.includes(draft)) return;
    onChange([...selected, draft]);
    setOpen(false);
  };

  return (
    <div className={styles.root}>
      <div className={styles.swatches} role="group" aria-label={t('lighting.keyReactions.color.palette')} aria-describedby={hintId}>
        {choices.map(color => {
          const index = selected.indexOf(color);
          return (
            <button
              key={color}
              type="button"
              className={styles.swatch}
              style={{ background: color, color: contrastTextOn(color) }}
              aria-label={color}
              aria-pressed={index >= 0}
              aria-describedby={index >= 0 ? `${hintId}-${index}` : undefined}
              disabled={atLimit && index < 0}
              onClick={() => toggle(color)}
            >
              {index >= 0 && <span className={styles.order} aria-hidden>{index + 1}</span>}
              {index >= 0 && <span id={`${hintId}-${index}`} className={styles.screenReader}>{t('lighting.keyReactions.color.position', { position: index + 1 })}</span>}
            </button>
          );
        })}
        <button
          ref={anchor}
          type="button"
          className={`${styles.swatch} ${styles.custom}`}
          aria-label={t('lighting.keyReactions.color.addCustom')}
          aria-haspopup="dialog"
          aria-expanded={open}
          disabled={atLimit}
          onClick={() => { setDraft(selected[selected.length - 1]); setOpen(value => !value); }}
        >
          <Pipette size={16} aria-hidden />
        </button>
      </div>
      <p id={hintId} className={styles.hint}>
        {atLimit
          ? t('lighting.keyReactions.color.limit', { count: MAX_REACTION_COLORS })
          : t('lighting.keyReactions.color.cycleHint')}
      </p>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchor} placement="bottom-end" portal
        ariaLabel={t('lighting.keyReactions.color.addCustom')} className={styles.popover}>
        <HsvPicker value={draft} onPreview={setDraft} onCommit={setDraft} />
        <button type="button" className={styles.add} disabled={atLimit || selected.includes(draft)} onClick={addCustom}>
          {t('lighting.keyReactions.color.add')}
        </button>
      </Popover>
    </div>
  );
}

