#!/usr/bin/env bash
# Starts one Lite timetable event (see src/lite/clock.ts) and confirms that GitHub created the run.
#   scripts/lite-clock-fire.sh <action> <event-iso>
# Skips the event when its workflow already has a run created since the event's time (an on-time
# dispatch, an earlier clock run or a manual start), so a late or duplicate clock run never starts
# the same event twice. Needs GH_TOKEN with actions: write; holds no secret values
set -euo pipefail
action="$1"; at="$2"
case "$action" in
  outreach|reserve) wf=lite-outreach.yml
    args=(-f preview=false -f pilot_send=false -f preview_limit=95 -f preview_record_ids= -f one_off_date=) ;;
  report) wf=lite-daily-report.yml; args=(-f date=) ;;
  readiness) wf=lite-readiness.yml; args=(-f limit=150 -f min_eligible=115) ;;
  intake) wf=lite-lead-intake.yml
    args=(-f source=auto -f sync_to_airtable=true -f limit=400 -f pages=20 -f start_page=0 -f website_cap=150
          -f municipalities= -f industries= -f buffer_target=1400) ;;
  *) echo "Unknown action $action"; exit 1 ;;
esac
since=$(date -u -d "@$(( $(date -u -d "$at" +%s) - 300 ))" +%FT%TZ)
runs_since() { gh run list --workflow "$wf" --limit 30 --json databaseId,createdAt,url,status \
  --jq "[.[] | select(.createdAt >= \"$1\")] | sort_by(.createdAt) | .[0] | select(. != null) | \"\(.url) \(.status) created=\(.createdAt)\""; }
existing=$(runs_since "$since")
if [ -n "$existing" ]; then echo "Planned $action at $at: already started, not dispatched again: $existing"; exit 0; fi
before=$(date -u +%FT%TZ)
gh workflow run "$wf" --ref main "${args[@]}"
if [ "$action" = report ]; then gh workflow run lite-readiness.yml --ref main -f limit=150 -f min_eligible=115; fi
echo "Planned $action at $at: dispatched $wf at $before"
for _ in $(seq 1 12); do
  sleep 5
  created=$(runs_since "$before")
  if [ -n "$created" ]; then echo "Confirmed: GitHub created the run: $created"; exit 0; fi
done
echo "Dispatch accepted but no run visible after 60 s (GitHub may be delayed)."; exit 1
