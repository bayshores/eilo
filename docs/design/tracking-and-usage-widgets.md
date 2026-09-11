# Tracking and browser usage widgets

Status: local development; not released. Keep IBM Plex Sans, charcoal/peach, direct Home arrangement, and concise frontend instructions. Mobbin informed the visual reference work.

## References inspected

Actual Mobbin images were inspected through its connector:

- [YouTube time watched](https://mobbin.com/screens/de6f2fa5-5f26-419d-a6d3-dddf7aab85a6): a compact seven-day bar chart, with a total and timeframe beside it. Applied as restrained daily bars and one recorded-time total.
- [Twingate status](https://mobbin.com/screens/63275f9d-787b-482d-b12b-e233f3370988): brief status rows with a clear connected indicator. Applied as three source rows in Tracking.
- [Rox integrations](https://mobbin.com/screens/2820d9c1-11bc-4134-9274-87035d73da60) and [Opal Home](https://mobbin.com/screens/30c475b4-40dc-466b-b504-b2ac3ca3bfa2) were also inspected. Their card catalogs, comparisons, and blocking controls were not needed for these widgets.

These patterns informed the design; the app's meaning, colors, content, and permissions remain eïlo's.

## Behavior

**Tracking** reads existing browser, Calendar, and Gmail projections. It distinguishes active sharing, paused/off, waiting, and unavailable status. Calendar's local sync does not imply sharing with answers. Gmail's paused accounts remain visibly paused. No account identifiers appear. Browser hostname detail appears only while the browser source is actively sharing; offline and paused views cannot imply current access. Manage sources opens the existing Connections view.

**Browser usage** shows the past seven UTC calendar days, a total, and up to three site rows. Small widgets keep the top site and the weekly chart. View activity opens the existing observed-record view. Empty widgets show a short Connect Chrome action; they do not invent usage from zero data or from a session's wall-clock span. Progress remains a commitment-progress widget now that browser time has its own place.

Both types are in the widget gallery and inherit drag, resize, remove, Undo, keyboard controls, and persistence. Fresh or exactly untouched Home layouts gain them in the same four-row budget; custom and deliberately empty layouts stay intact. Removed new widgets are not re-added on reload.

## Data and privacy

The ledger owns `observed_activity.usage`, a bounded projection from retained, nontrashed `observed_by_utc_day` buckets. It returns exactly seven days, per-origin totals, and a total. The existing seven-day/128-session retention still applies; figures describe retained recorded activity, not comprehensive device screen time. No additional source permission or sampling is enabled by adding a widget.

Only gaps of at most 12 seconds count. New sampled intervals split correctly at UTC midnight; old buckets are read as stored, without reconstructing intervals. Malformed origins/buckets are skipped and admitted aggregate values cannot exceed each session's recorded total. The browser validates aggregate shape, date order, and matching sums before display. Titles, paths, and history are not added to the usage payload.

## Verification

- Focused ledger checks cover mixed days/sites, empty days, trash, malformed buckets, duration caps, and midnight splitting.
- Selector checks cover separate source permissions, inactive/offline states, arbitrary HTTP(S) origins, aggregate consistency, and no inferred time.
- Layout checks cover the five-widget four-row arrangement, nonoverlap, custom-layout preservation, idempotence, and removal persistence.
- The actual renderer was checked with isolated example data at wide and compact desktop widths, including empty and offline states. Fixture actions do not grant permissions or mutate source data.

The project gate and focused widget checks covered gallery addition, reload persistence, live-refresh registration, and permission/source invalidation. Fixture charts do not establish that Chrome is currently collecting or that a model used that data.

Service refresh must retain durable Home arrangement and must not change source permissions. Verify these behaviors with isolated state; live source status is a separate check.
