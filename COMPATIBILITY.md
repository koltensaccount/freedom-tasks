# FCR compatibility

Verified 2026-10-10 with Serena symbol/reference tools against FCR commit `e1f29e78e416079ad208ea00382f43d59400cb0d`. Tasks CalDAV Sync reference commit: `990308fb4ba2a23c39a1e8db4b9bc740905824ab`. Its diff/gate/storage symbols informed the layered design; no reference code was copied or modified.

## Decision after follow-up

**SUPPORTED V1:** scheduled/date-only/datetime VTODO synchronization through FCR's public API.

**OUT OF SCOPE V1:** actively synchronizing undated backlog items. No warning or import is generated for an unseen undated VTODO.

**FUTURE, OPTIONAL:** expose undated VTODO enumeration through the public API so integrations can manage the entire task backlog. This is not a v1 blocker. No upstream PR is part of this work.

The earlier implementation stop was too conservative. Scheduled-only eligibility and retained detached mappings satisfy the product safely with the current public contract.

## Public entry point and authorization

Actual current manifest ID: `full-calendar-remastered` (the original specification's `full-calendar` ID does not match this revision). `FullCalendarPlugin.onload` assigns `this.api = new PublicAPI(this)`, reached through `app.plugins.plugins['full-calendar-remastered']?.api`.

`requestAccess(pluginId, reason, requestedScopes?) -> Promise<string | null>`; `withToken(token) -> AuthorizedAPI | null`.

Requested scopes: `events:read`, `events:write`, `providers:read`, `providers:write`, `ui:open-calendar`. The issued plugin token is stored in Freedom Tasks plugin data. No `system:full-access`, settings scope, internal cache access, or remote credentials are used. Missing/disabled FCR and revoked tokens produce setup/reconnect state instead of crashing Obsidian.

## Exact public read trace

The omission occurs **before EventCache**, not in structured filtering:

1. `parseVTodoCalendar` parses both dated and undated VTODOs. `buildEvent` returns `null` when `task.start || task.due` is absent (`src/providers/caldav/vtodo.ts`). Undated records still exist for the separate task backlog service.
2. `CalDAVTaskProvider.getEvents` skips `!task.event`; only dated events are returned to the event cache (`src/providers/caldav/CalDAVTaskProvider.ts`).
3. `AuthorizedAPI.getAllEvents` delegates to `EventCache.getAllEvents`, which walks cached calendar events and returns raw collections `{ id: calendarId, events: [{ id, event }], color, editable }`. It does not add task backlog entries.
4. `AuthorizedAPI.getEventById` delegates to `EventCache.getEventById`, then `EventStore.getEventById`: `store.get(id) || null`. It cannot find an undated task omitted from the cache. Its ID is the current cache/session ID; persistence must not rely on it surviving refresh/restart.
5. `AuthorizedAPI.getEventDetails` delegates through `InternalAPI` to `EventStore.getEventDetails`. Missing cache events return `null`; present events return event/source/location information. It also cannot find undated backlog entries.
6. `AuthorizedAPI.getEvents` delegates to `InternalAPI.getEvents`, which enumerates only `cache.getAllEvents`, obtains details, converts via `EventFilterSortEngine.fromStoredEvent`, then applies structured criteria/sorts. Filtering is downstream of the provider omission.

Thus **all four reads omit undated VTODOs** at this revision. The backlog is separately retained by `CalDAVTaskService.getUndatedTasks/getTaskBacklogItems`. No current public backlog enumeration is available, and Freedom Tasks does not access these private services.

A cache entry may remain visible until provider refresh completes. Once an undated/deleted item leaves the cache, direct ID lookup does not reliably distinguish the reasons. V1 intentionally handles both identically: keep Markdown, remove active scheduling, retain the UID/locator/baseline tombstone, and stop active sync. Exact UID reappearance with a usable date reconnects the existing task; it never creates another Daily Note checkbox.

## Sources and fields

`getCalendarSources(): CalendarInfo[]` returns source configuration records. Dedicated VTODO sources have `type === 'caldavtasks'`; `CalDAVTaskProvider.type` confirms this discriminator. Only sources whose public capabilities allow create/edit/delete are offered. Display names never establish provider type. Freedom Tasks immediately projects source ID/name/color/type and never retains provider credentials.

`getEvents(criteria, sorts?) -> QueryableEvent[]`; criteria include `calendarIds`, `isTask`, `isCompleted`. Query results expose current `id`, persistent `uid`, and `calendarId`. Freedom Tasks validates a usable date/time and reads current typed event data through `getEventDetails`.

Single tasks use `type: 'single'`, `title`, `date`, `allDay`, optional `startTime/endTime`, `completed`, `description`, `uid`, and `icalTask`. Date-only is `allDay: true` with no invented time. RRULE tasks use `startDate` and `rrule`; they are imported/pulled without recurrence mutation.

## Safe creation identity and mutations

`createEvent(calendarId, event, options?) -> Promise<boolean>` remains boolean. Safe identity is nevertheless available:

- Persist a pending intent with a fresh UID before network mutation.
- Supply that UID in the public OFCEvent. `CalDAVTaskProvider.createEvent` uses `event.uid || createRandomUid()` and writes the same UID into VTODO.
- `CacheMutationHandler.addEvent` retains the authoritative event before resolving true.
- Query the selected calendar and require exactly one exact UID match, obtaining its current event/session ID. Never match title/date.
- Persist `(calendarId, uid)` and re-resolve the session ID after refresh/restart. Interrupted/unconfirmed creation is never retried automatically.

`updateEvent(eventId, event, options?)` and `processEvent(eventId, processor, options?)` return `Promise<boolean>`. Single-task updates use `processEvent` and patch only owned fields, preserving description and unrelated typed fields. The provider reads the original ICS, applies ETags, and selectively patches summary/description/location/date/completion. Unknown ICS properties remain FCR's responsibility.

`deleteEvent(eventId, options?) -> Promise<void>`. `moveEvent(eventId, newCalendarId, newEventData?) -> Promise<void>` currently creates at the destination then deletes the original. Failed partial moves must enter repair; no second Markdown import is permitted for a pending destination UID.

## Priority and recurrence boundaries

`icalTask.priority` is typed, parsed, and written on creation. `updateVTodoCalendar` does not patch PRIORITY, so priority does not round-trip through ordinary edits; the priority UI is deferred.

Existing RRULE is parsed and preserved by selective updates. The serializer can create RRULE and the provider rejects generic `type: 'recurring'`, but there is no safe recurrence editing contract. More specifically, `applyCompletion` uses `event.type === 'single' ? Boolean(event.completed) : false`; updating an existing RRULE task can reset completion. This beta therefore makes recurring items read-only from the local side, while preserving/pulling remote state and exposing local divergences as conflicts. It never invokes an unsafe recurring mutation.

## Reconciliation and refresh

There is no public event/cache subscription in `AuthorizedAPI`. `reloadProviderNow(calendarId): void` delegates to a fire-and-forget provider reload and has no refresh-complete promise.

Implemented triggers:
- workspace-ready load when automatic sync is enabled;
- successful authorization/setup;
- manual Sync now;
- Freedom Tasks schedule/edit/remove operations;
- 800ms-debounced external changes to mapped notes or notes implicated in a pending relocation;
- configurable remote interval, default two minutes;
- one three-second follow-up query after public provider reload;
- a bounded follow-up after the 30-second local relocation grace period.

One reconciliation runs at a time; user mutations are serialized with reconciliation. Plugin-origin Markdown writes have a reentrancy guard. A missing remote item never causes Markdown or remote deletion. A local-line deletion requires confident absence, relocation grace, and a second check. Whole-note deletion enters repair.

## Persistence and verification

Schema version 1 lives in Obsidian plugin data via serialized `saveData`. Records contain Freedom UUID, stable remote UID/current event ID, source locator, local scheduling, synchronized field baseline, conflict evidence, timestamps, and active/detached/pending/repair/orphan state. No identity or date syntax is written to Markdown. Creation/import intents are saved first; interrupted imports enter repair rather than append duplicates.

Serena projects are separate and TypeScript-configured. Initial freedom-tasks health check passed symbol/reference operations with a removed setup probe. Reference indexes: FCR 441 files; Tasks CalDAV Sync 98. Relevant public API/provider/backlog symbols and own SyncEngine were inspected via Serena.

The beta's targeted unit/adapter/lifecycle tests and production build are documented in the release notes. Live Nextcloud behavior and native touch/desktop UI need the [manual acceptance checklist](MANUAL_TESTS.md); they are not claimed as tested.
