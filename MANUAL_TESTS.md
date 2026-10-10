# Beta acceptance checklist

Run against a disposable Nextcloud task calendar first. Automated tests use deterministic adapter fixtures, not a live Nextcloud server.

1. Install/enable Full Calendar Remastered and configure a Nextcloud **CalDAV Tasks** source. Verify ordinary CalDAV sources are excluded.
2. Enable Freedom Tasks, authorize the five stated scopes, choose managed/default calendars, and finish setup with existing-task import off. Verify old tasks do not flood today's note.
3. Schedule `- [ ] Homework`. Verify a VTODO appears, Markdown remains unchanged, and a date decoration appears. Test true date-only and date/time separately.
4. Rename the task in Nextcloud: verify the correct checkbox text changes. Test Markdown markup titles enter a conflict instead of losing links/formatting.
5. Complete in Nextcloud: verify `[x]`. Uncheck in Markdown: verify remote reopening.
6. Drag/edit the date in FCR: verify the decoration changes without date syntax or note moves.
7. Create a dated task in Nextcloud: verify exactly one checkbox in **today's** configured Daily Note, even when due in the future. Verify frontmatter/template and existing Tasks section survive.
8. Create an undated task: verify no import or warning. Assign a date: verify it becomes eligible and imports once.
9. Clear the date on a mapped remote task: verify Markdown stays, decoration disappears, and no remote deletion occurs. Reassign a date to the same UID: verify reconnection without duplicate insertion.
10. Rename/move the source note: verify source navigation and mapping survive. Cut/move a task into another recently modified note within the grace period: verify relocation rather than deletion.
11. Delete a remote item: verify Markdown remains and detaches. Delete a local task line: verify remote deletion only after grace. Delete a whole note: verify repair, with remote tasks preserved.
12. Schedule two identical titles independently. Verify completion/title/date changes hit the intended checkbox. Make relocation ambiguous: verify repair, with no guesses or duplicate creation.
13. Edit while offline, reconnect, and inspect same-field conflicts. Resolve fields separately and verify independent field changes merge.
14. Interrupt creation/import or make local state persistence fail: verify saved intent/repair and no automatic duplicate creation. Confirm a partial calendar move enters repair.
15. Verify an existing RRULE item is preserved/read-only, local completion edits do not reset remote completion, and no priority/recurrence editor appears.
16. Revoke authorization/disable FCR: verify setup/reconnect state and no crash. Reload/disable Freedom Tasks with a popover open: verify cleanup.
17. On desktop, iPad, and phone: test focused-task icon, command-palette scheduling, Escape/outside dismissal, source links, keyboard tab order, touch targets, narrow editor widths, and copy/paste without decorations entering Markdown.
18. If Daily Notes is disabled, verify fallback inbox. Sync vault/plugin data to another device and confirm stable UID mappings; avoid competing writes during beta validation.
