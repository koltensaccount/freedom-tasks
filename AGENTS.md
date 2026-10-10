# Freedom Tasks

- Plain Markdown checkboxes remain portable. Never write IDs, comments, dates, priorities, tags, or emoji metadata into task lines.
- Full Calendar Remastered is the required provider layer. Never implement CalDAV or store remote credentials.
- Use only FCR public authorization/provider/cache contracts. Never request `system:full-access` or call `getInternalState()`.
- Verify the installed FCR plugin ID and public signatures against the pinned compatibility report.
- Mappings and sync baselines live in versioned plugin state; persist safely through `saveData()`.
- Never guess ambiguous task identity. Mark `needsRepair` and keep remote data intact.
- Use field-level three-way reconciliation; preserve remote fields Freedom Tasks does not own.
- Note deletion must never cause mass remote deletion; line deletion requires relocation grace.
- Use Obsidian semantic CSS variables, accessible touch controls, and Lucide icons. No emoji or hardcoded appearance.
- Use targeted tests for parsing, location, reconciliation, deletion, insertion, and sync integrity.
- Use Serena symbol/reference tools for navigation when available. Reference repositories are read-only.
- V1 synchronizes scheduled tasks only. Undated backlog items are out of scope; do not warn or fabricate dates.
- When a mapped remote item disappears, keep Markdown and preserve a detached tombstone. Reconnect exact UID rather than import duplicates.
- Read COMPATIBILITY.md before changing the FCR integration contract.
