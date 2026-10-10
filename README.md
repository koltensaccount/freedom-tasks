# Freedom Tasks

Schedule ordinary Markdown checkboxes through Full Calendar Remastered and synchronize them with selected Nextcloud CalDAV task calendars.

```markdown
- [ ] Finish signals homework
- [x] Review chapter four
```

Dates, identities, source links, and synchronization metadata stay in plugin data. Markdown remains portable. Only explicitly scheduled local tasks and remote VTODOs with a usable date participate in v1.

## Install the beta

Use BRAT with `koltensaccount/freedom-tasks` and choose the prerelease `0.1.0-beta.1`, or copy `main.js`, `manifest.json`, and `styles.css` from the release into `.obsidian/plugins/freedom-tasks` and enable Freedom Tasks.

Full Calendar Remastered is required. The verified current plugin ID is `full-calendar-remastered`. Add a dedicated **CalDAV Tasks** source there; ordinary CalDAV event sources are excluded. Freedom Tasks never asks for remote credentials.

## Connect and use

1. In Freedom Tasks settings, authorize Full Calendar access.
2. Choose managed task calendars and a default calendar. Configure the incoming Daily Note heading and fallback inbox.
3. Finish setup. Importing existing incomplete scheduled tasks is off by default; leaving it off establishes a starting remote baseline.
4. Focus a checkbox and click its calendar icon, or run **Freedom Tasks: Schedule task under cursor**. Select a date and optional time. Empty time means date only.

The schedule appears as an editor decoration; it is never written to Markdown. A note can use `task-calendar: School` in frontmatter to override the default by an unambiguous managed calendar name.

Newly eligible scheduled remote tasks go into **today's** configured Daily Note via `obsidian-daily-notes-interface`, regardless of due date. If Daily Notes is unavailable, the configured fallback note is used. Undated backlog items remain entirely owned by Full Calendar and Nextcloud until dated.

Use **Sync now**, **Open calendar**, and **View conflicts** from the command palette. Conflicts are resolved field by field. Repair can explicitly relink a mapping to the intended checkbox under the cursor. Duplicate titles are allowed; ambiguous identity is never guessed.

## Safety and scope

- Removing a remote date or deleting a remote item keeps the Markdown and retains a detached mapping. The same UID becoming dated again reconnects to the existing task.
- Deleting a local task line triggers remote deletion only after a 30-second relocation grace period and a second confident absence check. Whole-note deletion enters repair and never causes mass deletion.
- Creation/import intents are persisted before mutation. Interrupted operations require confirmation/repair instead of automatic duplicate creation.
- Ordinary single-task edits preserve remote descriptions and unrelated typed fields through public `processEvent`. FCR owns network access, ETags, and ICS property preservation.
- Priority UI is deferred because FCR's ordinary update path does not write PRIORITY.
- Existing recurring tasks are read-only from the local side in this beta. Remote changes may be pulled, but local edits need conflict resolution. FCR's current recurring update path can reset completion, so Freedom Tasks avoids it. RRULE data is never rewritten. No recurrence editor is provided.
- Calendar moves use FCR's public move operation, which currently creates at the destination and deletes at the source. Partial moves enter repair.
- FCR refresh is fire-and-forget. Reconciliation queries immediately and once again after three seconds. A temporarily missing remote item may detach safely and later reconnect.
- Reliable multi-device use requires syncing **both the vault and plugin data**. Simultaneous device writes cannot be perfectly ordered; review ambiguous mappings rather than recreate tasks.

The beta has automated integrity coverage and a production build. Live Nextcloud and touch/desktop acceptance checks still need to be run; see [MANUAL_TESTS.md](MANUAL_TESTS.md).

## Development

Use Node.js 22.9 or newer.

```sh
npm ci
npm test
npm run build
```

Source is split into a public FCR bridge, parser/locator, versioned store, pure reconciliation logic, guarded file I/O, Daily Note inbox, source-link service, editor extension, transient task UI, settings, and a lifecycle-only entry point. No reference implementation code was copied.

See [COMPATIBILITY.md](COMPATIBILITY.md) for the pinned FCR contract and public-read trace. MIT licensed.
