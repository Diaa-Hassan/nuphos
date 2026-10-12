---
name: mixpanel
description: Query Mixpanel product analytics — saved Insights reports, funnels, retention, event segmentation, user profiles, cohorts and raw event export — through a Mixpanel service account the user's team has bound to Nuphos. Use whenever the user asks about product usage, active users, conversion, retention, what an event contains, or wants numbers from Mixpanel. Nuphos backend hands the agent the service account; the agent calls the Mixpanel Query API directly with curl.
---

# mixpanel

## Session isolation

Keep CLI credentials and settings inside the current session's `HOME` (`NUPHOS_SESSION_HOME`) and respect the supplied CLI config environment variables. Do not copy another session's or the runtime owner's credentials. Without `NUPHOS_SESSION_HOME`, CLI defaults may use shared runtime configuration; be aware of the affected scope.

Changing runtime-global settings is possible, but strongly discouraged unless the user understands the impact on other sessions and explicitly requests it. Explain the shared scope first; do not unset session isolation variables, write to the runtime owner's home, use a shared OS credential store, or modify shared shell startup files as routine setup. This is configuration isolation, not an OS security boundary.

Use this skill when the user wants numbers out of **Mixpanel** — a saved
report, a funnel's conversion, retention, how often an event fires, who a user
is — using the **Mixpanel service account** their team has already bound to
Nuphos.

## Setup

The bound Mixpanel accounts are listed under **Mixpanel accounts:** in the
credential section of the system prompt. Each line carries the `accountId`,
`label`, `username`, `region`, and a ready-to-run `setupCommand`. Pick one and
run its `setupCommand` verbatim:

```bash
bash skills/mixpanel/scripts/setup-credentials.sh <teamId> <accountId>
source ~/.mixpanel/nuphos.env

# Auth is HTTP Basic: service account username + secret. The host depends on
# the project's data residency, so always use $MIXPANEL_API_HOST.
# --fail-with-body makes an HTTP error an *error*: without it curl exits 0 on
# a 401 and the failure looks like success.
mp() {
  # usage: mp <path> [curl args...]
  local path="$1"; shift
  curl -sS --fail-with-body "${MIXPANEL_API_HOST}${path}" \
    -u "$MIXPANEL_USERNAME:$MIXPANEL_SECRET" -H "Accept: application/json" "$@"
}
```

Every shell call is a fresh process, so `source` the env file and redefine
`mp` in each call that needs them.

## Find the project first

Every query needs a `project_id`. The binding does not store one, because a
service account can hold a role on several projects:

```bash
mp /api/app/me | python3 -c '
import json, sys
r = json.load(sys.stdin)["results"]
for pid, p in r.get("projects", {}).items(): print(pid, p.get("name"))'
```

If more than one project is listed and the user did not name one, ask which.
Projects with Data Views also need the view's `workspace_id` as a parameter;
`/api/app/me` lists them under `results.workspaces`.

## Querying

Pass parameters with `-G --data-urlencode` so JSON and expressions are encoded
correctly. Dates are `YYYY-MM-DD` in the project's timezone.

```bash
# What events exist, and the properties of one.
mp /api/query/events/names -G -d project_id=$P -d type=general
mp /api/query/events/properties/top -G -d project_id=$P --data-urlencode 'event=Sign Up'

# Event volume over time (unit: minute|hour|day|week|month; type: general|unique|average).
mp /api/query/events -G -d project_id=$P --data-urlencode 'event=["Sign Up","Purchase"]' \
  -d type=unique -d unit=day -d from_date=2026-01-01 -d to_date=2026-01-31

# One event segmented by a property, with an optional filter.
mp /api/query/segmentation -G -d project_id=$P --data-urlencode 'event=Purchase' \
  -d from_date=2026-01-01 -d to_date=2026-01-31 -d unit=day \
  --data-urlencode 'on=properties["plan"]' --data-urlencode 'where=properties["country"] == "TW"'

# Saved reports: the id is the number after `report-` / `editor-card-id` in the report URL.
mp /api/query/insights -G -d project_id=$P -d bookmark_id=<id>
mp /api/query/funnels/list -G -d project_id=$P
mp /api/query/funnels -G -d project_id=$P -d funnel_id=<id> -d from_date=2026-01-01 -d to_date=2026-01-31
mp /api/query/retention -G -d project_id=$P -d from_date=2026-01-01 -d to_date=2026-01-31 \
  --data-urlencode 'born_event=Sign Up' -d retention_type=birth -d unit=week

# User profiles and cohorts (POST, form-encoded). Page with session_id + page.
mp "/api/query/engage?project_id=$P" --data-urlencode 'where=properties["$email"] == "a@b.co"'
mp "/api/query/cohorts/list?project_id=$P" -X POST
```

Raw events come from the export host, one JSON object per line. It can be
large: always bound it with a narrow date range, an `event` filter and `limit`.

```bash
curl -sS --fail-with-body "${MIXPANEL_DATA_HOST}/api/2.0/export" -G \
  -u "$MIXPANEL_USERNAME:$MIXPANEL_SECRET" -d project_id=$P \
  -d from_date=2026-01-30 -d to_date=2026-01-31 --data-urlencode 'event=["Purchase"]' -d limit=100
```

The full parameter reference is at https://docs.mixpanel.com/reference/query-api.

## Errors

- `401` — the service account was deleted or its secret expired. Ask an admin
  to re-bind the account; do not retry.
- `403` / "not a member of project" — the service account has no role on that
  `project_id`, or the project lives in another data residency than the
  binding's `region`.
- `429` — the Query API allows 60 queries per hour and 5 at once per project.
  Do not loop: wait, and prefer one wider query over many narrow ones.
- A 403 from the setup script means you are outside the binding's allow-list;
  a 404 means the binding was removed.

## Safety

- This skill is for reading analytics. Do not send events, change profiles, or
  delete data, even though a service account with a high role technically can.
- Never print `MIXPANEL_SECRET`, and do not paste it into files in the
  workspace.
- Profiles and raw events carry personal data (emails, IPs, device ids).
  Report aggregates by default; show individual users only when asked.
