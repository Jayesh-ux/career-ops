// Check Prodigal jobs directly via Greenhouse API
const r = await fetch('https://boards-api.greenhouse.io/v1/boards/prodigal/jobs');
const d = await r.json();
console.log('Prodigal jobs:', d.jobs?.length || 0);
for (const j of (d.jobs || []).slice(0,10)) {
  console.log('  ' + j.title + ' | ' + (j.offices?.[0]?.name || j.location?.name || 'N/A'));
}
