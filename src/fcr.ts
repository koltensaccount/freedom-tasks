import type { App } from 'obsidian';
import type { Snapshot } from './model';
export const FCR_ID = 'full-calendar-remastered';
export const SCOPES = ['events:read', 'events:write', 'providers:read', 'providers:write', 'ui:open-calendar'] as const;
export interface FcrEvent {
  type: 'single' | 'rrule' | 'recurring'; title: string; uid?: string;
  date?: string; startDate?: string; allDay?: boolean; startTime?: string; endTime?: string;
  endDate?: string | null; completed?: boolean | string | null; description?: string;
  timezone?: string; isTask?: boolean; rrule?: string;
  icalTask?: { completedAt?: string; status?: string; [key: string]: unknown };
  [key: string]: unknown;
}
export interface Calendar { id: string; name: string; color?: string; }
export interface RemoteTask { id: string; uid: string; calendarId: string; event: FcrEvent; snapshot: Snapshot; recurring: boolean; }
export interface AuthorizedApi {
  getEvents(criteria: { calendarIds?: string[]; isTask?: boolean }): { id: string; uid?: string; calendarId?: string }[];
  getAllEvents(): { id: string; events: { id: string; event: FcrEvent }[] }[];
  getEventById(id: string): FcrEvent | null;
  getEventDetails(id: string): { event: FcrEvent; calendarId: string } | null;
  getCalendarSources(): { id: string; name: string; type: string; color?: string }[];
  getProviderCapabilities(id: string): { canCreate: boolean; canEdit: boolean; canDelete: boolean } | null;
  createEvent(id: string, event: FcrEvent, options?: { silent?: boolean }): Promise<boolean>;
  processEvent(id: string, processor: (event: FcrEvent) => FcrEvent, options?: { silent?: boolean }): Promise<boolean>;
  deleteEvent(id: string, options?: { force?: boolean }): Promise<void>;
  moveEvent(id: string, calendarId: string, event?: FcrEvent): Promise<void>;
  reloadProviderNow(id: string): void;
  openCalendar(): Promise<void>;
}
interface PublicApi {
  requestAccess(pluginId: string, reason: string, scopes: string[]): Promise<string | null>;
  withToken(token: string): AuthorizedApi | null;
}
export function usableDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function snapshotOf(event: FcrEvent, calendarId: string): Snapshot | null {
  const date = event.type === 'single' ? event.date : event.startDate;
  if (!usableDate(date)) return null;
  const time = event.allDay ? null : event.startTime;
  if (!event.allDay && (typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(time))) return null;
  return { title: event.title, completed: !!event.completed || event.icalTask?.status === 'COMPLETED', date, time: time?.slice(0, 5) || null, calendarId };
}
export function patchOwned(event: FcrEvent, values: Snapshot): FcrEvent {
  if (event.type !== 'single') {
    // Existing RRULE data is preserved; editing its placement/completion is deliberately unavailable.
    return { ...event, title: values.title };
  }
  return { ...event, title: values.title, completed: values.completed ? event.completed || true : false,
    date: values.date, allDay: values.time === null,
    startTime: values.time || undefined, endTime: values.time || undefined };
}
function validateSchedule(snapshot: Snapshot) {
  if (!usableDate(snapshot.date) || (snapshot.time !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(snapshot.time))) throw new Error('Choose a valid task date and optional time.');
  if (!snapshot.title.trim() || /[\r\n]/.test(snapshot.title)) throw new Error('A scheduled task needs a nonempty, single-line title.');
}
export class FcrBridge {
  constructor(private app: App, private token: () => string | null) {}
  private publicApi(): PublicApi | null {
    return (this.app as App & { plugins?: { plugins?: Record<string, { api?: PublicApi }> } }).plugins?.plugins?.[FCR_ID]?.api || null;
  }
  installed() { return !!this.publicApi(); }
  api(): AuthorizedApi {
    const publicApi = this.publicApi(); if (!publicApi) throw new Error('Enable Full Calendar Remastered to connect Freedom Tasks.');
    const token = this.token(); const api = token ? publicApi.withToken(token) : null;
    if (!api) throw new Error('Authorize or reconnect Freedom Tasks in settings.'); return api;
  }
  connected() { try { this.api(); return true; } catch { return false; } }
  async authorize(): Promise<string | null> {
    const api = this.publicApi(); if (!api) throw new Error('Install and enable Full Calendar Remastered first.');
    return api.requestAccess('freedom-tasks', 'Read and update tasks in your chosen task calendars, refresh those calendars, and open the calendar.', [...SCOPES]);
  }
  calendars(): Calendar[] {
    const api = this.api();
    return api.getCalendarSources().filter(source => {
      if (source.type !== 'caldavtasks') return false;
      const caps = api.getProviderCapabilities(source.id); return caps?.canCreate && caps.canEdit && caps.canDelete;
    }).map(({ id, name, color }) => ({ id, name, color }));
  }
  read(calendarIds: string[]): RemoteTask[] {
    const api = this.api(); const valid = new Set(this.calendars().map(c => c.id));
    const ids = calendarIds.filter(id => valid.has(id));
    if (!ids.length) return [];
    const tasks: RemoteTask[] = [];
    for (const query of api.getEvents({ calendarIds: ids, isTask: true })) {
      const details = api.getEventDetails(query.id); if (!details || !ids.includes(details.calendarId)) continue;
      const event = details.event; const snapshot = snapshotOf(event, details.calendarId);
      if (!event.uid || !snapshot) continue;
      tasks.push({ id: query.id, uid: event.uid, calendarId: details.calendarId, event, snapshot, recurring: event.type !== 'single' });
    }
    return tasks;
  }
  find(calendarId: string, uid: string): RemoteTask | null {
    const found = this.read([calendarId]).filter(task => task.uid === uid);
    if (found.length > 1) throw new Error('Duplicate remote UID; repair is required.'); return found[0] || null;
  }
  async create(snapshot: Snapshot, uid: string, description: string): Promise<RemoteTask> {
    validateSchedule(snapshot);
    if (!this.calendars().some(c => c.id === snapshot.calendarId)) throw new Error('Choose a writable CalDAV Tasks calendar.');
    const event: FcrEvent = { type: 'single', uid, title: snapshot.title, date: snapshot.date,
      allDay: snapshot.time === null, endDate: null, completed: snapshot.completed, description,
      ...(snapshot.time ? { startTime: snapshot.time, endTime: snapshot.time } : {}) };
    if (!await this.api().createEvent(snapshot.calendarId, event)) throw new Error('Calendar creation was not confirmed. The saved intent will be repaired, never retried automatically.');
    const remote = this.find(snapshot.calendarId, uid);
    if (!remote) throw new Error('Creation identity was not confirmed. Keep the saved intent and reconnect before retrying.'); return remote;
  }
  async update(remote: RemoteTask, expected: Snapshot, next: Snapshot): Promise<RemoteTask> {
    if (remote.recurring) throw new Error('Existing recurring tasks are read-only in Freedom Tasks to preserve their calendar data.');
    validateSchedule(next);
    if (!this.calendars().some(c => c.id === next.calendarId)) throw new Error('The destination must be a writable CalDAV Tasks calendar.');
    if (next.calendarId !== remote.calendarId) {
      await this.api().moveEvent(remote.id, next.calendarId, patchOwned(remote.event, next));
    } else {
      const ok = await this.api().processEvent(remote.id, current => {
        const now = snapshotOf(current, remote.calendarId);
        if (!now || JSON.stringify(now) !== JSON.stringify(expected)) throw new Error('The calendar task changed during synchronization. Sync again.');
        return patchOwned(current, next);
      });
      if (!ok) throw new Error('The calendar did not confirm the task update.');
    }
    const updated = this.find(next.calendarId, remote.uid);
    if (!updated) throw new Error('Calendar identity needs repair after the update.'); return updated;
  }
  async remove(remote: RemoteTask) { await this.api().deleteEvent(remote.id, { force: true }); }
  refresh(ids: string[]) { const allowed = new Set(this.calendars().map(c => c.id)); for (const id of ids) if (allowed.has(id)) this.api().reloadProviderNow(id); }
  openCalendar() { return this.api().openCalendar(); }
}
