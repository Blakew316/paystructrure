/**
 * Generate the short team links: team/<slug>/index.html for every team in
 * js/teams.js. Each page forwards to the site with ?team=<slug>, keeping any
 * contact details (?t=...) and tab (#...) from the link it was opened with.
 *
 *   node scripts/build-team-pages.js
 *
 * Run it after adding, renaming or removing a team; tests fail if the pages
 * and js/teams.js disagree.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const TEAMS = require('../js/teams.js');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'team');

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function page(slug, team) {
  const target = '../../?team=' + slug;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(team.name)} · WPI Careers</title>
<noscript><meta http-equiv="refresh" content="0; url=${target}"></noscript>
<script>
  var extra = location.search ? '&' + location.search.slice(1) : '';
  location.replace('${target}' + extra + location.hash);
</script>
</head>
<body>
<p><a href="${target}">Open ${esc(team.name)} on WPI Careers</a></p>
</body>
</html>
`;
}

function build() {
  fs.rmSync(OUT, { recursive: true, force: true });
  for (const [slug, team] of Object.entries(TEAMS)) {
    if (!/^[a-z0-9-]+$/.test(slug)) throw new Error('Bad team slug: ' + slug);
    fs.mkdirSync(path.join(OUT, slug), { recursive: true });
    fs.writeFileSync(path.join(OUT, slug, 'index.html'), page(slug, team));
  }
  return Object.keys(TEAMS);
}

if (require.main === module) console.log('Wrote team pages: ' + build().join(', '));
module.exports = { page };
