# Agent Pay Estimator

A static, dependency-free site where Wholesale Payments agents estimate their pay:
upfront commission, monthly bonuses, ramp-up bonuses, statement bonuses, equipment
sales, lead deductions, and a 24-month residual and vesting projection. It also
hosts the downloadable career guide PDF.

Open `index.html` through any static host (or `npm start` locally, then visit
http://localhost:8080).

## Ramp-Up vs Standard

The period toggle at the top switches between the two plans:

| | Ramp-Up (months 1–3) | Standard (month 4+) |
|---|---|---|
| Upfront commission | 2× per deal; second half pays at $5K and 10 transactions | 1× |
| Monthly bonus | Doubled tiers, paid in two halves | Agreement tiers |
| 30-day, 25-deal and 90-day bonuses | Shown | Hidden |

## Team links (for managers)

1. Open the site and click **Team setup**.
2. Change the team name, manager, note, or any pay number. The page updates live.
3. Click **Copy link** and send it to your agents.

Only the values that differ from the company plan are compressed into the link's
`#team=` fragment. Nothing is stored on a server, and the fragment is never sent
to one.

For a short, permanent link, commit `teams/<slug>.json` (see `teams/example.json`)
and share `https://<site>/?team=<slug>`. A `#team=` link on top of it overrides it.

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

## Hosting

`.github/workflows/pages.yml` runs the tests and deploys to GitHub Pages on every
push to `main`. Turn it on in **Settings → Pages → Source: GitHub Actions**.
GitHub Pages sites are public even when the repo is private, so anyone with the
URL can see the plan.
