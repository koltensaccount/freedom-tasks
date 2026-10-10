Freedom Tasks 0.1.0-beta.1

Standalone Obsidian plugin for scheduled plain Markdown tasks through Full Calendar Remastered's public API.

- Native setup, managed dedicated CalDAV Tasks sources, focus/command scheduling, date-only/time decorations, transient mobile/desktop task controls.
- Persisted UID mappings, three-way field reconciliation, guarded Markdown updates, today's Daily Note ingestion, source links, conflicts and repair.
- Scheduled-only v1: remote deletion or removal of a date retains Markdown and a detached tombstone; same-UID rescheduling reconnects.
- Five minimal scopes; no direct CalDAV, credentials, full-access scopes, or internal cache subscriptions.

Beta boundaries: priority is deferred; existing recurring tasks are read-only to avoid FCR's completion-reset behavior. Provider refresh has one bounded follow-up. Concurrent multi-device writes and actual Nextcloud/touch UI behavior require manual acceptance checks.

Install the attached main.js, manifest.json, and styles.css, or select this prerelease through BRAT. Full Calendar Remastered with a dedicated CalDAV Tasks source is required.

See MANUAL_TESTS.md and COMPATIBILITY.md in the repository. No live Nextcloud acceptance is claimed.

Validation: 63 targeted tests passed; TypeScript check and production build passed; Serena TypeScript project health check passed.
