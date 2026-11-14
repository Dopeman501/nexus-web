import { memo, useState } from 'react';
import { catalogue, libraryLabels, type CatalogueEffect } from './catalogue';
import type { LibraryId } from './adapter';

const text = { search: 'Search transitions', effect: 'Transition', previous: 'Previous transition', next: 'Next transition',
  add: 'Add to shortlist', remove: 'Remove from shortlist', shortlist: 'Your shortlist', export: 'Export choices',
  empty: 'Choose transitions to include later in Nexus.', noMatches: 'No matching transitions.', show: 'Shortlist only',
  catalogue: 'Transition catalogue', removeSymbol: '×' };

export const SamplerCatalogue = memo(function SamplerCatalogue({ library, selected, shortlist, onSelect, onToggle, onExport }: {
  library: LibraryId;
  selected: string;
  shortlist: readonly string[];
  onSelect(key: string): void;
  onToggle(key: string): void;
  onExport(): void;
}) {
  const [query, setQuery] = useState('');
  const [shortlistOnly, setShortlistOnly] = useState(false);
  const candidates = catalogue.filter(effect => effect.library === library);
  const search = query.trim().toLowerCase();
  const shown = candidates.filter(effect => (!shortlistOnly || shortlist.includes(effect.key))
    && `${effect.label} ${effect.description} ${effect.tags.join(' ')}`.toLowerCase().includes(search));
  const position = shown.findIndex(effect => effect.key === selected);
  const chooseStep = (step: number) => {
    if (!shown.length) return;
    const cursor = position < 0 ? (step > 0 ? -1 : 0) : position;
    onSelect(shown[(cursor + step + shown.length) % shown.length].key);
  };
  const name = (effect: CatalogueEffect) => `${libraryLabels[effect.library]} · ${effect.label}`;
  return <section className="catalogue" aria-label={text.catalogue}>
    <div className="catalogue-tools">
      <label>{text.effect}<select aria-label={text.effect} value={selected} onChange={event => onSelect(event.target.value)}>
        {candidates.map(effect => <option key={effect.key} value={effect.key}>{effect.label}</option>)}
      </select></label>
      <button onClick={() => chooseStep(-1)} disabled={!shown.length}>{text.previous}</button>
      <button onClick={() => chooseStep(1)} disabled={!shown.length}>{text.next}</button>
      <label>{text.search}<input type="search" aria-label={text.search} value={query} onChange={event => setQuery(event.target.value)} /></label>
      <label className="check"><input type="checkbox" checked={shortlistOnly} onChange={event => setShortlistOnly(event.target.checked)} />{text.show}</label>
      <span>{`${shown.length} / ${candidates.length}`}</span>
    </div>
    <div className="effect-list" data-testid="effect-list">
      {shown.length ? shown.map(effect => <article key={effect.key} data-selected={effect.key === selected}>
        <button className="effect-title" onClick={() => onSelect(effect.key)}>{effect.label}</button>
        <span className="effect-origin">{effect.origin}</span>
        <p>{effect.description}</p>
        <button aria-label={`${shortlist.includes(effect.key) ? text.remove : text.add}: ${effect.label}`}
          aria-pressed={shortlist.includes(effect.key)} onClick={() => onToggle(effect.key)}>
          {shortlist.includes(effect.key) ? text.remove : text.add}
        </button>
      </article>) : <p>{text.noMatches}</p>}
    </div>
    <div className="shortlist"><h2>{`${text.shortlist} (${shortlist.length})`}</h2>
      <button onClick={onExport} disabled={!shortlist.length}>{text.export}</button>
      {shortlist.length ? <ul>{shortlist.map(key => {
        const effect = catalogue.find(item => item.key === key)!;
        return <li key={key}><button onClick={() => onSelect(key)}>{name(effect)}</button>
          <button aria-label={`${text.remove}: ${name(effect)}`} onClick={() => onToggle(key)}>{text.removeSymbol}</button></li>;
      })}</ul> : <p>{text.empty}</p>}
    </div>
  </section>;
});
