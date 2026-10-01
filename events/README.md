# Event configs

One JSON file per event. Adding an event needs no code if its site uses an existing adapter.

| Field | Meaning |
|---|---|
| `id` | Unique slug, also the sheet tab name and feed filename |
| `active` | `true` = synced on schedule; set `false` once the event is over |
| `adapter` | Parser in `src/adapters/` (e.g. `webflow-finsweet`) |
| `agendaUrl` | Agenda page URL |
| `match` | URL patterns where the Chrome extension runs |
| `pagination.param` | Webflow list page parameter (`<listId>_page`); differs per site/list |
| `timezone` | IANA zone the agenda times are written in |
| `venue` | Appended to calendar event location |
| `sanity` | Refuse to publish if fewer than `minSessions` or a drop larger than `maxDropRatio` |
| `stageAliases` | Optional `{ "raw name": "canonical name" }` |
| `adapterOverrides` | Optional selector overrides if a site's markup differs slightly |
