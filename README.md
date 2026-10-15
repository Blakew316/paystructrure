# Agent Pay Estimator

A static, dependency-free site where Wholesale Payments agents estimate their pay:
upfront commission, monthly bonuses, ramp-up signing bonuses, statement bonuses,
equipment sales, and a 24-month residual and vesting projection. Ramp-Up and
Standard pay are shown side by side. It also has
a monthly goal planner (deals and appointments needed to hit a dollar goal), a
per-deal statement bonus calculator, and the downloadable career guide PDF.

It installs as a home-screen app called **WPI Agent Pay** (iPhone: Safari → Share →
Add to Home Screen) and works offline after the first visit.

Open `index.html` through any static host (or `npm start` locally, then visit
http://localhost:8080).

## Ramp-Up vs Standard

The period toggle at the top switches between the two plans:

| | Ramp-Up (months 1–3) | Standard (month 4+) |
|---|---|---|
| Upfront commission | 2× per deal; second half pays at $5K and 10 transactions | 1× |
| Monthly bonus | Doubled up to 10 deals, paid in two halves; standard tier above that when it pays more | Agreement tiers |
| 30-day Fast Start ($1,000) and 25-deal signing bonus ($15,000) | Shown, and they stack | Hidden |

## Team links (for managers)

1. Open the site and click **Team setup**.
2. Change the team name, manager, note, or any pay number. The page updates live.
3. Click **Copy link** and send it to your agents.

Only the values that differ from the company plan are compressed into the link's
`?t=` parameter, so the plan survives "Add to Home Screen". Nothing is stored on a
server. Older `#team=` links still work.

For a short, permanent link, commit `teams/<slug>.json` (see `teams/example.json`)
and share `https://<site>/?team=<slug>`. A `?t=` link on top of it overrides it.

## Career guide PDF

`guide/career-guide.html` is the print template. To rebuild the PDF:

```sh
npm install
npm run build:guide                         # assets/career-guide.pdf
node scripts/build-guide.js teams/foo.json  # assets/career-guide-foo.pdf, using its "guide" contact
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
