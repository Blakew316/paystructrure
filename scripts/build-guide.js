/**
 * Render guide/career-guide.html to assets/career-guide.pdf.
 *
 *   node scripts/build-guide.js
 *
 * The guide names no contact and points readers to their sales director.
 * Needs the `playwright` dev dependency; set CHROMIUM_PATH to use a local browser.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const DEFAULT_CONTACT = { name: '', phone: '', email: '' };

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function main() {
  const contact = DEFAULT_CONTACT;
  const out = path.join(ROOT, 'assets', 'career-guide.pdf');
  const name = contact.name.trim();
  const first = name.split(/\s+/)[0];
  const digits = contact.phone.replace(/[^\d+]/g, '');
  const lines = [];
  if (/^\+?\d{7,15}$/.test(digits)) lines.push(`<a href="tel:${esc(digits)}">${esc(contact.phone)}</a>`);
  if (/^[^\s@<>"']+@[^\s@<>"']+\.[A-Za-z]{2,}$/.test(contact.email)) lines.push(`<a href="mailto:${esc(contact.email)}">${esc(contact.email)}</a>`);
  // Values are escaped here; the template receives finished HTML.
  const vars = {
    byline: esc(name ? name + ' · Wholesale Payments' : 'Wholesale Payments'),
    who: esc(first || 'your sales director'),
    coverName: name ? `<strong>${esc(name)}</strong>` : '',
    cta: `<h3>Talk with ${esc(name || 'your sales director')}.</h3>` + lines.join('')
  };
  const tpl = fs.readFileSync(path.join(ROOT, 'guide', 'career-guide.html'), 'utf8');
  const html = tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
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
