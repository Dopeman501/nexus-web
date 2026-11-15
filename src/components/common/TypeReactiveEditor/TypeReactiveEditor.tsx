import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  CircleDot, Crosshair, Flame, MoveHorizontal, MoveVertical, Radio, Route, Sparkles, Sun, Zap,
} from 'lucide-react';
import { Slider } from '../Slider/Slider';
import { SettingToggle } from '../SettingRow/SettingRow';
import { IconLabelButton } from '../IconLabelButton/IconLabelButton';
import { ChipGroup } from '../ChipGroup/ChipGroup';
import { useTranslation } from '../../../lib/i18n';
import { isTunnelActive } from '../../../api/service';
import { subscribeLedFrame } from '../../../lib/ledFrameStore';
import type { LightingFrameState } from '../../../hooks/useLightingFrames';
import {
  fetchKeyReactionPreview,
  pressKeyReaction,
  type KeyReactionBackground,
  type KeyReactionColorMode,
  type KeyReactionEffect,
  type KeyReactionPreview,
} from '../../../api/keyReactive';
import {
  KEY_REACTION_BACKGROUNDS,
  KEY_REACTION_COLOR_MODES,
  KEY_REACTION_EFFECTS,
  MULTIPLIER_STEP,
  SIZE_RANGE,
  SPEED_RANGE,
  formatMultiplier,
  liveLedBytes,
  snapMultiplier,
} from './keyReactionsUtils';
import { TypeReactiveBoard } from './TypeReactiveBoard';
import { TypeReactivePalette } from './TypeReactivePalette';
import styles from './TypeReactiveEditor.module.scss';
import type { TypeReactiveConfig } from './useTypeReactiveConfig';
export { useTypeReactiveConfig } from './useTypeReactiveConfig';
export type { TypeReactiveConfig, TypeReactiveScope } from './useTypeReactiveConfig';

export interface TypeReactiveEditorProps {
  /** Lighting-device card id of the reactive keyboard (press / preview routes). */
  cardId: string;
  /** Config state from {@link useTypeReactiveConfig}; the host owns it so the config outlives a remount of the editor. */
  controller: TypeReactiveConfig;
  /** False when no real key source is live, so typing is not detected. */
  inputAvailable: boolean;
  /** The device reports its own key presses and ignores OS keystrokes. */
  hardwareKeys: boolean;
  /** The card's device index byte in the lighting output stream. */
  frameIndex: number;
  /** Lighting output socket state; frames themselves arrive through ledFrameStore. */
  stream: LightingFrameState;
  /** Shared lighting regions, with an explicit physical-key layout. */
  zoneLighting?: boolean;
  ledCount?: number;
  supportedEffects?: readonly KeyReactionEffect[];
  keyboardLayouts?: readonly string[];
  /** 'split' puts the options left and a compact board right (the modal); 'stacked' is one column (the keyboard page). */
  layout?: 'split' | 'stacked';
}

const EFFECT_ICONS: Record<KeyReactionEffect, ReactNode> = {
  fade: <CircleDot size={18} />,
  rowSweep: <MoveHorizontal size={18} />,
  columnSweep: <MoveVertical size={18} />,
  ripple: <Radio size={18} />,
  crosshair: <Crosshair size={18} />,
  starburst: <Sun size={18} />,
  heatmap: <Flame size={18} />,
  sparks: <Sparkles size={18} />,
  lightning: <Zap size={18} />,
  trace: <Route size={18} />,
};

const KEYBOARD_LAYOUTS = ['US', 'UK', 'BR', 'JP'] as const;

/**
 * Type reactive editor for one keyboard: how a key press lights the board.
 * Shared by the lighting page modal and the keyboard page, so both read and
 * write the same stored config through the same routes.
 *
 * The board's layout comes from the service's preview route; its colours are
 * the card's real output from the lighting stream, so typing and clicking keys
 * appear exactly as on the hardware. Without a stream the keys show unlit.
 */
export function TypeReactiveEditor({
  cardId, controller, inputAvailable, hardwareKeys, frameIndex, stream, layout = 'stacked',
  zoneLighting = false, ledCount: physicalLedCount, supportedEffects, keyboardLayouts,
}: TypeReactiveEditorProps) {
  const { t } = useTranslation();
  const { config, update, flushSave, current, epoch, layoutRevision, isCurrent } = controller;
  const effects = supportedEffects === undefined
    ? KEY_REACTION_EFFECTS : KEY_REACTION_EFFECTS.filter(key => supportedEffects.includes(key));
  const regions = KEYBOARD_LAYOUTS.filter(key => keyboardLayouts?.includes(key));
  const region = zoneLighting ? config.keyboardLayout ?? '' : '';
  const layoutReady = !zoneLighting || regions.some(key => key === region);
  const reactionsReady = layoutReady && effects.length > 0;
  const effectiveEffect = effects.includes(config.effect) ? config.effect : effects[0];

  // Fetch geometry per card/physical layout; ordinary look edits reuse it. LED
  // colours always come from the output stream, on or off.
  const [preview, setPreview] = useState<KeyReactionPreview | null>(null);
  const previewConfigRef = useRef(config);
  previewConfigRef.current = { ...config, effect: effectiveEffect ?? config.effect };
  useEffect(() => {
    setPreview(null);
    if (!reactionsReady || !isCurrent()) return;
    const ctl = new AbortController();
    const pending = layoutRevision !== undefined
      ? fetchKeyReactionPreview(cardId, { ...previewConfigRef.current, enabled: true }, ctl.signal, epoch, layoutRevision)
      : epoch === undefined
      ? fetchKeyReactionPreview(cardId, { ...previewConfigRef.current, enabled: true }, ctl.signal)
      : fetchKeyReactionPreview(cardId, { ...previewConfigRef.current, enabled: true }, ctl.signal, epoch);
    pending
      .then(res => { if (!ctl.signal.aborted && isCurrent() && res) setPreview(res); })
      .catch(() => { /* aborted or unreachable: the board stays empty */ });
    return () => ctl.abort();
  }, [cardId, region, reactionsReady, epoch, layoutRevision, isCurrent]);

  // Live needs an open stream (never over relay) and the card's section in
  // the frames; without them the board shows unlit keys.
  const streamUsable = stream.connected && !isTunnelActive();
  const ledCount = preview?.x.length ?? 0;
  const [live, setLive] = useState(false);
  useEffect(() => {
    if (!streamUsable || ledCount === 0) {
      setLive(false);
      return;
    }
    const unsubscribe = subscribeLedFrame(f => {
      const present = liveLedBytes(f.devices, frameIndex, ledCount) !== null;
      setLive(prev => (prev === present ? prev : present));
    });
    return () => { unsubscribe(); setLive(false); };
  }, [streamUsable, ledCount, frameIndex]);

  const pressRandom = useCallback(() => {
    if (!reactionsReady || !isCurrent()) return;
    const pending = layoutRevision !== undefined ? pressKeyReaction(cardId, {}, epoch, undefined, layoutRevision)
      : epoch === undefined ? pressKeyReaction(cardId, {}) : pressKeyReaction(cardId, {}, epoch);
    pending.catch(() => { /* best-effort */ });
  }, [cardId, reactionsReady, epoch, layoutRevision, isCurrent]);
  const handlePressLed = useCallback((led: number) => {
    if (!reactionsReady || !isCurrent()) return;
    const pending = layoutRevision !== undefined ? pressKeyReaction(cardId, { led }, epoch, undefined, layoutRevision)
      : epoch === undefined ? pressKeyReaction(cardId, { led }) : pressKeyReaction(cardId, { led }, epoch);
    pending.catch(() => { /* best-effort */ });
  }, [cardId, reactionsReady, epoch, layoutRevision, isCurrent]);

  // Picking an effect on a live board fires one press so the change shows on
  // the hardware at once. The press runs on the stored config, so the edit is
  // written first.
  const handlePickEffect = useCallback((key: KeyReactionEffect) => {
    update({ effect: key });
    if (!current().enabled || !reactionsReady) return;
    void flushSave().then(pressRandom);
  }, [update, flushSave, current, pressRandom, reactionsReady]);

  const colorOptions = KEY_REACTION_COLOR_MODES.map(key => ({ key, label: t(`lighting.keyReactions.color.${key}`) }));
  const backgroundOptions = KEY_REACTION_BACKGROUNDS.map(key => ({ key, label: t(`lighting.keyReactions.background.${key}`) }));

  // Typing reaches the board when it reports its own keys or the OS source is live.
  const typingWorks = hardwareKeys || inputAvailable;

  return (
    <div className={`${styles.body} ${layout === 'split' ? styles.split : ''}`}>
      <div className={styles.toggleArea}>
        <SettingToggle
          label={t('lighting.keyReactions.title')}
          description={t(zoneLighting ? 'lighting.keyReactions.zoneDescription' : 'lighting.keyReactions.description')}
          checked={config.enabled && reactionsReady}
          disabled={!reactionsReady}
          onChange={enabled => { if (reactionsReady) update({ enabled, effect: effectiveEffect }); }}
        />
        {zoneLighting && (
          <section className={styles.section}>
            <span className={styles.sectionTitle}>{t('lighting.keyReactions.keyboardLayout.title')}</span>
            <ChipGroup
              options={regions.map(key => ({ key, label: t(`lighting.keyReactions.keyboardLayout.${key}`) }))}
              ariaLabel={t('lighting.keyReactions.keyboardLayout.title')}
              activeKey={region}
              onChange={keyboardLayout => update({ keyboardLayout, enabled: config.enabled && reactionsReady })}
              wrap
            />
            {!layoutReady && <p className={styles.hint}>{t('lighting.keyReactions.keyboardLayout.required')}</p>}
          </section>
        )}
      </div>

      <section className={styles.boardArea}>
        <TypeReactiveBoard
          preview={preview}
          label={t(zoneLighting ? 'lighting.keyReactions.zonePreviewLabel' : 'lighting.keyReactions.previewLabel')}
          disabled={!config.enabled || !reactionsReady}
          zoneLighting={zoneLighting}
          live={live}
          frameIndex={frameIndex}
          onPressLed={handlePressLed}
          onPressRandom={pressRandom}
        />
        {zoneLighting && (physicalLedCount ?? ledCount) > 0 && (
          <span className={styles.sectionTitle}>{t('lighting.keyReactions.zoneCount', { count: physicalLedCount ?? ledCount })}</span>
        )}
        <span className={styles.hint}>
          {t(zoneLighting
            ? typingWorks ? 'lighting.keyReactions.zonePreviewHint' : 'lighting.keyReactions.zonePreviewHintClick'
            : typingWorks ? 'lighting.keyReactions.previewHint' : 'lighting.keyReactions.previewHintClick')}
        </span>
      </section>

      <div className={styles.optionsArea}>
        <section className={styles.section}>
          <span className={styles.sectionTitle}>{t('lighting.keyReactions.effect')}</span>
          <div className={styles.gallery} role="group" aria-label={t('lighting.keyReactions.effect')}>
            {effects.map(key => (
              <IconLabelButton
                key={key}
                icon={EFFECT_ICONS[key]}
                label={t(zoneLighting && key === 'fade' ? 'lighting.keyReactions.zoneFade' : `lighting.keyReactions.effects.${key}.name`)}
                active={key === effectiveEffect}
                onPress={() => handlePickEffect(key)}
              />
            ))}
          </div>
        </section>

        <section className={styles.section} data-testid="key-reactions-color">
          {config.effect === 'heatmap' ? (
            <p className={styles.hint}>{t('lighting.keyReactions.heatNote')}</p>
          ) : (
            <>
              <span className={styles.sectionTitle}>{t('lighting.keyReactions.color.title')}</span>
              <ChipGroup
                options={colorOptions}
                ariaLabel={t('lighting.keyReactions.color.title')}
                activeKey={config.colorMode}
                onChange={key => update({ colorMode: key as KeyReactionColorMode })}
              />
              {config.colorMode === 'custom' && (
                <TypeReactivePalette key={`${cardId}:${epoch ?? ''}:${layoutRevision ?? ''}`} config={config}
                  onChange={colors => update({ color: colors[0], colors })} />
              )}
            </>
          )}
        </section>

        <section className={styles.section}>
          <span className={styles.sectionTitle}>{t('lighting.keyReactions.background.title')}</span>
          <ChipGroup
            options={backgroundOptions}
            ariaLabel={t('lighting.keyReactions.background.title')}
            activeKey={config.background}
            onChange={key => update({ background: key as KeyReactionBackground })}
          />
          <p className={styles.hint}>{t(`lighting.keyReactions.background.${config.background}Hint`)}</p>
        </section>

        <section className={styles.sliders}>
          <Slider
            // eslint-disable-next-line i18next/no-literal-string -- slider layout enum
            orientation="stacked"
            editable
            trackFill
            label={t('lighting.keyReactions.speed')}
            ariaLabel={t('lighting.keyReactions.speed')}
            value={config.speed}
            min={SPEED_RANGE.min}
            max={SPEED_RANGE.max}
            step={MULTIPLIER_STEP}
            formatValue={formatMultiplier}
            onChange={v => update({ speed: snapMultiplier(v) })}
          />
          <Slider
            // eslint-disable-next-line i18next/no-literal-string -- slider layout enum
            orientation="stacked"
            editable
            trackFill
            label={t('lighting.keyReactions.size')}
            ariaLabel={t('lighting.keyReactions.size')}
            value={config.size}
            min={SIZE_RANGE.min}
            max={SIZE_RANGE.max}
            step={MULTIPLIER_STEP}
            formatValue={formatMultiplier}
            onChange={v => update({ size: snapMultiplier(v) })}
          />
        </section>
      </div>
    </div>
  );
}
