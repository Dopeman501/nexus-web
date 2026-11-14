import { patchPanelDevice } from '../../api/panel';
import { broadcastLayoutChanged } from '../engine/panelSync';
import type { AudioTriggerBeatTransitionSettings, BackgroundTransitionSettings, SharedBackgroundTransitionSettings } from '../background/transitions/settings';

type TransitionField = 'backgroundMediaTransition' | 'backgroundAudioTriggerTransition';

/** Each field drains independently, retaining only the newest completed edit. */
export function backgroundTransitionWriter(deviceId: string | null | undefined, persist: boolean, field: TransitionField) {
  return transitionWriter<BackgroundTransitionSettings>(deviceId, persist, field);
}
export function sharedBackgroundTransitionsWriter(deviceId: string | null | undefined, persist: boolean) {
  return transitionWriter<SharedBackgroundTransitionSettings>(deviceId, persist, 'backgroundTransitions');
}
export function audioTriggerBeatTransitionWriter(deviceId: string | null | undefined, persist: boolean) {
  return transitionWriter<AudioTriggerBeatTransitionSettings>(deviceId, persist, 'backgroundAudioTriggerBeatTransition');
}
function transitionWriter<T extends BackgroundTransitionSettings | SharedBackgroundTransitionSettings | AudioTriggerBeatTransitionSettings>(
  deviceId: string | null | undefined, persist: boolean, field: TransitionField | 'backgroundTransitions' | 'backgroundAudioTriggerBeatTransition') {
  let pending: T | null = null;
  let inFlight: T | null = null;
  let reported = false;
  const failed = () => {
    if (reported) return;
    reported = true;
    console.warn(`[panel-theme] ${field} save failed`);
  };
  const flush = async () => {
    if (inFlight || !pending || !deviceId || !persist) return;
    const settings = pending;
    pending = null;
    inFlight = settings;
    try {
      const saved = await patchPanelDevice(deviceId, { [field]: settings });
      if (saved) { reported = false; broadcastLayoutChanged(); } else failed();
    } catch { failed(); }
    finally { inFlight = null; if (pending) void flush(); }
  };
  return {
    write(settings: T) {
      if (!deviceId || !persist) return;
      pending = settings;
      void flush();
    },
    localSettings: () => pending ?? inFlight,
  };
}
