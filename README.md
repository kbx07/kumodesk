# KumoDesk

Self-hosted decision desk for end-of-day trading with **Ichimoku Kinko Hyo on daily candles**.
It tells you *what* is worth trading and *how* — it never places orders.

- Scores every instrument from −10 to +10 on D1 and W1 (weekly candles are built from daily ones)
- Currency strength across 28 FX pairs, market regime, risk climate, structure quality, Matrix Score 0–100
- Ranked setups graded A–D with a concrete plan (entry trigger, invalidation, protective stop)
- A nine-stage decision funnel that shows where and why each instrument dropped out, plus session flow (Sydney, Tokyo, London, New York)
- Portfolio risk: manual position log, currency exposure limits, threat board
- **Open-position management every 4 hours** on H4 candles: hold, trail the stop, take partial profit, tighten, reduce or close — in the app and by e-mail
- **Time groups**: instruments that end trading at the same time are analysed together, once a day, right after their close
- Position ticket on the chart, trade history and a capital page with equity curve and statistics
- E-mail reports and alerts over your own SMTP server
- Sign-in with multiple accounts, portfolio and trade sharing, and messages between users
- Interface and e-mails in Polish, German and English (auto-detected from the browser)
- Two views: **Pro** (default, everything) and **Basic** (whether to trade today plus at most three instruments with direction, reason and stop) — switch in the top right corner
- Built-in **How to use** guide in all three languages
- One Node.js process, SQLite file, no build step, port **3003**
- Installs as a Proxmox LXC or as a Docker container

> KumoDesk is an analysis tool, not investment advice. Decisions and risk are yours.

## Install on Proxmox VE

Run on the Proxmox **host** shell (creates a Debian LXC and installs everything):

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/kbx07/kumodesk/main/ct/kumodesk.sh)"
```

The installer asks whether to use **default settings** (1 core, 512 MB RAM, 4 GB disk, DHCP on `vmbr0`, unprivileged) or **advanced settings** (ID, hostname, resources, network, storage, container type), and for an optional root password. Without a root password, open a shell with `pct exec <CTID> -- bash`. Everything can also be preset with environment variables; `ASSUME_YES=1` skips the questions:

```bash
ASSUME_YES=1 CTID=120 CT_RAM=1024 CT_STORAGE=local-zfs CT_IP=192.168.1.50/24 CT_GW=192.168.1.1 \
  bash -c "$(curl -fsSL https://raw.githubusercontent.com/kbx07/kumodesk/main/ct/kumodesk.sh)"
```

Then open `http://<container-ip>:3003` and press **Refresh data**.

Update later from the host:

```bash
pct exec <CTID> -- update
```

Data (settings, candles, positions, history) lives in `/var/lib/kumodesk` and survives updates.

## Install with Docker

```bash
docker run -d --name kumodesk --restart unless-stopped -p 3003:3003 -v kumodesk-data:/data ghcr.io/kbx07/kumodesk:latest
```

Or with Compose, using the `compose.yaml` from this repository:

```bash
curl -fsSLO https://raw.githubusercontent.com/kbx07/kumodesk/main/compose.yaml
```

```bash
docker compose up -d
```

Then open `http://<docker-host>:3003`. All data lives in the `kumodesk-data` volume (`/data` in the container).
The image is built for amd64 and arm64 by GitHub Actions on every push to `main`.

Update:

```bash
docker compose pull && docker compose up -d
```

To build the image yourself instead of pulling it, clone the repository and run `docker compose up -d --build`.

### Any Debian / Ubuntu machine

```bash
curl -fsSL https://raw.githubusercontent.com/kbx07/kumodesk/main/install/kumodesk-install.sh | KUMODESK_REPO=kbx07/kumodesk bash
```

### Run from source

```bash
npm ci
npm start
```

Requires Node.js 22.13 or newer. Environment: `PORT` (3003), `HOST` (0.0.0.0), `DATA_DIR` (`./data`).
Behind an outbound HTTP proxy start with `NODE_USE_ENV_PROXY=1`.

## How the analysis works

### Ichimoku score (per instrument, per timeframe)

| Component | Weight |
|---|---|
| Price above / below the cloud | ±3 |
| Tenkan above / below Kijun | ±2 |
| Chikou above / below price 26 candles ago | ±2 |
| Price above / below Kijun | ±1 |
| Future cloud colour (Senkou A vs B) | ±1 |
| Kijun slope over 5 candles | ±1 |

Sum is −10 … +10. `|score| ≥ 4` gives a direction (LONG / SHORT), otherwise NEUTRAL.
Only **closed** candles are used: a daily candle counts as closed once its time group's end-of-trading time has passed.
The instrument page has two chart views: **Chart used for the analysis** (exactly the closed candles the rating was calculated on) and **Current chart** (the same plus the candle still in progress, drawn as an outline, with freshly downloaded data). The current chart is for viewing only and never changes a rating.

### Market layer

- **Currency strength** – mean signed D1 score of all pairs containing the currency.
- **Symmetry** – CLEAN when the bought currency is strong *and* the sold one is weak across the whole basket, not just on this pair.
- **TF alignment** – W1 and D1 point the same way (FULL), D1 only, or conflict.
- **Regime** – TRENDING / ROTATIONAL / RANGING from the share of strongly trending pairs and the spread of currency strength.
- **Climate** – safe (JPY, CHF, USD) vs core (EUR, GBP) vs carry (AUD, NZD, CAD) baskets, cross-checked with stock indices.
- **Opportunity 0–10** – D1 score, W1 agreement, symmetry, minus a penalty when price is stretched far from Kijun (in ATR).
- **Grade** – A needs everything: opportunity ≥ 8, W1 agreement, price on the right side of the cloud, Chikou confirmation, clean symmetry, not overextended. B ≥ 6.5 without timeframe conflict, C ≥ 5, D otherwise.
- **Matrix Score** – structure quality (35) + trend strength (20) + number of A/B setups (20) + climate (15) + portfolio state (10). ≥ 70 offensive, ≥ 45 selective, below that defensive. A blocked portfolio always forces defensive mode.
- Setups that trade the same currency in the same direction as a better-ranked one are flagged as correlated.

### Decision funnel

Every instrument walks through nine stages, from data to decision. The dashboard shows how many instruments are left after each stage (click a stage to list what dropped out there), and each instrument page shows its own path with the reason for every step.

| # | Stage | Passes when | Drops out when |
|---|---|---|---|
| 01 | Data | enough closed candles | history too short |
| 02 | Sessions | most recent sessions moved in the setup's direction (FX only) | never — caveat only |
| 03 | Climate | direction agrees with risk-on / risk-off | never — but a setup against the climate is capped at grade B |
| 04 | Selection | direction on D1, W1 agrees, price and Chikou clear of the cloud | no direction, or D1 against W1 |
| 05 | Symmetry | FX: bought currency strong and sold one weak. Stocks: same direction as their index (DAX, S&P 500) | weak symmetry — capped at grade C |
| 06 | Synthesis | opportunity ≥ 8 and not overextended | opportunity below 6.5 |
| 07 | Portfolio | no clash with open positions | portfolio blocked by risk limits |
| 08 | Matrix | execution mode allows the grade | defensive mode and grade below A |
| 09 | Decision | TRADE | WATCH or WAIT |

An instrument reaches TRADE exactly when no stage fails.

### Session flow

For currency pairs the app also downloads hourly candles and summarises the most recent Sydney, Tokyo, London and New York sessions: which currency was strongest and weakest, and whether the session was risk-on, risk-off, selective, mixed or quiet. It is context for the daily decision, shown on the dashboard and as stage 02 of the funnel. It costs one extra request per pair and can be switched off in Settings → Ichimoku & scoring.

All periods and thresholds are editable in **Settings → Ichimoku & scoring**.

## Time groups

Markets end their day at different times, so each instrument belongs to a time group (end-of-trading time + time zone + delay).
Every group is fetched and analysed once per day after its close; as many groups, as many analyses. Defaults:

| Group | Close | Zone | Instruments |
|---|---|---|---|
| Asia – Tokyo | 15:30 | Asia/Tokyo | Nikkei 225 |
| Asia – Hong Kong | 16:10 | Asia/Hong_Kong | Hang Seng |
| Europe | 17:35 | Europe/Berlin | DAX, FTSE 100, CAC 40, Euro Stoxx 50, WIG20, the 40 DAX stocks |
| US – stocks & indices | 16:00 | America/New_York | S&P 500, Nasdaq 100, Dow Jones, Russell 2000, the 50 largest S&P 500 stocks |
| New York 17:00 | 17:00 | America/New_York | 28 FX pairs, gold, silver, platinum, palladium, copper |

Add your own groups and instruments (crypto, more stocks, commodities…) in Settings. Daylight saving time is handled by the time zone.

The **Scalable** category ships switched off: about 120 popular instruments available at the broker Scalable Capital (ETFs on Xetra, European and US stocks, cryptocurrencies), each symbol verified against the default data source. It is a selection, not the broker's full universe — thousands of instruments cannot be analysed daily on a free data source. Use **Import a list** to paste your own symbols in bulk. Cryptocurrencies use their own time group that closes the daily candle at midnight UTC, seven days a week.

Instruments are organised in **categories** (currencies, metals, indices, DAX stocks, S&P 500 stocks, or your own). In Settings → Instruments a whole category can be switched on or off with one click.
Single stocks get their own grades and appear in the ranking, but the market-wide figures (structure quality, alignment, Matrix Score) are calculated from currencies, metals and indices only.

## Managing open positions on H4

Trade selection stays on daily candles. Positions you have logged in **Portfolio** are additionally checked every 4 hours (00, 04, 08, 12, 16, 20 UTC plus a short delay) on closed H4 candles:

| Advice | When |
|---|---|
| CLOSE | An H4 candle closed beyond your stop, the daily signal reversed, or H4 is fully against the position and D1 no longer supports it |
| REDUCE | H4 is fully against the position while D1 still supports it |
| TIGHTEN STOP | H4 closed on the wrong side of its Kijun, or the daily signal faded |
| TAKE PARTIAL PROFIT | H4 trend intact but price is stretched far from the H4 Kijun |
| TRAIL STOP | H4 and D1 support the position and it is at least 1R in profit |
| HOLD | H4 and D1 support the position |

Each advice comes with a suggested stop where one makes sense (it only ever moves in your favour). The Portfolio page and the dashboard show the advice, the instrument page has an H4 chart, and an e-mail goes out when the advice changes (or every 4 hours, or never — your choice).
H4 needs a source with intraday data (Yahoo Finance or Twelve Data).

## Logging positions and tracking capital

- **Add to open positions** — the button on every instrument page opens a broker-style ticket: SHORT or LONG, risk in % of capital and a stop (pre-filled behind the D1 Kijun). On save the current price is fetched from the data API and recorded as the entry. It shows the risk amount, an approximate position size and the +1R level. This only adds an entry to the list; the app never sends an order.
- **Close position** — on the Portfolio page. The exit price is suggested from the API and can be corrected to your real fill; you can also type the exact money result from your account. The trade moves to the history.
- **Settings → Capital** — enter your starting capital and currency. The page shows the capital at the start and now, profit and return, average result per trade (money and R), win rate, profit factor, maximum drawdown, an equity curve, a result-per-trade chart, results by instrument, and a table of every trade.

A trade's money result is calculated as capital before the trade × risk % × result in R (compounded), where R is measured from the stop the position was opened with. It ignores spreads, commissions and swaps, so enter the exact amount by hand when you want the history to match your account to the cent.

## Data sources

| Source | Key | Notes |
|---|---|---|
| Yahoo Finance (default) | none | Unofficial API; may change without notice and is rate limited. Requests are spaced out and retried politely. Metals use front-month futures (`GC=F`, `SI=F`…). Two known defects are corrected automatically: daily FX candles whose close equals the open (the close is taken from the next day's open), and instruments without daily history such as WIG20 (daily candles are built from hourly data, up to two years back). |
| Twelve Data | free key | 800 requests/day, 8/minute. Some indices and metals need a paid plan. |
| Stooq | optional | Free CSV downloads; sometimes unavailable to automated clients. |
| EODHD | paid key | Daily candles and live quotes for stocks, currencies, indices and crypto. Symbols in EODHD notation (`EURUSD.FOREX`, `AAPL.US`). Written from the documentation, not tested with a key. |
| Finnhub | free or paid key | Live quotes only, usable as the live price source. Written from the documentation, not tested with a key. |

Choose the default and an optional fallback in **Settings → Market data**; each instrument can override the source and has its own symbol per source.

Note for FX on Yahoo: its daily candle rolls at midnight London time, so at 17:10 New York the current candle still has a few quiet hours left; the final values are picked up on the next run. For cleaner FX candles use Twelve Data as the source for the currency category.

## Notifications

**Settings → Notifications**: SMTP host, port, encryption (STARTTLS / SSL / none), credentials, sender, recipients, and a test button.

**Gmail** does not accept the normal account password. Two ways work:

1. *App password* — press "Set up for Gmail", enter your Gmail address as the username and a 16-character app password (Google account → Security → 2-Step Verification → App passwords).
2. *Sign in with Google (OAuth2)* — create an OAuth client of type "web application" in Google Cloud, add the redirect URI shown in the settings (`https://<your-domain>/api/auth/google/callback`), paste the client ID and secret, then press "Sign in with Google". This needs the app to be reachable under a public HTTPS domain. It was implemented from Google's documentation and not exercised against a real Google account.

Modes: off, alerts only, or a report after every group analysis. Alerts cover new or upgraded setups, lost setups, regime and execution-mode changes, signals turning against your logged positions, and changed H4 advice for open positions.

### In-app notifications

The bell in the top right corner shows the same events that are e-mailed — analysis ready for a market group, new or lost setups, regime and mode changes, changed advice for open positions — with an unread counter. It works without SMTP.

## Two-factor authentication

New accounts must set up a code from an authenticator app (TOTP, e.g. Google Authenticator) right after their first sign-in: scan the QR code, confirm with a code, store the ten recovery codes. Accounts that existed before get a one-time reminder and can turn it on in Settings → General. "Remember this device" skips the code on that browser for 90 days. An administrator can reset a user's second factor in Settings → Users; from the command line add `--reset-2fa` to the password reset command below.

## Logs

Settings → Logs lists events with a type filter: sign-ins, positions, system runs, data errors, notifications and settings changes. Users see their own entries; administrators see everything and can filter by user and export CSV.

## Signal tracking and algorithm accuracy

Every TRADE decision is tracked as if entered at the close of its candle with the plan's stop, until the stop is hit (−1R) or the direction fades or reverses. The instrument table shows the "green light" date and the result since then; the Portfolio page shows how often the algorithm was right, by grade, with the latest finished signals. On first start the last year is replayed in the background (about a minute). Treat the numbers as a sanity check of the rules, not as a promise: they ignore spreads and commissions.

## Themes and appearance

Every user chooses their own look in Settings → General: the theme – **Normal** (with a choice of app background), **Anime** (two side figures and drifting petals, sparks, flowers and short Japanese and Korean words) or **Custom** (the Anime look with your own pictures, ideally PNG with a transparent background, standing exactly where the two figures are) – and an **accent colour** from a palette that drives buttons, highlights and the theme's glow. The sign-in screen is the same for everyone and always plain; an administrator picks only its background.

## Group chat, attachments and push notifications

- **Groups** — administrators create chat groups and choose their members (Messages → New group).
- **Attachments** — any file up to 5 MB; images open in a preview window, other files download. Only participants of the conversation can open a file.
- **Push notifications** — off by default; each user turns them on per device in Settings → General and the browser asks for permission. They carry the same events as the bell plus new messages. Push needs the app to be opened over **HTTPS** (browsers refuse it on plain HTTP); the app can also be installed from the browser as a standalone window.

## Live prices for open positions

Open positions show the current price and running result, refreshed every 20 seconds by default (Settings → Market data). The source can be the normal data source or a separate live source. Trade selection always stays on closed daily candles.

## Accounts, sharing and messages

On the first launch the app shows a form to create the **administrator account**; from then on everyone signs in with a username and password.

- **Light / dark** — every user switches between automatic, light and dark in the profile menu (top right) or in Settings → General; the choice is remembered per device.
- **Updates** — Settings → General shows the installed and the latest version. On the Proxmox / Debian install an administrator can update with one click (the app downloads the new code and restarts); for Docker the page shows the command to run on the host.
- **Stage times** — the "path through the funnel" on an instrument page shows on the right when each stage last changed its result (the time of the analysis that noticed it). Until a stage changes for the first time it reads "at least since".
- **Dashboard** — next to the primary target the dashboard lists your open positions with the H4 advice and running result. The instrument table at the bottom shows by default only what qualified to trade after the last session; a period filter widens it to the last 7 days, month, quarter, six months, year, or all instruments. The signal date in the table is the candle on which the recommendation last turned into "trade".
- **Signal arrows** — the daily chart marks with a small arrow every time the recommendation turned into "trade" (or changed direction), on the entry candle (the one after the signal candle): green pointing up for long, red pointing down for short. Hovering the candle shows the direction and grade. The history covers the past year.
- **Instrument picker** — on an instrument page the name is a list of your instruments, grouped by category, to jump straight to another chart. Below "passed all stages" the funnel path shows since when.
- **Own instruments** — Settings → Instruments is open to every user: each person switches instruments and whole categories on and off for themselves and may add new ones (new entries are off for everybody else; only their creator or an administrator can edit or delete them). The dashboard, alerts, history and e-mail reports are calculated from the user's own set; data is downloaded once for everything that at least one user has switched on.
- **Super administrator** — the first account (the one that set the server up). Only it sees Market data, Notifications, Updates and Logs, and no other administrator can change its role, password or delete it. Other administrators manage users, time groups and scoring; regular users see only their own General, Capital, Instruments and Risk tabs.
- **Presence** — the user list shows a green dot next to everyone who is using the app right now, with the browser and system of their device, or the time they were last seen.
- **Invitations** — when adding a user an administrator either types a password or, once SMTP is configured, sends an invitation by e-mail. The link (valid for 7 days, single use) opens a page where the person checks the username, enters their e-mail address and chooses a password; after saving they sign in on the start page. A pending invitation can be resent from the user list.
- **Sign-in** — step one asks for the username or e-mail address and the password; step two asks for the authenticator code, or sets the authenticator up at the first sign-in.
- **E-mail language** — every user gets e-mails in the language of their own interface; addresses without an account use the default e-mail language from Settings → General.
- **Roles** — administrators manage accounts (Settings → Users) and server settings (data sources, instruments, time groups, SMTP, appearance); there can be several. Users use the analysis and keep their own portfolio.
- **Per-account data** — open positions, trade history, capital, risk limits, position notifications and messages belong to the account. The market analysis is shared. Data from before accounts existed is handed to the first administrator.
- **Share a portfolio** — on the Portfolio page tick "Share my portfolio" and pick people; they get a read-only view of your positions, results and trades.
- **Share a single trade** — the share icon at the end of each trade row (Settings → Capital) sends the trade card with an optional message.
- **Messages** — the envelope next to the bell opens conversations between users, with an unread counter.
- **Appearance** — administrators choose the sign-in screen background and the app background in Settings → General.
- **E-mail** — H4 position mails go to the account's own e-mail address (an administrator without one falls back to the general recipients). Group reports go to the general recipients from the SMTP settings.

### Forgotten password

An administrator can set a new password for anyone in Settings → Users. If no administrator can sign in, reset it on the server.

Docker:

```bash
docker exec kumodesk node server/reset-password.js <username> <new-password>
```

Proxmox (on the host):

```bash
pct exec <CTID> -- runuser -u kumodesk -- env DATA_DIR=/var/lib/kumodesk node /opt/kumodesk/server/reset-password.js <username> <new-password>
```

## Security

- Passwords are stored as salted scrypt hashes; sessions live in an HttpOnly, SameSite cookie for 30 days and are revoked on password change.
- Every API route except sign-in requires a session; server settings and user management require the administrator role.
- After 8 failed sign-in attempts for a username from one address, further attempts are refused for 5 minutes.
- The app speaks plain HTTP. On a trusted LAN that is usually fine; anywhere else put it behind a reverse proxy with HTTPS (the session cookie is marked `Secure` when the proxy sends `X-Forwarded-Proto: https`).
- The SMTP password and API keys are stored in the SQLite database in `DATA_DIR`; protect that directory and its backups.

## Development

```bash
npm test
```

Runs unit tests for the Ichimoku engine, market analysis, scheduling across time zones and translation completeness.

## License

MIT
