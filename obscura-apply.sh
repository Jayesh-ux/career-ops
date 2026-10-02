#!/bin/bash
# obscura-apply.sh — Full Greenhouse apply via obscura fetch
# Usage: ./obscura-apply.sh <job_url> [resume_path] [--dry-run]

JOB_URL="${1:-https://job-boards.eu.greenhouse.io/groww/jobs/4714061101#app}"
RESUME="${2:-/sdcard/jobapply/Jayesh_Singh_Latest.pdf}"
DRY_RUN="${3}"

RESUME_B64=$(base64 -w0 "$RESUME")
RESUME_SIZE=$(du -h "$RESUME" | cut -f1)

echo "=== Obscura Apply ==="
echo "Job: $JOB_URL"
echo "Resume: $RESUME ($RESUME_SIZE)"
echo "Mode: ${DRY_RUN:-LIVE}"
echo ""

# Write the JS eval to a temp file (avoid shell escaping entirely)
EVAL_FILE=$(mktemp /tmp/obscura-eval-XXXXX.js)
cat > "$EVAL_FILE" << JSEOF
(() => {
  var profile = {
    firstName: 'Jayesh',
    lastName: 'Singh',
    email: 'hsinghjayesh@gmail.com',
    phone: '+917821816193',
    location: 'Mumbai, Maharashtra, India',
    linkedin: 'https://linkedin.com/in/jayesh-singh',
    github: 'https://github.com/Jayesh-ux'
  };

  // Fill helper
  var set = function(id, val) {
    var el = document.getElementById(id);
    if (!el) return false;
    var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, val);
    el.dispatchEvent(new Event('input', {bubbles:true}));
    el.dispatchEvent(new Event('change', {bubbles:true}));
    return true;
  };

  // Fill all fields
  set('first_name', profile.firstName);
  set('last_name', profile.lastName);
  set('email', profile.email);
  set('phone', profile.phone);
  set('candidate-location', profile.location);
  set('question_7783092101', profile.linkedin);
  set('question_7783093101', profile.github);
  set('question_8252988101', profile.linkedin);
  set('question_8256074101', 'Qyuki Digital Media');
  set('question_8256081101', 'Full Stack Developer intern building production apps with React, Node.js, Spring Boot, PostgreSQL.');
  set('question_8256082101', '1');

  // Upload resume via DataTransfer (may fail in headless)
  var resumeResult = 'skipped';
  try {
    var b64 = '${RESUME_B64}';
    var bin = atob(b64);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    var file = new File([arr], 'Jayesh_Singh_Resume.pdf', {type:'application/pdf'});
    var dt = new DataTransfer();
    dt.items.add(file);
    var inp = document.getElementById('resume');
    if (inp) {
      inp.files = dt.files;
      inp.dispatchEvent(new Event('change', {bubbles:true}));
      resumeResult = inp.files.length + ' file(s): ' + inp.files[0].name;
    } else {
      resumeResult = 'NO INPUT';
    }
  } catch(e) {
    resumeResult = 'FAILED: ' + e.message;
  }

  // Build result
  var result = {
    resume: resumeResult,
    first_name: document.getElementById('first_name').value,
    last_name: document.getElementById('last_name').value,
    email: document.getElementById('email').value,
    phone: document.getElementById('phone').value,
    submit: document.querySelector('button[type=submit]').textContent.trim()
  };
JSEOF

if [ "$DRY_RUN" = "--dry-run" ]; then
  echo "  result.dryRun = true;" >> "$EVAL_FILE"
else
  echo "  document.querySelector('button[type=submit]').click();" >> "$EVAL_FILE"
  echo "  result.submitted = true;" >> "$EVAL_FILE"
fi

cat >> "$EVAL_FILE" << 'JSEOF'

  return JSON.stringify(result);
})()
JSEOF

# Run obscura with the eval file
RESULT=$(obscura fetch "$JOB_URL" --stealth --timeout 40 --eval "$(cat "$EVAL_FILE")" -q 2>&1)
rm -f "$EVAL_FILE"

if [ -n "$RESULT" ] && [ "$RESULT" != "null" ]; then
  echo "Result: $RESULT"
else
  echo "Page navigated (submit likely worked)"
  [ "$DRY_RUN" = "--dry-run" ] && echo "NOT submitted (dry run)"
fi

echo ""
echo "=== Done ==="
