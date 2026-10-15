/**
 * Render guide/career-guide.html to a PDF with the recruiter's contact details.
 *
 *   node scripts/build-guide.js                    -> assets/career-guide.pdf (default contact)
 *   node scripts/build-guide.js teams/lubbock.json -> assets/career-guide-lubbock.pdf
 *
 * The team file's optional "guide" block supplies { name, phone, email }.
 * Needs the `playwright` dev dependency; set CHROMIUM_PATH to use a local browser.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const DEFAULT_CONTACT = { name: 'Cody Malone', phone: '806-300-5599', email: 'cody.malone@wholesalepayments.com' };

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function main() {
  const teamFile = process.argv[2];
  let contact = DEFAULT_CONTACT;
  let out = path.join(ROOT, 'assets', 'career-guide.pdf');
  if (teamFile) {
    const team = JSON.parse(fs.readFileSync(teamFile, 'utf8'));
    contact = Object.assign({}, DEFAULT_CONTACT, team.guide || {});
    out = path.join(ROOT, 'assets', 'career-guide-' + path.basename(teamFile, '.json') + '.pdf');
  }
  const vars = {
    name: contact.name,
    first: contact.name.split(/\s+/)[0],
    phone: contact.phone,
    phoneDigits: contact.phone.replace(/[^\d+]/g, ''),
    email: contact.email
  };
  const tpl = fs.readFileSync(path.join(ROOT, 'guide', 'career-guide.html'), 'utf8');
  const html = tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? esc(vars[k]) : m));
  const tmp = path.join(ROOT, 'guide', '.render.html');
  fs.writeFileSync(tmp, html);

  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  try {
    const page = await browser.newPage();
    await page.goto('file://' + tmp, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({ path: out, format: 'Letter', printBackground: true, preferCSSPageSize: true });
    console.log('Wrote ' + path.relative(ROOT, out));
  } finally {
    await browser.close();
    fs.unlinkSync(tmp);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
