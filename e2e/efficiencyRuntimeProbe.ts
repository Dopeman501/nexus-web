import { chromium, type Browser, type Page, type CDPSession } from '@playwright/test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { release, cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { audioBeatFixture, audioBeatSeed } from './audioBeatTransitionsFixture';
import { fixtureId } from './backgroundTransitionsFixture';

interface Work { draws: number; copies: number; programs: number; livePrograms: number; mirrorPixelPeak: number }
interface OwnedProcess { Id: number; Name: string; PrivateBytes: number; WorkingSetBytes: number; Handles: number; Threads: number }
interface CpuProcess { id: number; type: string; cpuTime: number }
interface CaptureWork { failure?: unknown; frames: number; encoded: number; bytes: number; emptyReads: number }
interface CaptureSample { atSeconds: number; cpuSeconds: number; privateBytes: number;
  idle: CaptureWork; animated: CaptureWork; authoredFrames: number;
  fixture?: { width: number; height: number; fps: number; renderer: string; firstX: number; secondX: number } }
interface SurfaceSnapshot { work: Work; domNodes: number; canvases: number; heapBytes: number; taskSeconds: number }
interface Snapshot {
  at: number; work: Work; domNodes: number; canvases: number; heapBytes: number; taskSeconds: number;
  surfaces: Record<string, SurfaceSnapshot>;
  processes: CpuProcess[]; osProcesses: OwnedProcess[];
}
const mode = process.env.EFFICIENCY_MODE ?? 'soak';
const scenario = process.env.EFFICIENCY_SCENARIO ?? 'local';
const run = process.env.EFFICIENCY_PROBE_RUN ?? `${mode}-${scenario}`;
const smoke = process.env.EFFICIENCY_SMOKE === '1';
const captureDriverEnabled = process.env.EFFICIENCY_CAPTURE_DRIVER === '1';
if (!['soak', 'benchmark'].includes(mode) || !['q60', 'local', 'sleep', 'composite'].includes(scenario) || !/^[\w-]+$/.test(run)) throw new Error('Invalid efficiency probe configuration.');
const output = resolve('../builds/nexus-efficiency-20261117/web/runtime', run);
mkdirSync(output, { recursive: true });
if (existsSync(resolve(output, 'protocol.json'))) throw new Error('Choose a new probe run name; existing evidence is immutable.');
const warmMs = smoke ? 1000 : 120_000;
const measureMs = smoke ? 2000 : mode === 'soak' ? 30 * 60_000 : 5 * 60_000;
const sampleMs = smoke ? 500 : 10_000;
const repeats = mode === 'benchmark' ? 3 : 1;
const save = (name: string, value: unknown) => writeFileSync(resolve(output, name), JSON.stringify(value, null, 2));
const logicalProcessors = cpus().length;
const protocol = { mode, scenario, smoke, captureDriverEnabled, warmMs, measureMs, sampleMs, repeats, os: release(), logicalProcessors,
  harnessSha256: createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex'),
  lockfileSha256: createHash('sha256').update(readFileSync(resolve('package-lock.json'))).digest('hex'),
  interference: process.env.EFFICIENCY_INTERFERENCE ?? 'Unspecified; CPU inference requires a declared quiet run.',
  quality: 'Same authored shader, geometry/DPR,30fps,transitions; no lower quality or frame cap.',
  nativeScene: 'Two own offscreen opaque-layered memory-DC windows,800x800; animated source authored at30fps. Raw authored/captured/encoded counters and matching fixture metadata remain part of the input binding.',
  noise: 'After all three baseline runs, freeze their observed min/max CPU and committed-memory ranges before computing candidate comparisons. Claim CPU savings only if the candidate maximum is below the baseline minimum; overlapping ranges are below-noise/unresolved. No widened tolerance.',
  ownership: 'Each fixed surface must retain one live shader program and one connected shader canvas after warmup. Mirror targets cannot exceed4,000,000pixels. Composite runs Q60+asleepY70+localY70 in three isolated contexts concurrently. OSCPU/private memory covers the aggregate Edge tree and cannot be attributed to one surface; per-surfaceTaskDuration/work is reported separately. No installed Nexus/overlay or physical display claim.',
  retirement: 'After fixed-scene soak,20fresh context create/close cycles exercise teardown. Keep raw samples; no assumed RAM threshold or leak claim from a short increase.' };
save('protocol.json', protocol);
let stopped = false;
process.on('SIGINT', () => { stopped = true; });
process.on('SIGTERM', () => { stopped = true; });
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const assetBindings = new Map<string, string>();
const fixtureBindings = new Map<string, string>();
const captureBindings = new Map<string, string>();
let captureFixtureBinding: string | undefined;

function inventory(root: string) {
  const files: { path: string; bytes: number; sha256: string }[] = [];
  const visit = (directory: string, prefix = '') => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = prefix + entry.name, file = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(file, path + '/');
      else if (entry.isFile()) files.push({ path, bytes: statSync(file).size,
        sha256: createHash('sha256').update(readFileSync(file)).digest('hex') });
      else throw new Error('Frozen inputs must contain only regular files/directories.');
    }
  };
  visit(root);
  const treeSha256 = createHash('sha256').update(JSON.stringify(files)).digest('hex');
  return { files, treeSha256 };
}

function assets(label: 'baseline' | 'candidate') {
  const prefix = `EFFICIENCY_${label.toUpperCase()}`;
  const root = process.env[`${prefix}_ASSET_ROOT`];
  const expected = process.env[`${prefix}_INDEX_SHA256`]?.toLowerCase();
  if (!root || !/^[a-f\d]{64}$/.test(expected ?? '')) throw new Error(`Explicit ${label} asset root/index hash required.`);
  const absolute = resolve(root);
  const hash = createHash('sha256').update(readFileSync(resolve(absolute, 'index.html'))).digest('hex');
  if (hash !== expected) throw new Error(`${label} dashboard index hash mismatch.`);
  const { files, treeSha256 } = inventory(absolute);
  if (assetBindings.has(label) && assetBindings.get(label) !== treeSha256) throw new Error(`${label} asset bytes changed between repetitions.`);
  if (!assetBindings.has(label)) { save(`${label}-asset-inventory.json`, files); assetBindings.set(label, treeSha256); }
  return { root: absolute, hash, treeSha256, files: files.length };
}

async function startCaptureDriver(label: 'baseline' | 'candidate', repetition: number) {
  if (!captureDriverEnabled) return null;
  const executable = resolve(`../builds/nexus-efficiency-20261117/overlay/bench-${label}-layered/Nexus.Overlay.Bench.exe`);
  const executableSha256 = createHash('sha256').update(readFileSync(executable)).digest('hex');
  const { files, treeSha256 } = inventory(dirname(executable));
  if (captureBindings.has(label) && captureBindings.get(label) !== treeSha256) throw new Error(`${label} capture driver changed between repetitions.`);
  if (!captureBindings.has(label)) save(`${label}-capture-inventory.json`, files);
  captureBindings.set(label, treeSha256);
  const evidence = resolve(output, `${label}-${repetition}-capture.json`);
  const stdout = resolve(output, `${label}-${repetition}-capture.stdout.log`);
  const stderr = resolve(output, `${label}-${repetition}-capture.stderr.log`);
  let driverFailure: Error | null = null, readyAt: number | null = null, closedAt: number | null = null;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let resolveReady!: () => void, rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((accept, reject) => { resolveReady = accept; rejectReady = reject; });
  const child = spawn(executable, [String(warmMs / 1000), String(measureMs / 1000), evidence],
    { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
  let readyTail = '';
  const bytes = { stdout: 0, stderr: 0 };
  for (const [name, stream, file] of [['stdout', child.stdout, stdout], ['stderr', child.stderr, stderr]] as const) {
    stream.on('data', (chunk: Buffer) => {
      bytes[name] += chunk.length;
      if (bytes[name] > 8_388_608) {
        driverFailure = new Error(`Owned capture driver exceeded its ${name} evidence bound.`);
        rejectReady(driverFailure); child.kill(); return;
      }
      writeFileSync(file, chunk, { flag: 'a' });
      if (name === 'stdout') {
        readyTail = (readyTail + chunk.toString('utf8')).slice(-1024);
        if (readyAt === null && readyTail.includes('NEXUS_BENCH_READY')) { readyAt = Date.now(); resolveReady(); }
      }
    });
  }
  const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(accept => {
    child.on('error', error => { driverFailure = error; rejectReady(error); });
    child.on('close', (code, signal) => {
      closedAt = Date.now();
      clearTimeout(watchdog);
      if (code !== 0) driverFailure ??= new Error(`Capture driver exited unsuccessfully (${code ?? signal}).`);
      if (readyAt === null) rejectReady(driverFailure ?? new Error(`Capture driver exited before readiness (${code}).`));
      accept({ code, signal });
    });
  });
  const timeout = setTimeout(() => rejectReady(new Error('Capture driver did not acknowledge readiness within30seconds.')), 30_000);
  try { await ready; }
  catch (error) { child.kill(); await done; throw error; }
  finally { clearTimeout(timeout); }
  if (closedAt === null) watchdog = setTimeout(() => {
    driverFailure = new Error('Owned capture driver exceeded its measurement/retirement bound.');
    child.kill();
  }, warmMs + measureMs + 60_000);
  return {
    identity: { executable, executableSha256, treeSha256, evidence, stdout, stderr, readyAt },
    async finish() {
      const exit = await done;
      if (driverFailure || exit.code !== 0 || !existsSync(evidence)) throw driverFailure ?? new Error(`Capture driver failed (${exit.code}).`);
      if (statSync(evidence).size > 8_388_608) throw new Error('Capture measurement exceeded its evidence bound.');
      const samples = JSON.parse(readFileSync(evidence, 'utf8')) as CaptureSample[];
      if (!Array.isArray(samples) || samples.length < 2 || samples.some(sample => !sample?.idle || !sample.animated
        || sample.idle.failure || sample.animated.failure || !Number.isFinite(sample.atSeconds)
        || !Number.isFinite(sample.cpuSeconds) || !Number.isFinite(sample.privateBytes) || !Number.isFinite(sample.authoredFrames)
        || [sample.idle, sample.animated].some(work => [work.frames, work.encoded, work.bytes, work.emptyReads]
          .some(value => !Number.isFinite(value) || value < 0)))) throw new Error('Capture driver reported an invalid/failed measurement.');
      const first = samples[0], last = samples.at(-1)!;
      const fixture = first.fixture;
      if (!fixture || fixture.width !== 800 || fixture.height !== 800 || fixture.fps !== 30
        || fixture.renderer !== 'opaque-layered-memory-dc' || !Number.isFinite(fixture.firstX) || !Number.isFinite(fixture.secondX)
        || fixture.secondX + fixture.width >= 0 || fixture.firstX + fixture.width >= fixture.secondX) throw new Error('Capture fixture geometry/renderer/offscreen metadata is invalid.');
      const fixtureKey = JSON.stringify(fixture);
      if (captureFixtureBinding !== undefined && captureFixtureBinding !== fixtureKey) throw new Error('Native authored input changed between matched repetitions.');
      if (captureFixtureBinding === undefined) { captureFixtureBinding = fixtureKey; save('capture-fixture.json', fixture); }
      if (last.atSeconds <= first.atSeconds || last.cpuSeconds < first.cpuSeconds
        || samples.some(sample => sample.privateBytes <= 0)) throw new Error('Capture driver reported invalid elapsed time or resource counters.');
      if (last.idle.frames < 1 || last.animated.encoded <= first.animated.encoded
        || last.animated.bytes <= first.animated.bytes || last.authoredFrames <= first.authoredFrames
        || last.animated.frames <= first.animated.frames) throw new Error('Capture comparison lost its actual authored/static/animated encoding workload.');
      return { ...this.identity, ...exit, closedAt, evidenceSha256: createHash('sha256').update(readFileSync(evidence)).digest('hex'),
        stats: { seconds: last.atSeconds - first.atSeconds, cpuSeconds: last.cpuSeconds - first.cpuSeconds,
          animatedEncodedFrames: last.animated.encoded - first.animated.encoded,
          authoredFrames: last.authoredFrames - first.authoredFrames, capturedFrames: last.animated.frames - first.animated.frames,
          minPrivateBytes: Math.min(...samples.map(sample => sample.privateBytes)), maxPrivateBytes: Math.max(...samples.map(sample => sample.privateBytes)) } };
    },
    check() { if (driverFailure) throw driverFailure; },
    async stop() { if (closedAt === null) child.kill(); await done; },
  };
}

async function observe(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { efficiencyRuntime: Work };
    const work = w.efficiencyRuntime = { draws: 0, copies: 0, programs: 0, livePrograms: 0, mirrorPixelPeak: 0 };
    const isShader = (canvas: unknown): canvas is HTMLCanvasElement => canvas instanceof HTMLCanvasElement && !!canvas.closest('[data-panel-bg-layer][data-ready]');
    const draw = WebGL2RenderingContext.prototype.drawArrays;
    WebGL2RenderingContext.prototype.drawArrays = function (...args) {
      if (isShader(this.canvas)) work.draws++;
      return Reflect.apply(draw, this, args);
    };
    const programs = new WeakSet<WebGLProgram>();
    const create = WebGL2RenderingContext.prototype.createProgram;
    WebGL2RenderingContext.prototype.createProgram = function () {
      const program = Reflect.apply(create, this, []);
      if (program && isShader(this.canvas)) { programs.add(program); work.programs++; work.livePrograms++; }
      return program;
    };
    const remove = WebGL2RenderingContext.prototype.deleteProgram;
    WebGL2RenderingContext.prototype.deleteProgram = function (program) {
      if (program && programs.delete(program)) work.livePrograms--;
      return Reflect.apply(remove, this, [program]);
    };
    const copy = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (source: CanvasImageSource, ...args: number[]) {
      if (isShader(source)) { work.copies++; work.mirrorPixelPeak = Math.max(work.mirrorPixelPeak, this.canvas.width * this.canvas.height); }
      return Reflect.apply(copy, this, [source, ...args]);
    };
  });
}

async function scene(browser: Browser, selectedScenario = scenario) {
  const q60 = selectedScenario === 'q60';
  const context = await browser.newContext({ viewport: q60 ? { width: 480, height: 1280 } : { width: 550, height: 1920 },
    deviceScaleFactor: 1, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage();
  await observe(page);
  const initial = audioBeatSeed();
  const surface = q60 ? 'q60' : 'y70';
  Object.assign(initial, { backgroundMode: 'shader', backgroundEffect: 'plasma', backgroundTemplate: 0,
    backgroundAudioTrigger: { ...initial.backgroundAudioTrigger!, enabled: false },
    capabilities: { surface, touch: true, cssWidth: q60 ? 480 : 550, cssHeight: q60 ? 1280 : 1920, dpr: 1 },
    layout: { layoutSchemaVersion: 2, surface, pages: [{ id: 'main', widgets: [] }] } });
  const fixture = await audioBeatFixture(page, initial);
  const binding = { record: structuredClone(initial), shaderHashes: fixture.shaderHashes,
    viewport: page.viewportSize(), dpr: 1, fps: 30 };
  const key = JSON.stringify(binding);
  if (fixtureBindings.has(selectedScenario) && fixtureBindings.get(selectedScenario) !== key) throw new Error('Matched fixture configuration/shader source changed between repetitions.');
  if (!fixtureBindings.has(selectedScenario)) { save(`fixture-${selectedScenario}.json`, binding); fixtureBindings.set(selectedScenario, key); }
  await page.goto(`http://localhost:9400/panel/${fixtureId}?streamFps=30`);
  await page.locator('[data-panel-bg-layer][data-ready="true"] canvas').waitFor();
  if (selectedScenario === 'sleep') {
    const cdp = await context.newCDPSession(page);
    try {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 275, y: 3 }] });
      for (let y = 20; y <= 350; y += 30) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 275, y }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } finally { await cdp.detach(); }
    await page.getByRole('button', { name: 'Screen sleep', exact: true }).tap();
    await page.locator('.panel-root[data-screen-sleep="true"]').waitFor({ state: 'attached' });
  }
  return { context, page, fixture };
}

async function measure(label: 'baseline' | 'candidate', repetition: number) {
  const selected = assets(label);
  process.env.BACKGROUND_TRANSITIONS_ASSET_ROOT = selected.root;
  process.env.BACKGROUND_TRANSITIONS_EXPECTED_INDEX_SHA256 = selected.hash;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  let capture: Awaited<ReturnType<typeof startCaptureDriver>> = null;
  try {
    const browserCdp = await browser.newBrowserCDPSession();
    const info = await browserCdp.send('SystemInfo.getInfo');
    save(`${label}-${repetition}-identity.json`, { ...selected, browser: browser.version(), gpu: info.gpu.devices, protocol });
    const current: Array<Awaited<ReturnType<typeof scene>> & { name: string; cdp: CDPSession }> = [];
    for (const name of scenario === 'composite' ? ['q60', 'sleep', 'local'] : [scenario]) {
      const surface = await scene(browser, name);
      const cdp = await surface.context.newCDPSession(surface.page);
      await cdp.send('Performance.enable');
      current.push({ name, ...surface, cdp });
    }
    const snapshot = async (): Promise<Snapshot> => {
      capture?.check();
      const surfaces: Record<string, SurfaceSnapshot> = {};
      for (const surface of current) {
        const metrics = await surface.cdp.send('Performance.getMetrics') as { metrics: { name: string; value: number }[] };
        const metric = (name: string) => {
          const value = metrics.metrics.find(item => item.name === name)?.value;
          if (value === undefined || !Number.isFinite(value)) throw new Error(`Required browser metric unavailable: ${name}`);
          return value;
        };
        const frame = await surface.page.evaluate(() => ({ work: { ...(window as unknown as { efficiencyRuntime: Work }).efficiencyRuntime },
          domNodes: document.getElementsByTagName('*').length, canvases: document.querySelectorAll('[data-panel-bg-layer][data-ready="true"] canvas').length }));
        if (surface.fixture.state.errors.length || surface.fixture.state.blocked.length) throw new Error('Fixture runtime/network isolation failed.');
        if (frame.work.livePrograms !== 1 || frame.canvases !== 1 || frame.work.mirrorPixelPeak > 4_000_000) throw new Error('Fixed-scene resource ownership exceeded its declared bound.');
        surfaces[surface.name] = { ...frame, heapBytes: metric('JSHeapUsedSize'), taskSeconds: metric('TaskDuration') };
      }
      const processes = (await browserCdp.send('SystemInfo.getProcessInfo')).processInfo as CpuProcess[];
      const ids = processes.map(item => item.id);
      const osProcesses: OwnedProcess[] = process.platform === 'win32' && ids.length
        ? JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
          resolve('e2e/efficiencyProcessSample.ps1'), '-ProcessIds', ids.join(',')], { encoding: 'utf8', windowsHide: true })) : [];
      const sum = (get: (surface: SurfaceSnapshot) => number) => Object.values(surfaces).reduce((value, surface) => value + get(surface), 0);
      return { at: Date.now(), surfaces, work: { draws: sum(surface => surface.work.draws), copies: sum(surface => surface.work.copies),
        programs: sum(surface => surface.work.programs), livePrograms: sum(surface => surface.work.livePrograms),
        mirrorPixelPeak: Math.max(...Object.values(surfaces).map(surface => surface.work.mirrorPixelPeak)) },
        domNodes: sum(surface => surface.domNodes), canvases: sum(surface => surface.canvases),
        heapBytes: sum(surface => surface.heapBytes), taskSeconds: sum(surface => surface.taskSeconds), processes, osProcesses };
    };
    capture = await startCaptureDriver(label, repetition);
    if (capture) save(`${label}-${repetition}-capture-identity.json`, capture.identity);
    console.log(`${label}/${repetition}: warming ${warmMs}ms (${protocol.interference})`);
    const warm: Snapshot[] = [];
    const warmUntil = Date.now() + warmMs;
    while (!stopped && Date.now() < warmUntil) { await pause(Math.min(sampleMs, warmUntil - Date.now())); warm.push(await snapshot()); }
    save(`${label}-${repetition}-warm.json`, warm);
    const samples: Snapshot[] = [await snapshot()];
    const end = Date.now() + measureMs;
    let heartbeat = Date.now();
    while (!stopped && Date.now() < end) {
      await pause(Math.min(sampleMs, end - Date.now()));
      samples.push(await snapshot());
      save(`${label}-${repetition}-samples.json`, samples);
      if (Date.now() - heartbeat >= 60_000) { console.log(`${label}/${repetition}: ${samples.length} bounded samples recorded`); heartbeat = Date.now(); }
    }
    const first = samples[0], last = samples.at(-1)!;
    if (!stopped) {
      for (const surface of current) {
        const before = first.surfaces[surface.name].work, after = last.surfaces[surface.name].work;
        const draws = after.draws - before.draws, copies = after.copies - before.copies;
        if (label === 'candidate' && ((surface.name === 'q60' && copies !== 0)
          || (surface.name === 'sleep' && (draws !== 0 || copies !== 0)))) throw new Error(`Candidate ${surface.name} resumed prohibited shader work.`);
        if (surface.name === 'local' && (draws <= 0 || copies <= 0)) throw new Error('Local comparison lost its live shader/mirror workload.');
      }
    }
    if (stopped) await capture?.stop();
    const captureResult = capture && !stopped ? await capture.finish() : null;
    const initialCpu = new Map(first.processes.map(item => [item.id, item.cpuTime]));
    const initialTypes = new Map(first.processes.map(item => [item.id, item.type]));
    const previousCpu = new Map(initialCpu);
    const sameProcesses = samples.every(sample => sample.processes.length === first.processes.length && sample.processes.every(item => {
      const previous = previousCpu.get(item.id);
      if (previous === undefined || initialTypes.get(item.id) !== item.type || item.cpuTime < previous) return false;
      previousCpu.set(item.id, item.cpuTime); return true;
    }));
    const completeOsSamples = samples.every(sample => sample.osProcesses.length === sample.processes.length
      && sample.processes.every(item => sample.osProcesses.some(process => process.Id === item.id)));
    const seconds = (last.at - first.at) / 1000;
    const summary = { label, repetition, stopped, sameProcesses, completeOsSamples, seconds, capture: captureResult,
      cpuSeconds: last.processes.reduce((sum, item) => sum + Math.max(0, item.cpuTime - (initialCpu.get(item.id) ?? 0)), 0),
      draws: last.work.draws - first.work.draws, copies: last.work.copies - first.work.copies,
      maxPrivateBytes: Math.max(...samples.map(sample => sample.osProcesses.reduce((sum, item) => sum + item.PrivateBytes, 0))),
      minPrivateBytes: Math.min(...samples.map(sample => sample.osProcesses.reduce((sum, item) => sum + item.PrivateBytes, 0))),
      maxHandles: Math.max(...samples.map(sample => sample.osProcesses.reduce((sum, item) => sum + item.Handles, 0))),
      maxThreads: Math.max(...samples.map(sample => sample.osProcesses.reduce((sum, item) => sum + item.Threads, 0))),
      finalOwnedWork: last.work, surfaces: Object.fromEntries(current.map(surface => [surface.name, {
        first: first.surfaces[surface.name], last: last.surfaces[surface.name], shaderHashes: surface.fixture.shaderHashes,
        drawsPerSecond: (last.surfaces[surface.name].work.draws - first.surfaces[surface.name].work.draws) / seconds,
        copiesPerSecond: (last.surfaces[surface.name].work.copies - first.surfaces[surface.name].work.copies) / seconds,
        fixtureErrors: surface.fixture.state.errors, blocked: surface.fixture.state.blocked,
      }])) };
    save(`${label}-${repetition}-summary.json`, { ...summary,
      oneCoreCpuPercent: summary.cpuSeconds / seconds * 100,
      wholeMachineCpuPercent: summary.cpuSeconds / seconds / logicalProcessors * 100 });
    for (const surface of current) await surface.context.close();
    if (mode === 'soak' && !stopped) {
      const cycles = [];
      for (let cycle = 0; cycle < 20 && !stopped; cycle++) {
        for (const name of scenario === 'composite' ? ['q60', 'sleep', 'local'] : [scenario]) {
          const next = await scene(browser, name);
          await next.context.close();
        }
        const contexts = browser.contexts().length;
        if (contexts !== 0) throw new Error('A retired fixture context remained owned after churn.');
        cycles.push({ cycle, completedAt: Date.now(), contexts,
          processes: (await browserCdp.send('SystemInfo.getProcessInfo')).processInfo });
        save('churn.json', cycles);
      }
    }
    console.log(`${label}/${repetition}: complete; ${summary.draws}draws/${summary.copies}copies`);
    return summary;
  } finally { await capture?.stop(); await browser.close(); }
}

const results: Awaited<ReturnType<typeof measure>>[] = [];
for (let repetition = 1; repetition <= repeats && !stopped; repetition++) {
  if (mode === 'benchmark') results.push(await measure('baseline', repetition));
  if (!stopped) results.push(await measure('candidate', repetition));
}
if (mode === 'benchmark' && !stopped) {
  const cpuRate = (result: typeof results[number]) => result.cpuSeconds / result.seconds
    + (result.capture ? result.capture.stats.cpuSeconds / result.capture.stats.seconds : 0);
  const baseline = results.filter(result => result.label === 'baseline');
  const activeSurfaces = Object.keys(baseline[0].surfaces).filter(name => name !== 'sleep');
  const cadenceBands = (measurements: typeof results) => Object.fromEntries(activeSurfaces.map(name => [name, {
    min: Math.min(...measurements.map(result => result.surfaces[name].drawsPerSecond)),
    max: Math.max(...measurements.map(result => result.surfaces[name].drawsPerSecond)),
  }]));
  const band = { cpuSeconds: { min: Math.min(...baseline.map(result => result.cpuSeconds)), max: Math.max(...baseline.map(result => result.cpuSeconds)) },
    cpuPerSecond: { min: Math.min(...baseline.map(result => result.cpuSeconds / result.seconds)), max: Math.max(...baseline.map(result => result.cpuSeconds / result.seconds)) },
    combinedCpuPerSecond: { min: Math.min(...baseline.map(cpuRate)), max: Math.max(...baseline.map(cpuRate)) },
    captureCommittedBytes: captureDriverEnabled ? { min: Math.min(...baseline.map(result => result.capture!.stats.minPrivateBytes)),
      max: Math.max(...baseline.map(result => result.capture!.stats.maxPrivateBytes)) } : null,
    committedBytes: { min: Math.min(...baseline.map(result => result.minPrivateBytes)), max: Math.max(...baseline.map(result => result.maxPrivateBytes)) },
    activeDrawsPerSecond: cadenceBands(baseline),
    captureEncodedPerSecond: captureDriverEnabled ? { min: Math.min(...baseline.map(result => result.capture!.stats.animatedEncodedFrames / result.capture!.stats.seconds)),
      max: Math.max(...baseline.map(result => result.capture!.stats.animatedEncodedFrames / result.capture!.stats.seconds)) } : null };
  save('baseline-band.json', band);
  const candidate = results.filter(result => result.label === 'candidate');
  const validQuietCpu = !smoke && results.every(result => result.sameProcesses) && process.env.EFFICIENCY_QUIET === '1';
  const candidateCadence = cadenceBands(candidate);
  save('comparison.json', { band, validQuietCpu, candidateCadence,
    activeCadenceBelowBaselineBand: Object.fromEntries(activeSurfaces.map(name => [name, candidateCadence[name].max < band.activeDrawsPerSecond[name].min])),
    cpuMetric: captureDriverEnabled ? 'Combined isolated browser CPU/sec plus own capture-driver CPU/sec; per-component raw data remains separate.' : 'Isolated browser CPU/sec.',
    cpuSavingsAboveNoise: validQuietCpu ? Math.max(...candidate.map(cpuRate)) < band.combinedCpuPerSecond.min : null,
    baseline, candidate, limits: protocol.interference });
}
save('complete.json', { stopped, smoke, results });
