import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { libraryIds, type LibraryId } from './adapter';
import { createTransitionController } from './controller';
import { catalogue, defaultEffect, findEffect, libraryLabels, loadEffectAdapter, readShortlist, shortlistKey } from './catalogue';
import { SamplerCatalogue } from './SamplerCatalogue';
import { settleCleanup } from './cleanup';
import dawnUrl from './fixtures/dawn.svg';
import nightUrl from './fixtures/night.svg';
import './style.css';

type Controller = ReturnType<typeof createTransitionController>;
type Snapshot = ReturnType<Controller['snapshot']>;
interface LabApi {
  select(id: LibraryId): Promise<boolean>;
  selectEffect(key: string): Promise<boolean>;
  effects(): typeof catalogue;
  selected(): string;
  shortlisted(): string[];
  next(): Promise<void>;
  seek(progress: number): void;
  play(durationMs?: number): void;
  clear(): Promise<void>;
  snapshot(): Snapshot;
}
declare global { interface Window { transitionLab?: LabApi } }

const text = {
  eyebrow: 'JUNGLE NEXUS / RESEARCH BRANCH', title: 'Picture transitions',
  introduction: 'Browse the complete effect catalogues and authored engine presets. Preview, shortlist and export your choices before adding anything to Nexus.',
  library: 'Library', duration: 'Duration (ms)', progress: 'Progress', size: 'Size',
  play: 'Play transition', next: 'Next picture', beats: 'Simulate 6 beats', clear: 'Clear', mount: 'Mount sample',
  fallback: 'Local dawn illustration fallback',
  landscape: 'Landscape · 1680 × 756', portrait: 'Portrait · 756 × 1680',
  limitation: 'Local browser sample only. No Nexus connection, microphone, settings writes or hardware commands. Different effects have different complexity; timings are not a library ranking.',
};

async function decode(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}

function TransitionLab() {
  const stage = useRef<HTMLDivElement>(null);
  const controller = useRef<Controller | null>(null);
  const fixtures = useRef<HTMLImageElement[]>([]);
  const currentEffect = useRef(defaultEffect('gl-transitions').key);
  const pair = useRef(0);
  const duration = useRef(800);
  const actions = useRef(0);
  const burstTimer = useRef(0);
  const [library, setLibrary] = useState<LibraryId>('gl-transitions');
  const [effectKey, setEffectKey] = useState(currentEffect.current);
  const [shortlist, setShortlist] = useState<string[]>(() => {
    try { return readShortlist(localStorage.getItem(shortlistKey)); } catch { return []; }
  });
  const shortlistRef = useRef(shortlist);
  const [storageNotice, setStorageNotice] = useState('');
  const [status, setStatus] = useState('Loading');
  const [error, setError] = useState('');
  const [size, setSize] = useState('landscape');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [durationValue, setDurationValue] = useState(800);
  const api = useRef<LabApi | null>(null);

  useEffect(() => {
    if (!stage.current) return;
    let live = true;
    const owner = createTransitionController(stage.current);
    controller.current = owner;
    const imagesReady = Promise.all([decode(dawnUrl), decode(nightUrl)]);
    let sampleError = '';
    const update = () => {
      if (!live) return;
      const state = owner.snapshot();
      setSnapshot(state);
      if (state.error) { setStatus('Fallback'); setError(state.error); }
    };
    const unsubscribe = owner.subscribe(update);
    const selectEffect = async (key: string): Promise<boolean> => {
      const effect = findEffect(key);
      if (!effect) throw new Error('Unknown catalogue transition');
      const epoch = ++actions.current;
      sampleError = '';
      currentEffect.current = key;
      if (live) { setLibrary(effect.library); setEffectKey(key); setStatus('Loading'); setError(''); }
      try {
        fixtures.current = await imagesReady;
        if (epoch !== actions.current || !live) return false;
        const factory = await loadEffectAdapter(key);
        if (epoch !== actions.current || !live) return false;
        const images = fixtures.current;
        const mounted = await owner.mount(factory, images[pair.current], images[(pair.current + 1) % 2]);
        if (mounted && live && epoch === actions.current) { setStatus('Ready'); update(); }
        return mounted;
      } catch (failure) {
        if (live && epoch === actions.current) {
          const cleanupError = await settleCleanup(owner.clear);
          if (!live || epoch !== actions.current) return false;
          sampleError = failure instanceof Error ? failure.message : 'Sample could not start';
          if (cleanupError) sampleError += `; cleanup: ${cleanupError}`;
          setError(sampleError);
          setStatus('Fallback');
        }
        return false;
      }
    };
    const select = (id: LibraryId) => {
      if (!libraryIds.includes(id)) return Promise.reject(new Error('Unknown comparison library'));
      return selectEffect(defaultEffect(id).key);
    };
    const play = (milliseconds = duration.current) => owner.play(milliseconds);
    const next = async () => {
      pair.current = (pair.current + 1) % 2;
      if (await selectEffect(currentEffect.current)) play();
    };
    const clear = async () => {
      const epoch = ++actions.current;
      sampleError = '';
      window.clearTimeout(burstTimer.current);
      const cleanupError = await settleCleanup(owner.clear);
      if (live && epoch === actions.current) {
        sampleError = cleanupError;
        setStatus(cleanupError ? 'Fallback' : 'Cleared'); setError(cleanupError); update();
      }
    };
    const exposed = { select, selectEffect, next, play, clear, seek: owner.seek,
      effects: () => catalogue, selected: () => currentEffect.current, shortlisted: () => [...shortlistRef.current],
      snapshot: () => ({ ...owner.snapshot(), error: sampleError || owner.snapshot().error }) };
    api.current = exposed;
    window.transitionLab = exposed;
    void selectEffect(currentEffect.current);
    return () => {
      live = false;
      window.clearTimeout(burstTimer.current);
      unsubscribe();
      void settleCleanup(owner.dispose).then(message => { if (message) console.warn('Transition sampler cleanup:', message); });
      delete window.transitionLab;
      api.current = null;
    };
  }, []);

  const effect = findEffect(effectKey)!;
  const chooseEffect = useCallback((key: string) => {
    void api.current?.selectEffect(key).then(mounted => { if (mounted) api.current?.play(); });
  }, []);
  const toggleShortlist = useCallback((key: string) => {
    if (!findEffect(key)) return;
    const previous = shortlistRef.current;
    const next = previous.includes(key) ? previous.filter(value => value !== key) : [...previous, key];
    shortlistRef.current = next;
    setShortlist(next);
    try { localStorage.setItem(shortlistKey, JSON.stringify(next)); setStorageNotice(''); } catch {
      setStorageNotice('Browser storage is unavailable. Export your choices to keep them.');
    }
  }, []);
  const exportShortlist = useCallback(() => {
    const chosen = shortlistRef.current.map(key => findEffect(key)!);
    const payload = JSON.stringify({ schemaVersion: 1, choices: chosen.map(({ key, library, id, label, origin }) => ({ key, library, id, label, origin })) }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'nexus-transition-shortlist.json'; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }, []);
  const burst = () => {
    window.clearTimeout(burstTimer.current);
    let remaining = 6;
    const step = () => {
      void api.current?.next();
      if (--remaining) burstTimer.current = window.setTimeout(step, 120);
    };
    step();
  };
  return <main>
    <header><span className="eyebrow">{text.eyebrow}</span><h1>{text.title}</h1><p>{text.introduction}</p></header>
    <section className="toolbar">
      <label>{text.library}<select aria-label={text.library} value={library} onChange={event => void api.current?.select(event.target.value as LibraryId)}>
        {libraryIds.map(id => <option key={id} value={id}>{`${libraryLabels[id]} (${catalogue.filter(item => item.library === id).length})`}</option>)}
      </select></label>
      <label>{text.duration}<input aria-label={text.duration} type="number" min="80" max="5000" step="20" value={durationValue}
        onChange={event => { const value = Math.max(80, Math.min(5000, Number(event.target.value) || 800)); duration.current = value; setDurationValue(value); }} /></label>
      <label>{text.size}<select aria-label={text.size} value={size} onChange={event => setSize(event.target.value)}>
        <option value="landscape">{text.landscape}</option><option value="portrait">{text.portrait}</option>
      </select></label>
      <div className="actions"><button onClick={() => api.current?.play()}>{text.play}</button><button onClick={() => void api.current?.next()}>{text.next}</button>
        <button onClick={burst}>{text.beats}</button><button onClick={() => void api.current?.clear()}>{text.clear}</button>
        <button onClick={() => void api.current?.selectEffect(currentEffect.current)}>{text.mount}</button></div>
    </section>
    <div className="sampler-workspace"><section className="comparison">
      <div className="description"><h2>{libraryLabels[library]}<span>{effect.label}</span></h2><p>{effect.description}</p><output data-testid="lab-status">{status}</output></div>
      <div ref={stage} className={`stage ${size}`} data-testid="transition-stage">
        <img className="fallback" data-testid="transition-fallback" src={dawnUrl} alt={text.fallback} />
      </div>
      {error && <p role="alert">{error}</p>}
      <label className="seek">{text.progress}<input aria-label={text.progress} type="range" min="0" max="100" value={(snapshot?.progress ?? 0) * 100}
        onChange={event => { controller.current?.stop(); api.current?.seek(Number(event.target.value) / 100); }} /></label>
      <div className="metrics"><span>{`${snapshot?.activeAdapters ?? 0} active sample`}</span><span>{`${snapshot?.pendingFrames ?? 0} host frame pending`}</span>
        <span>{`${snapshot?.drawnFrames ?? 0} playback frames`}</span><span>{`p95 interval ${(snapshot?.p95FrameMs ?? 0).toFixed(1)} ms`}</span></div>
    </section>
    <SamplerCatalogue library={library} selected={effectKey} shortlist={shortlist} onSelect={chooseEffect} onToggle={toggleShortlist} onExport={exportShortlist} />
    </div>
    {storageNotice && <p role="status">{storageNotice}</p>}
    <footer>{text.limitation}</footer>
  </main>;
}

createRoot(document.getElementById('root')!).render(<TransitionLab />);
