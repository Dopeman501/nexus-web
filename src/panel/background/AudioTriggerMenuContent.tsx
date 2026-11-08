import { useState, type ReactNode } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../../components/common/Button/Button';
import { Notice } from '../../components/common/Notice/Notice';
import { SettingSlider, SettingToggle } from '../../components/common/SettingRow/SettingRow';
import { useTranslation } from '../../lib/i18n';
import styles from './AudioTriggerSettings.module.scss';

interface Props<T> {
  intensity: number;
  switchDelay: number;
  shuffle: boolean;
  onChange: (patch: { intensity?: number; switchDelay?: number; shuffle?: boolean }) => void;
  items: readonly T[];
  maximum: number;
  editingIndex: number | null;
  canSave: boolean;
  onSave: () => void;
  onNew: () => void;
  onEdit: (item: T, index: number) => void;
  onRemove: (index: number) => void;
  renderItem: (item: T) => ReactNode;
  labels: { add: string; update: string; new: string; edit: (index: number) => string;
    remove: (index: number) => string; hint: string; empty: string };
  leadingControls?: ReactNode;
  autoSave?: boolean;
  children: ReactNode;
}

/** Shared by display backgrounds and lighting. The toolbar stays outside the scroll body. */
export function AudioTriggerMenuContent<T>({ intensity, switchDelay, shuffle, onChange, items, maximum,
  editingIndex, canSave, onSave, onNew, onEdit, onRemove, renderItem, labels, leadingControls, autoSave = false, children }: Props<T>) {
  const { t } = useTranslation();
  const [draftIntensity, setIntensity] = useState<number | null>(null);
  const [draftDelay, setDelay] = useState<number | null>(null);
  const label = (key: string, fallback: string) => { const text = t(key); return text === key ? fallback : text; };
  return <>
    <div className={styles.actions}>
      {editingIndex !== null && <Button size="sm" icon={<Plus />} onClick={onNew}>{labels.new}</Button>}
      {(!autoSave || editingIndex === null) && <Button size="sm" tone="accent" disabled={!canSave} onClick={onSave}>{editingIndex === null ? labels.add : labels.update}</Button>}
      <span className={styles.hint}>{items.length} / {maximum}</span>
    </div>
    <div className={styles.body}>
      {leadingControls}
      <SettingSlider editable trackFill label={label('panel.audioTrigger.intensity', 'Audio Intensity')}
        description={label('panel.audioTrigger.intensityHint', 'Higher sensitivity responds to quieter audio and softer beats')}
        descriptionBelow value={draftIntensity ?? intensity} min={0} max={100} step={1} formatValue={number => `${number}%`}
        onChange={(number, commit) => { setIntensity(number); if (commit) { onChange({ intensity: number }); setIntensity(null); } }}
        onCommit={number => { onChange({ intensity: number }); setIntensity(null); }} />
      <SettingSlider editable trackFill label={label('panel.audioTrigger.delay', 'Switch Delay')}
        description={label('panel.audioTrigger.delayHint', 'Wait before entering Audio Trigger or returning after silence; beat changes stay immediate')}
        descriptionBelow value={draftDelay ?? switchDelay} min={0} max={10} step={0.1} formatValue={number => `${number.toFixed(1)} s`}
        onChange={(number, commit) => { setDelay(number); if (commit) { onChange({ switchDelay: number }); setDelay(null); } }}
        onCommit={number => { onChange({ switchDelay: number }); setDelay(null); }} />
      <SettingToggle label={label('slideshow.shuffle', 'Shuffle')} checked={shuffle} onChange={shuffle => onChange({ shuffle })} />
      <p className={styles.hint}>{labels.hint}</p>
      {items.length === 0 && <Notice tone="info">{labels.empty}</Notice>}
      <ol className={styles.selection}>
        {items.map((item, index) => <li key={index}>
          <Button size="sm" tone={editingIndex === index ? 'accent' : 'neutral'} aria-label={labels.edit(index)} onClick={() => onEdit(item, index)}>
            {index + 1}. {renderItem(item)}
          </Button>
          <Button size="sm" tone="ghost" icon={<Trash2 />} aria-label={labels.remove(index)} onClick={() => onRemove(index)} />
        </li>)}
      </ol>
      {children}
    </div>
  </>;
}
