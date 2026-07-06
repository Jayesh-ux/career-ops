#!/usr/bin/env bash
# career-ops — Daily Job Scan and Evaluation Pipeline
# Automates scanning, liveness sweeps, and job evaluations while you sleep.

set -euo pipefail

echo "=== Starting Automated Job Search Cycle ==="

# 1. Run Portal Scan
echo "🔍 Scanning job portals (Greenhouse, Ashby, Lever, Google Jobs)..."
node scan.mjs

# 2. Run Liveness Sweep to remove expired postings
if [ -f "data/pipeline.md" ]; then
    echo "🧹 Pruning expired listings..."
    node check-liveness.mjs --file data/pipeline.md || true
fi

# 3. Process and Evaluate the Remaining JDs
# Since this runs headless while you sleep, it uses gemini-eval.mjs with your GEMINI_API_KEY.
if [ -f "data/pipeline.md" ]; then
    echo "🤖 Evaluating live pending jobs..."
    # Read pending URLs from pipeline.md and evaluate them
    grep -o -E 'https?://[^| ]+' data/pipeline.md | while read -r url; do
        if grep -q "\- \[ \].*$url" data/pipeline.md; then
            echo "→ Evaluating: $url"
            # gemini-eval.mjs will score the job, save the report, and update the tracker.
            node gemini-eval.mjs "$url" || echo "⚠️ Failed to evaluate $url"
        fi
    done
fi

# 4. Reconcile and clean up
echo "🔄 Reconciling pipeline and verifying applications database..."
node reconcile-pipeline.mjs || true
node verify-pipeline.mjs || true

echo "=== Cycle Completed. Check reports/ and data/applications.md for new high scores! ==="
