import { useState } from 'react';
import { Button } from '../../components/common/Button/Button';
import { Overlay } from '../../components/common/Overlay/Overlay';
import { SettingSlider } from '../../components/common/SettingRow/SettingRow';
import { useTranslation } from '../../lib/i18n';
import { transitionOptions } from './transitions/catalogue';
import type { SharedBackgroundTransitionSettings } from './transitions/settings';
import { transitionThumbnailUrl } from './transitions/thumbnails';
import styles from './BackgroundTransitionPicker.module.scss';

export function BackgroundTransitionPicker({ value, error, onClose, onSelect, onDurationChange, onDurationCommit }: {
  value: SharedBackgroundTransitionSettings;
  error: boolean;
  onClose(): void;
  onSelect(effect: string): void;
  onDurationChange(durationMs: number): void;
  onDurationCommit(durationMs: number): void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const term = search.trim().toLocaleLowerCase();
  const matches = transitionOptions.filter(option => `${option.label} ${option.library}`.toLocaleLowerCase().includes(term));
  return <Overlay open variant="sheet" onClose={onClose} ariaLabel={t('panel.transitions.title')}
    className={styles.dialog} backdropClassName={styles.backdrop}>
    <header className={styles.header}>
      <h2>{t('panel.transitions.title')}</h2>
      <Button size="sm" onClick={onClose}>{t('panel.transitions.done')}</Button>
    </header>
    <div className={styles.controls}>
      <SettingSlider label={t('panel.transitions.duration')} value={value.durationMs} min={80} max={5000} step={10} editable
        formatValue={milliseconds => t('panel.transitions.milliseconds', { value: milliseconds })}
        onChange={onDurationChange} onCommit={onDurationCommit} />
      <p className={styles.hint}>{t('panel.transitions.chooseMultiple')}</p>
      <input type="search" className={styles.search} aria-label={t('panel.transitions.search')}
        placeholder={t('panel.transitions.search')} value={search} onChange={event => setSearch(event.currentTarget.value)} />
      {error && <p role="alert" className={styles.error}>{t('panel.transitions.previewUnavailable')}</p>}
    </div>
    <div className={styles.body}>
      {(['gl-transitions', 'curtains'] as const).map(library => {
        const options = matches.filter(option => option.library === library);
        if (!options.length) return null;
        return <section key={library} aria-label={t(library === 'curtains' ? 'panel.transitions.curtains' : 'panel.transitions.gl')}>
          <h3>{t(library === 'curtains' ? 'panel.transitions.curtains' : 'panel.transitions.gl')}</h3>
          <div className={styles.grid}>
            {options.map(option => {
              const order = value.effects.indexOf(option.key);
              return <button type="button" key={option.key} className={styles.tile}
                data-transition-key={option.key} data-selection-order={order >= 0 ? order + 1 : undefined}
                aria-label={option.label} aria-pressed={order >= 0} onClick={() => onSelect(option.key)}>
                <img src={transitionThumbnailUrl(option.key)} alt="" width={240} height={135} loading="lazy" decoding="async" />
                {order >= 0 && <span className={styles.order} aria-hidden>{order + 1}</span>}
                <span className={styles.label}>{option.label}</span>
              </button>;
            })}
          </div>
        </section>;
      })}
      {!matches.length && <p className={styles.hint}>{t('panel.transitions.noMatches')}</p>}
    </div>
  </Overlay>;
}
