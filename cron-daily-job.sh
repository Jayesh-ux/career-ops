#!/bin/bash
# cron-daily-job.sh — Daily job search cron wrapper
# Called by cron every day at 8:00 AM IST

export PATH="/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:$HOME/.opencode/bin:$PATH"
export NODE_PATH="/usr/lib/node_modules"

cd /root/career-ops || exit 1

echo "[cron] Starting daily job search at $(date)" >> data/cron.log

# Run the daily job search
node daily-job-search.mjs --scan 2>&1 >> data/cron.log

echo "[cron] Daily job search complete at $(date)" >> data/cron.log
echo "---" >> data/cron.log
