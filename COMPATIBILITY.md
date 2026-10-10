# FCR compatibility spike

Inspected 2026-10-10 using Serena symbol/reference tools. No reference source was changed or copied.

Pinned references:
- Full Calendar Remastered: `e1f29e78e416079ad208ea00382f43d59400cb0d`
- Tasks CalDAV Sync: `990308fb4ba2a23c39a1e8db4b9bc740905824ab` (indexed only; its sync architecture was not needed before this blocker).

## Decision

Stop before plugin implementation under specification stop condition 4. Required ingestion/reconciliation and mutation of undated remote tasks cannot use FCR's current public provider/cache API. Do not silently restrict the product to dated tasks or invent dates.

This is NOT a created-event identity blocker. Caller-supplied VTODO UID is supported safely for dated task creation.

## Verified public contract

- Actual manifest ID at this revision is `full-calendar-remastered`, NOT `full-calendar`. Public access is `app.plugins.plugins['full-calendar-remastered']?.api`; `FullCalendarPlugin.onload` assigns `new PublicAPI(this)`.
- `requestAccess(pluginId, reason, requestedScopes?) -> Promise<string | null>` and `withToken(token) -> AuthorizedAPI | null`.
- Planned scopes only: `events:read`, `events:write`, `providers:read`, `providers:write`, `ui:open-calendar`. No scopes have actually been requested.
- `getCalendarSources(): CalendarInfo[]` returns the registry sources. Sources include `id`, `name`, `type`, and optional color fields. CalDAV sources also contain provider configuration; Freedom Tasks must project only ID/name/type/color and never persist or expose credentials.
- Dedicated task source discriminator: `type === 'caldavtasks'`, corroborated by `CalDAVTaskProvider.type`. Require `getProviderCapabilities(id)` with `canCreate`, `canEdit`, and `canDelete` before offering a writable managed calendar. Display names are not evidence.
- `getEvents(criteria, sorts?) -> QueryableEvent[]`; criteria include `calendarIds`, `isTask`, and `isCompleted`. Query results expose current `id`, persistent `uid`, and `calendarId`.
- `getEventById(id): OFCEvent | null`, `getEventDetails(id): ApiEventDetails`.
- `createEvent(calendarId, event, options?): Promise<boolean>`; `updateEvent(eventId, event, options?): Promise<boolean>`; `processEvent(eventId, processor, options?): Promise<boolean>`.
- `deleteEvent(eventId, options?): Promise<void>` and `moveEvent(eventId, newCalendarId, newEventData?): Promise<void>`.
- `reloadProviderNow(calendarId): void` is fire-and-forget. There is no public refresh-complete signal or cache/event subscription in `AuthorizedAPI`.

## Dated task fields and identity

`OFCEvent` exposes `uid`, `title`, `description`, `allDay`, `timezone`, and typed task metadata `icalTask`. Single tasks use `type: 'single'`, `date`, `endDate`, `completed`, plus `startTime`/`endTime` for timed events. Date-only tasks use `allDay: true` without fabricated times. Queryable events expose source identity separately as `calendarId`.

Safe creation path: persist a pending creation intent with a fresh UID before calling `createEvent`; supply that UID in the event. The dedicated provider uses `event.uid || createRandomUid()`, writes that UID into VTODO, and returns it in the authoritative event. Cache creation retains that event before resolving true. Immediately query the selected source and match the exact UID, requiring exactly one result, to obtain its current event ID. Never match title/date. Store `(calendarId, uid)` as persistent remote identity and resolve the current session ID after refresh/restart. Queryable `id` is documented as a session/task ID, so it must not be treated as an immutable remote identifier.

Provider `updateEvent` reads the original ICS, preserves the UID, uses ETags, and delegates selective patching to `updateVTodoCalendar`. That function patches summary/description/location/dates/completion and preserves unrelated ICS properties. Public `processEvent` should preserve all OFCEvent fields not owned by Freedom Tasks. Inherited provider deletion targets the remote object via FCR's mapping; Freedom Tasks must never construct network requests.

## Blocking undated-task gap

Evidence in the pinned source:
- `src/providers/caldav/vtodo.ts`, `buildEvent`: `const placement = task.start || task.due; if (!placement) return null;`.
- `CalDAVTaskProvider.getEvents` skips `!task.event`. Thus VTODOs without DTSTART/DUE do not enter the event cache.
- `InternalAPI.getEvents` enumerates only cache events. Public `getAllEvents` also returns only cache events.
- `CalDAVTaskService.getUndatedTasks`, `getTaskBacklogItems`, and `setTaskBacklogItemComplete` operate on a separate backlog cache/provider path.
- `AuthorizedAPI` exposes none of these backlog read/completion/update/delete operations. Its `scheduleTask` cannot enumerate or reconcile undated tasks and would change their scheduling.

Consequences: a normal new unscheduled Nextcloud task cannot be ingested; clearing a mapped task's dates remotely can make it disappear from public queries even though the remote task still exists. Treating disappearance as deletion would incorrectly unlink it. Using internal backlog services or direct CalDAV would violate the required public API boundary.

Smallest proposed upstream improvement: expose a scoped public task/backlog facade using the existing provider registry/service path. It must enumerate dated AND undated VTODOs with stable `(calendarId, uid)` identity and optional dates, and support title/completion/delete operations for those identities. For example `getTasks({calendarIds})`, `processTask(taskId, processor)`, and `deleteTask(taskId)`, with existing `events:read`/`events:write` scopes. Existing event APIs can remain unchanged. Add public `refreshTasks(calendarId): Promise<void>` if needed to provide authoritative refresh completion. These are proposals, not current FCR methods.

Returning a created global ID from `createEvent` would simplify creation but is not necessary to fix identity at this revision, and does not solve the undated-task gap.

## Priority, recurrence, and triggers

- Priority: `icalTask.priority` is typed and parsed, and creation writes PRIORITY. However ordinary `updateVTodoCalendar` never patches PRIORITY, so full priority round-trip is not safe; defer the priority UI.
- Recurrence: existing RRULE is parsed and preserved by selective updates. The provider rejects generic `type: 'recurring'`; the serializer can create `type: 'rrule'`, but the update path does not edit RRULE. V1 should omit recurrence editing rather than assume full support.
- With no public subscription, planned triggers remain workspace-ready load, setup, manual sync, Freedom Tasks actions, debounced mapped-note modifications, and a configurable two-minute interval. Fire-and-forget refresh requires one bounded/debounced follow-up query; absence alone cannot establish authoritative remote deletion after failed/incomplete refresh. No triggers have been implemented.

## Verification and deliverables

- `freedom-tasks` is a separate Serena project with explicit TypeScript server configuration and a minimal strict `tsconfig.json`.
- Serena project health check passed overview, exact symbol lookup, and reference lookup on a temporary setup probe. The probe was removed; logs remain under ignored `.serena/`.
- Reference indexing succeeded: FCR 441 TypeScript files; Tasks CalDAV Sync 98.
- Live FCR lookup succeeded for `CalDAVTaskProvider`, public API types, and relevant references.
- No plugin unit tests/build were run because implementation stopped at compatibility. No `main.js`, manifest, styles, beta, GitHub repository, or release was published.
- No reference tracked files were modified. Only local `.serena/` configuration/index data was added, with `read_only: true`.

## Manual acceptance checklist after the API gap is resolved

1. Enable FCR and configure Nextcloud with the dedicated CalDAV Tasks source.
2. Authorize only the five scopes above; select managed/default calendars.
3. Schedule a plain checkbox and verify the VTODO and stable UID mapping.
4. Verify Nextcloud title/completion changes update the correct Markdown checkbox; unchecking reopens it remotely.
5. Change the date in FCR; verify the UI decoration changes without changing Markdown.
6. Create dated AND undated tasks in Nextcloud; both appear once in today's configured Daily Note.
7. Rename/move a source note and relocate its task; verify exact source navigation.
8. Delete remote: keep/unlink Markdown. Delete a local task line: remote deletion only after relocation grace. Delete a whole note: no mass deletion.
9. Schedule duplicate-title tasks; verify distinct mappings and ambiguous relocation enters repair.
10. Edit offline, reconnect, and resolve same-field conflicts independently.
11. Verify date-only state, existing RRULE preservation, unknown remote fields, and revoked authorization.
