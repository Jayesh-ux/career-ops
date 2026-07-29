const r = await fetch('http://127.0.0.1:8787/scan', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({keywords:'',locations:''})
});
const d = await r.json();
console.log('Results:', d.results?.length || 0);
console.log('Other locations:', d.otherLocations?.length || 0);
console.log('Summary:', JSON.stringify(d.summary));
if (d.results?.length > 0) {
  d.results.slice(0,15).forEach(r => console.log('  ' + r.company + ' | ' + r.role + ' | ' + r.location));
}
if (d.otherLocations?.length > 0) {
  console.log('--- Other locations ---');
  d.otherLocations.slice(0,15).forEach(r => console.log('  ' + r.company + ' | ' + r.role + ' | ' + r.location));
}
