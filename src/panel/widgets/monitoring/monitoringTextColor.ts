import type { CSSProperties } from 'react';
import { customTextVars } from '../../theme/textColor';

/** Config can come from imports; only a canonical hex reaches CSS or the picker. */
export function monitoringTextColor(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim())) return undefined;
  return (customTextVars(value) as Record<string, string>)['--text'];
}

/** Instance text overrides inherit when unset; gauge geometry keeps its theme. */
export function monitoringTextColorStyle(value: unknown): CSSProperties | undefined {
  const color = monitoringTextColor(value);
  if (!color) return undefined;
  const vars = customTextVars(color) as Record<string, string>;
  return {
    '--text': vars['--text'],
    '--text-dim': vars['--text-dim'],
    '--panel-ink-accent': vars['--panel-ink-accent'],
    '--panel-ink-accent-shadow': vars['--panel-ink-accent-shadow'],
  } as CSSProperties;
}
