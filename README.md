# Fuel tracker («Бак»)

A self-hosted car log as an installable web app (PWA). It is a lightweight replacement for apps like Fuelio, for one car.

**Fuel**
- Fill-up log.
- Real consumption in l/100 km, calculated "full tank to full tank".
- Cost per kilometre.
- Charts with comparison to the previous period.

**Costs**
- Car expenses by category: service, repairs, insurance, washes…
- A WOG fuel-wallet balance with top-ups.

**Service**
- Reminders by distance and/or time. The current mileage is estimated from your driving pace.
- Each reminder is linked to the record that closed it.
- An insurance-policy expiry reminder.

**Tyres**
- Tyre sets, tread measurements and wear forecast.
- DOT age.
- Seasonal change hints, based on the weather forecast and the +7 °C rule.

**Other features**
- Car passport: engine, gearbox, VIN, oil, tyre sizes and pressures.
- **Integrations, all optional:** Home Assistant, the companion [Family Budget](#family-budget-sync) app, and [cmintey/wishlist](https://github.com/cmintey/wishlist).

About the code:
- **Zero dependencies.** Node.js 22.13+ and its built-in SQLite (`node:sqlite`). There is no `npm install`.
- **Interface language: Ukrainian (default) or English.** Switch it under **«Ще → Мова / Language»**; the setting is global, applies to the whole interface and to server-generated texts, and the login page follows the last language used on the device. Home Assistant hook texts and push notifications stay Ukrainian.
- **Prices and exchange rates are Ukraine-specific.** Prices come from WOG, OKKO and Minfin; exchange rates come from the National Bank of Ukraine. Elsewhere, set `PRICES=0` and enter prices manually.

## Requirements

- Docker with Docker Compose v2.24+ (recommended), **or** Node.js 22.13+.
- A reverse proxy with HTTPS if the app should be reachable from a phone (Caddy, Traefik, nginx, Cloudflare Tunnel…). The container only listens on `127.0.0.1`.

## Install with Docker

```sh
git clone https://github.com/kyrylohn/fuel-tracker.git
cd fuel-tracker
cp .env.example .env && chmod 600 .env    # optional, every setting has a default
TZ=Europe/Kyiv docker compose up -d --build
curl -s http://127.0.0.1:3050/healthz
```

### Create users

There is no sign-up page. Create users from the command line:

```sh
docker exec fuel fuel user add olena "Олена"          # prints a generated password once
echo 'my-long-password' | docker exec -i fuel fuel user passwd olena --stdin
docker exec fuel fuel user list
docker exec fuel fuel user del olena
```

### First start

Log in and add your first fill-up. To bring in history from Fuelio, open **«Ще → Імпорт з Fuelio»** and choose the CSV backup (`vehicle-N-sync.csv`). Columns are matched by name, and re-importing skips existing records.

Under **«Ще»**, also set:
- the interface language (**Мова / Language**: Українська or English);
- the fuel type;
- the car passport.

## Reverse proxy and HTTPS

Caddy example:

```caddyfile
fuel.example.com {
    reverse_proxy 127.0.0.1:3050
}
```

If the proxy runs in another container, attach `fuel` to the proxy network in `compose.override.yml` and proxy to `fuel:8080`:

```yaml
# compose.override.yml (merged automatically, ignored by git)
services:
  fuel:
    networks: [default, proxy]
networks:
  proxy:
    external: true
```

`X-Forwarded-For` is trusted only from `TRUSTED_PROXY_HOSTS` (default `caddy`) and `TRUSTED_PROXIES` (IPs). The `Secure` cookie flag is set behind HTTPS (`X-Forwarded-Proto: https`) or always with `COOKIE_SECURE=1`.

## Install without Docker

```sh
npm test                                         # optional
DATA_DIR=./data PORT=8080 npm start
node --disable-warning=ExperimentalWarning server/cli.js user add olena "Олена"
```

## Configuration

Every setting is an environment variable, and all are optional (see [`.env.example`](.env.example)). In-app settings (location, fuel type, budget accounts…) live in the database.

| Variable | Default | Purpose |
|---|---|---|
| `TZ` | `UTC` | Time zone for dates |
| `FUEL_PORT` | `3050` | Host port (Docker), bound to `127.0.0.1` |
| `PORT`, `DATA_DIR` | `8080`, `./data` | Server settings (set in the Docker image) |
| `SESSION_DAYS` | `90` | Days of inactivity before logout |
| `COOKIE_SECURE` | unset | `1` forces the `Secure` cookie flag |
| `TRUSTED_PROXY_HOSTS` / `TRUSTED_PROXIES` | `caddy` / unset | Reverse proxies allowed to set `X-Forwarded-For` |
| `PRICES` | on | `0` disables background calls to price and weather services |
| `HOME_LAT`, `HOME_LNG` | `50.450`, `30.523` (Kyiv) | Home location for nearby fuel prices and the weather forecast |
| `PRICE_REGION` | `kievskaya` | Minfin region slug (`index.minfin.com.ua/ua/markets/fuel/reg/<slug>/`) |
| `FUEL_HOOK_TOKEN` | unset | Enables the Home Assistant hooks |
| `BUDGET_URL`, `BUDGET_HOOK_TX_TOKEN` | `http://budget:8080`, unset | Family Budget sync |
| `WISHLIST_URL`, `WISHLIST_LIST`, `WISHLIST_PUBLIC`, `WISHLIST_BOT` | unset | Wishlist block (hidden when unset); `WISHLIST_BOT` is an optional Telegram bot name shown as a hint |

Tokens must be at least 32 characters (`openssl rand -hex 32`). Without a token, a hook answers 404.

## Home Assistant

All hooks take `Authorization: Bearer <FUEL_HOOK_TOKEN>`.

| Hook | Purpose |
|---|---|
| `GET /api/hook/summary` | Stats for sensors: average consumption, monthly fuel spend, cost per km, mileage, drafts, service reminders (`service_text`, `service_link`…) |
| `POST /api/hook/notify` `{"title","text","package","when"}` | Phone notification text. A WOG payment notification becomes a **draft fill-up**; wallet top-ups and car washes are recognised too. The response has a `message` you can send back to the phone |
| `POST /api/hook/odo` `{"odo":145189,"id":"…","full":true}` | Adds the odometer reading to a draft (without `id`: the newest draft) and returns its consumption |

Typical flow:
1. The HA Companion app's *Last notification* sensor catches the WOG push.
2. An automation posts it to `/api/hook/notify`.
3. HA sends an actionable notification with a text field for the odometer.
4. The reply goes to `/api/hook/odo`.

Minimal sensor example:

```yaml
rest:
  - resource: https://fuel.example.com/api/hook/summary
    headers:
      Authorization: !secret fuel_hook_bearer   # "Bearer <token>"
    scan_interval: 900
    sensor:
      - name: Fuel average consumption
        value_template: "{{ value_json.avg_cons }}"
        unit_of_measurement: "l/100 km"
```

Field names are in the `/api/hook/summary` response.

## Family Budget sync

With the companion family-budget app, every fill-up and car expense becomes an expense in the budget, with ids `fuel-f-…` / `fuel-c-…`. Edits and deletions sync too. If the budget is unreachable, changes wait in an outbox and are retried every 5 minutes.

1. Set the same random token as `BUDGET_HOOK_TX_TOKEN` in both apps. Set `BUDGET_URL` here, and `BUDGET_HOOK_TX_USER=<login>` in the budget.
2. In the app, open **«Ще → Сімейний бюджет»**, choose the account and categories, and turn the sync on.

> Turning the sync on queues the **whole** history. If past expenses are already in the budget, they will be duplicated, so start with an empty history or clean up afterwards.

## Backups

- **Consistent SQLite copy:** `docker exec fuel fuel backup /data/fuel-backup.sqlite`, then `docker cp fuel:/data/fuel-backup.sqlite .`.
- **JSON copy:** in the app, **«Ще → Копія JSON»**.

**Restore** a SQLite copy:

```sh
docker compose stop fuel
docker run --rm -v fuel_data:/v -v "$PWD":/b alpine sh -c \
  'cp /b/fuel-backup.sqlite /v/fuel.sqlite && rm -f /v/fuel.sqlite-wal /v/fuel.sqlite-shm && chown 1000:1000 /v/fuel.sqlite'
docker compose start fuel
```

The volume is named `<project>_data` (for example `fuel-tracker_data`); check it with `docker volume ls`.

## Updating

```sh
git pull && docker compose up -d --build
```

Migrations run automatically on start.

## Security

- The port is published on `127.0.0.1` only. The container runs as `node` with a read-only root filesystem, `cap_drop: ALL` and `no-new-privileges`.
- Passwords are stored as scrypt hashes, and login is blocked after 8 failed attempts.
- Writes require the `X-Fuel` header, cookies are `HttpOnly; SameSite=Strict`, and CSP is `default-src 'self'`.

## Project layout

```
server/
  server.js   HTTP server, login, API, Home Assistant hooks
  db.js       schema and migrations, fills, costs, reminders, budget outbox, users, sessions
  service.js  service reminders, tyres, season (Open-Meteo)
  prices.js   fuel prices (WOG, OKKO, Minfin)    fx.js  NBU exchange rates
  budget.js   background sync to Family Budget    wog.js  WOG notification parser
  fuelio.js   Fuelio CSV import                   wishlist.js  cmintey/wishlist reader
  cli.js      admin commands
public/       UI (app.js; calc.js has calculations shared with the server), service worker, icons
test/         npm test (node:test)
```

## License

MIT, see [LICENSE](LICENSE). The bundled Onest font is under the SIL Open Font License (`public/fonts/OFL.txt`).
