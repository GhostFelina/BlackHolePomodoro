import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { EngineSyncState, LocaleCode, Settings } from '@blackholock/core';

/**
 * The only channel between the windows and the system.
 *
 * Node integration is off and context isolation is on, so a renderer can do
 * exactly what is listed here and nothing else. Every method is a named,
 * typed call — there is no generic `invoke(channel, ...)` escape hatch,
 * because that would hand any injected script the whole main process.
 */

export interface AppInfo {
  name: string;
  version: string;
  channel: string;
  platform: string;
  repository: string;
  releasesUrl: string;
  licence: string;
  settingsPath: string;
  systemLocale: string;
  isDev: boolean;
}

export interface UpdateResult {
  status: 'current' | 'available' | 'error';
  version?: string;
  url?: string;
}

/** What the main process tells the overlay about the break screen. */
export interface BreakSignal {
  /** off = no break UI, pending = Mola Ver gate, active = running countdown. */
  mode: 'off' | 'pending' | 'active';
  /** For 'pending': epoch ms at which the break begins on its own. */
  autoBeginAt?: number;
}

const api = {
  settings: {
    get: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
    set: (patch: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke('settings:set', patch),
    reset: (): Promise<Settings> => ipcRenderer.invoke('settings:reset'),
    onChanged: (handler: (settings: Settings) => void) =>
      subscribe('settings:changed', handler),
    onNavigate: (handler: (section: string) => void) => subscribe('settings:navigate', handler),
  },

  engine: {
    state: (): Promise<EngineSyncState> => ipcRenderer.invoke('engine:state'),
    start: (): Promise<EngineSyncState> => ipcRenderer.invoke('engine:start'),
    stop: (): Promise<EngineSyncState> => ipcRenderer.invoke('engine:stop'),
    breakNow: (): Promise<EngineSyncState> => ipcRenderer.invoke('engine:breakNow'),
    skipBreak: (): Promise<EngineSyncState> => ipcRenderer.invoke('engine:skipBreak'),
    /** The Mola Ver button: begin the break countdown now, ending the wait. */
    beginBreak: (): Promise<EngineSyncState> => ipcRenderer.invoke('engine:beginBreak'),
    onSync: (handler: (state: EngineSyncState) => void) => subscribe('engine:sync', handler),
  },

  capture: {
    /** Capture source id for a display, or null if unavailable or disabled. */
    sourceForDisplay: (displayId: number): Promise<string | null> =>
      ipcRenderer.invoke('capture:source', displayId),
    permission: (): Promise<string> => ipcRenderer.invoke('capture:permission'),
    openPreferences: (): Promise<void> => ipcRenderer.invoke('capture:openPrefs'),
  },

  overlay: {
    /**
     * The break has begun (`true`) or ended (`false`). Driven by the main
     * process, not by the WebGL animation, so the break screen appears even if
     * the shader never renders.
     */
    onBreak: (handler: (signal: BreakSignal) => void) => subscribe('overlay:break', handler),
    /**
     * Tells the main process the break UI is actually on screen. Main waits for
     * this before it lets the window swallow input — so it can never capture the
     * mouse and keyboard while there is no visible way out.
     */
    ready: (): void => {
      ipcRenderer.send('overlay:ready');
    },
  },

  app: {
    info: (): Promise<AppInfo> => ipcRenderer.invoke('app:info'),
    checkUpdates: (): Promise<UpdateResult> => ipcRenderer.invoke('app:checkUpdates'),
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('app:openExternal', url),
    resolveLocale: (requested: LocaleCode | 'system'): Promise<LocaleCode> =>
      ipcRenderer.invoke('locale:resolve', requested),
    onLocaleChanged: (handler: (locale: LocaleCode) => void) =>
      subscribe('locale:changed', handler),
  },
} as const;

function subscribe<T>(channel: string, handler: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T) => handler(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('blackholock', api);

export type BlackHolockApi = typeof api;
