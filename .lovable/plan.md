## Scope
Workforce Dispatch module only. Auth, DWM, Quantify AI, navigation, roles — untouched.

## Database changes (single migration)

1. **`workers` table** — extend trade enum to UI dropdown values `ACMV | PLUMBING | MT | ELECTRICAL` (kept as free text column, validated at form level). No SQL constraint change needed.
2. **`drivers` table** — add `current_vehicle_id uuid references vehicles(id)` (nullable). Driver can set this for the day.
3. **New `deployment_templates`** — recurring template definitions.
   - fields: `id`, `name`, `project_id`, `trade_manager_id`, `reporting_time`, `return_time`, `remarks`, `recurrence` (`daily` | `weekdays` | `weekly`), `weekday_mask` (smallint, bitmask Sun=1..Sat=64, used when recurrence=weekly), `start_date`, `end_date` nullable, `is_active`, timestamps.
4. **New `deployment_template_workers`** — `template_id`, `worker_id` (composite PK).
5. **`deployments`** — add `template_id uuid null references deployment_templates(id)` and `source text default 'manual'` (`manual` | `template`). Add unique partial index on (`template_id`, `deployment_date`) where `template_id is not null` to prevent duplicate generation.
6. **New `dispatches`** — groups trips into a publishable plan for a date.
   - fields: `id`, `dispatch_date`, `status` (`draft` | `published` | `completed`), `created_by`, `published_at`, `published_by`, `notes`, timestamps.
7. **`trips`** — add `dispatch_id uuid null references dispatches(id) on delete set null`. Existing trips with null dispatch_id remain valid (legacy).
8. **Trigger**: when a `deployments` row is updated (workers, time, project, date) OR a `deployment_workers` row is inserted/deleted, find the dispatch covering its date through linked trips and set `dispatches.status = 'draft'` if it was `published`. Implemented via two AFTER triggers calling a shared `revert_dispatch_to_draft(dep_id)` function.
9. **Daily template generator** — `generate_deployments_from_templates(target_date date)` SECURITY DEFINER function. Inserts deployments + deployment_workers for every active template matching the date's recurrence pattern, idempotent via the unique index. Scheduled via `pg_cron` daily at 00:05 SGT; also invokable from the Templates tab via a "Generate now" server fn for the next 14 days.
10. **RLS + GRANTs** for every new table — trade_manager/admin own templates; hub/admin own dispatches; authenticated SELECT for visibility (mirrors existing module patterns).

## UI changes — `src/routes/_authenticated/workforce.tsx`

Replace tabs with role-aware set:

- **Workforce list** (TM + Hub + Admin) — single page replacing Workers + Fleet "Drivers" sub-list. Tabs/segment inside: `Workers` and `Drivers`. Trade column uses the 4-value dropdown for workers; drivers just have name + phone + active.
- **Deployments** (TM + Hub + Admin) — unchanged shape, but worker assignment dropdown filters `active_status = true` and trade ∈ 4 values. Edits trigger the revert-to-draft via DB trigger (no UI work).
- **Templates** (TM + Hub + Admin) — new tab. CRUD recurring templates, toggle active, "Generate next 14 days" button.
- **Dispatch Board** (Hub + Admin) — rewritten around `dispatches`:
  - Top section: **AI Suggestions** for the selected date. Pure client-side grouping: cluster pending deployments by (a) project location text similarity / shared keywords and (b) reporting_time within ±30 min. Each suggestion card shows grouped sites, workers, suggested departure (earliest reporting_time − 30 min), and "Accept → add to draft dispatch".
  - Middle: **Draft dispatch** for date — list of trips with editable driver, departure time, optional vehicle. "Publish" button sets status=published.
  - Bottom: **Published & Completed** dispatches (read-only summary).
- **Driver** (Driver + Admin) — shows only **published** dispatches assigned to the signed-in driver. Adds a "My vehicle today" selector (writes `drivers.current_vehicle_id`). Trip status buttons: Departed → Arrived → Completed.
- **My Schedule** (Worker + Admin) — Today's Transport card only: Pickup Time, Driver, Vehicle, Destination, Status. Sourced only from trips whose dispatch is `published`.

Remove the standalone Fleet tab's driver sub-table (merged into Workforce list). Vehicles management stays in Fleet for Hub.

## AI suggestion logic (client-side, deterministic)

```text
input: deployments for date with status in {pending, assigned} and no trip yet
1. group by normalized project location (lowercase, strip punctuation, split tokens; cluster by shared token set ≥1 of {bugis, orchard, jurong, ...} via Jaccard ≥ 0.34)
2. within each location cluster, sub-group deployments whose reporting_time is within 30 min of each other
3. for each sub-group emit a suggestion: union of workers, earliest reporting_time minus 30 min as departure, all site names listed
4. sort suggestions by total worker count desc
```

No vehicle assignment in the suggestion (vehicle is secondary; driver picks at dispatch publish or day-of).

## Cascade rule (Published → Draft)

Handled by DB triggers (see #8 above). UI surfaces a toast in Dispatch Board when a dispatch row flips from published → draft on realtime refresh.

## Out of scope
Auth, DWM, Quantify AI, admin user mgmt, navigation, roles table.

## Open question
Do you want the AI suggestion grouping to live in the DB (a SQL function), or client-side in the Dispatch Board component? Default in this plan: **client-side**, since it's deterministic and easy to tweak. Confirm or override.
