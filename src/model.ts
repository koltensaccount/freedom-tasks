export type Field = 'title' | 'completed' | 'date' | 'time' | 'calendarId';
export interface Snapshot {
  title: string; completed: boolean; date: string; time: string | null; calendarId: string;
}
export interface Locator {
  sourcePath: string; lineHint: number; sourceText: string; title: string;
  before: string[]; after: string[]; duplicateCount: number;
}
export interface Conflict { field: Field; base: string | boolean | null; local: string | boolean | null; remote: string | boolean | null; }
export type TaskState = 'active' | 'detached' | 'needsRepair' | 'pendingCreate' | 'pendingImport' | 'orphaned';
export interface TaskRecord {
  id: string; uid: string; eventId?: string; locator: Locator; calendarId: string;
  local: Snapshot; baseline: Snapshot; state: TaskState;
  detachedReason?: string; missingSince?: number; lastSeenAt: number;
  conflicts: Conflict[]; deletionIntent?: boolean; deletionIntentReason?: 'localMissing' | 'remove';
}
export interface Settings {
  token: string | null; managed: string[]; defaultCalendar: string;
  heading: string; fallbackPath: string; automatic: boolean; intervalMinutes: number;
}
export interface StoreData {
  version: 1; settings: Settings; tasks: Record<string, TaskRecord>;
  knownRemote: string[]; initializedCalendars: string[]; lastSync?: number;
}
export const defaultSettings: Settings = {
  token: null, managed: [], defaultCalendar: '', heading: 'Tasks',
  fallbackPath: 'Freedom Tasks Inbox.md', automatic: true, intervalMinutes: 2,
};
export function freshData(): StoreData {
  return { version: 1, settings: { ...defaultSettings, managed: [] }, tasks: {}, knownRemote: [], initializedCalendars: [] };
}
export const remoteKey = (calendarId: string, uid: string) => JSON.stringify([calendarId, uid]);
export const fields: Field[] = ['title', 'completed', 'date', 'time', 'calendarId'];
