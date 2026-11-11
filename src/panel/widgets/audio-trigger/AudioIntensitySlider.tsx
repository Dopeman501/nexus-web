import { type CSSProperties, type KeyboardEvent, type PointerEvent, useRef } from 'react';
import { useTranslation } from '../../../lib/i18n';
import { AudioTriggerGlyph } from './AudioTriggerGlyph';
import styles from './AudioIntensitySlider.module.scss';

export interface AudioIntensitySliderProps {
  value: number;
  onChange: (value: number) => void;
  onCommit?: (value: number) => void;
  ariaLabel: string;
  disabled?: boolean;
  mixed?: boolean;
}

const bounded = (value: number): number => Number.isFinite(value) ? Math.round(Math.max(0, Math.min(100, value))) : 0;

/** Native horizontal range input with the panel mixer fader's filled capsule treatment. */
export function AudioIntensitySlider({ value, onChange, onCommit, ariaLabel, disabled = false, mixed = false }: AudioIntensitySliderProps) {
  const { t } = useTranslation();
  const current = bounded(value);
  const lastValue = useRef(current);
  const activePointer = useRef<number | null>(null);
  const change = (next: number) => {
    if (disabled) return;
    lastValue.current = bounded(next);
    onChange(lastValue.current);
  };
  const finish = (event: PointerEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (activePointer.current !== event.pointerId) return;
    activePointer.current = null;
    if (!disabled) onCommit?.(lastValue.current);
  };
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    const next = keyboardValue(event.key, current);
    if (next === null) {
      if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
      return;
    }
    event.stopPropagation();
    event.preventDefault();
    change(next);
    onCommit?.(bounded(next));
  };
  const text = mixed ? t('common.mixed') : `${current}%`;
  const content = <><AudioTriggerGlyph size={24} /><span>{mixed ? '—' : `${current}%`}</span></>;
  return <div className={styles.root} data-disabled={disabled || undefined}
    style={{ '--audio-intensity-fill': `${current}%` } as CSSProperties}>
    <div className={styles.fill} aria-hidden="true" />
    <div className={styles.content} aria-hidden="true">{content}</div>
    <div className={`${styles.content} ${styles.onFill}`} aria-hidden="true">{content}</div>
    <input className={styles.input} type="range" min={0} max={100} step={1} value={current} disabled={disabled}
      aria-label={ariaLabel} aria-orientation="horizontal" aria-valuetext={text}
      onChange={event => change(Number(event.currentTarget.value))}
      onPointerDown={event => {
        event.stopPropagation();
        if (disabled || activePointer.current !== null) return;
        activePointer.current = event.pointerId;
        lastValue.current = current;
      }}
      onPointerMove={event => event.stopPropagation()} onPointerUp={finish} onPointerCancel={finish}
      onClick={event => event.stopPropagation()} onKeyDown={keyDown}
      onBlur={() => {
        if (activePointer.current === null) return;
        activePointer.current = null;
        if (!disabled) onCommit?.(lastValue.current);
      }} />
  </div>;
}

function keyboardValue(key: string, value: number): number | null {
  switch (key) {
    case 'ArrowUp': case 'ArrowRight': return value + 1;
    case 'ArrowDown': case 'ArrowLeft': return value - 1;
    case 'PageUp': return value + 10;
    case 'PageDown': return value - 10;
    case 'Home': return 0;
    case 'End': return 100;
    default: return null;
  }
}
