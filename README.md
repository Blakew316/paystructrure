# WPI Careers

A static, dependency-free site where Wholesale Payments agents estimate their pay:
upfront commission, monthly bonuses, ramp-up signing bonuses, statement bonuses,
equipment sales, and a 24-month residual and vesting projection. Ramp-Up and
Standard pay are shown side by side. It also has
a monthly goal planner (deals and appointments needed to hit a dollar goal), a
per-deal statement bonus calculator, and the downloadable career guide PDF.

It installs as a home-screen app called **WPI Careers** (iPhone: Safari → Share →
Add to Home Screen) and works offline after the first visit.

The site blends recruiting and pay into five tabs:

| Tab | What's on it |
|---|---|
| Opportunity | Hero with team photos, highlight stats, Inc. 5000, Earn / Build / Grow, what reps bring merchants, merchant program video |
| Earnings | Ramp-Up vs Standard pay calculator, new-rep signing bonuses, statement bonus calculator |
| Growth | Monthly goal planner, residual projection and vesting |
| Your fit | Support system and company overview video |
| Let's talk | Sales director contact (call, text, email), FAQ, pay rules, career guide, manager note |

Contact details are blank by default. Until a sales director fills in **Your contact info** in
Team setup, the site shows no name, phone or email and refers to "your sales director".

On desktop the tabs sit in the header; on phones they become a bottom tab bar. Each
tab can be linked directly (`…/#earnings`, `…/#talk`); older links such as `#goal`
or `#residuals` still land on the right tab.

Open `index.html` through any static host (or `npm start` locally, then visit
http://localhost:8080).

## Ramp-Up vs Standard

The period toggle at the top switches between the two plans:

| | Ramp-Up (months 1–3) | Standard (month 4+) |
|---|---|---|
| Upfront commission | 2× per deal; second half pays at $5K and 10 transactions | 1× |
| Monthly bonus | Doubled up to 10 deals, paid in two halves; standard tier above that when it pays more | Agreement tiers |
| 30-day Fast Start ($1,000) and 25-deal signing bonus ($15,000) | Shown, and they stack | Hidden |

## Team links (for sales directors)

1. Open the site and click **Team setup**.
2. Fill in **Your contact info** (name, title, phone, email) so the Let's talk tab's
   Call, Text and Email buttons reach you. Optionally set a team name and a note.
3. Click **Copy link** and send it to your agents.

Pay can't be changed per team. Team links and `teams/<slug>.json` files only carry
the team block (name, note, contact); every pay number comes from `js/config.js`,
so a hand-edited link can't alter commission, bonuses or residuals.

For a short, permanent link, commit `teams/<slug>.json` (see `teams/example.json`)
and share `https://<site>/?team=<slug>`.

## Career guide PDF

`guide/career-guide.html` is the print template. To rebuild the PDF:

```sh
npm install
npm run build:guide                         # assets/career-guide.pdf
node scripts/build-guide.js teams/foo.json  # assets/career-guide-foo.pdf, using its "guide" contact
```

Without a team file the guide names no contact. Photos for the Opportunity tab live in
`assets/photos/`.

```sh
```

To point a team's download button at its own guide, set **Team career guide** to
`foo` in Team setup (or `team.guide` in the team file).

## Where the numbers come from

`js/config.js` holds the company plan, sourced from the 2026 Agent Agreement
(Schedule A, Monthly and Fast Start bonuses, Addendum I) and the New Hire
Compensation Package. All pay math is in `js/calc.js`; run `npm test` for its tests.

## Home-screen app

`manifest.webmanifest` and `sw.js` make the site installable. Icons in
`assets/icons/` are built from the logo mark. When you change any cached file
(HTML, CSS, JS, logo), bump `VERSION` in `sw.js` so installed apps pick up the
update on their next launch.

## Hosting

`.github/workflows/pages.yml` runs the tests and deploys to GitHub Pages on every
push to `main`. Turn it on in **Settings → Pages → Source: GitHub Actions**.
GitHub Pages sites are public even when the repo is private, so anyone with the
URL can see the plan.
