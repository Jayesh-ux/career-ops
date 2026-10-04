#!/bin/bash
# Morning daily-hunt (IST): engine auto-sends up to 3 follow-ups, writes digest.
export PATH=/usr/bin:/bin:/usr/local/bin
cd /root/career-ops
# Live send mode; dry by default? Live is the user's explicit ask —
# AUTO_SEND=1 sends only tracker-thread follow-ups, capped at 3. Flip to 0
# for a no-send review run.
AUTO_SEND_FOLLOWUPS=1 FOLLOWUP_MAX_PER_RUN=3 node cron/daily-hunt.mjs \
  --followups-only --user-dir data/users/hsinghjayesh@gmail.com \
  >> data/users/hsinghjayesh@gmail.com/data/hunt-digests/runs.log 2>&1
