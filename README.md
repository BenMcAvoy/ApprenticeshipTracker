# Apprentice Scanner

See [DEPLOYMENT.md](DEPLOYMENT.md) for the Proxmox server deployment and access details.

## Run with Docker Compose

The app uses Firebase Authentication with Google sign-in. Create a Firebase web
app on the free Spark plan, enable Google under Authentication, and add your app
hostname to Authentication's authorized domains. The database stays in SQLite
on your server.

Create a root `.env` containing the Firebase web-app configuration and the
Google email that should own the existing data:

```dotenv
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_API_KEY=your-public-web-api-key
FIREBASE_AUTH_DOMAIN=your-project-id.firebaseapp.com
FIREBASE_APP_ID=your-web-app-id
INITIAL_ADMIN_EMAIL=your-google-email@example.com
LEGACY_OWNER_EMAIL=your-google-email@example.com
```

The web configuration is public; no service-account private key is needed.
Keep both email values correct before the first account migration. New sign-ups
are members; the first visitor is never automatically made an admin.

With Docker running, start the app from this directory:

```sh
docker compose up -d --build
```

Open <http://localhost:8080>. The frontend serves the app and proxies `/api` to
the backend. Compose waits for the backend's database ping to pass before
starting the frontend.

An administrator can connect ChatGPT from Settings. The sign-in callback uses
`http://localhost:1455`, so use a browser on the Docker host or forward port 1455
when running Docker remotely.

The named `data` volume stores the SQLite database, saved CV, settings, and
ChatGPT login. It survives container rebuilds and `docker compose down`.
The backend creates or updates the database schema on startup; an update that
could lose data will stop startup for manual review.

All app data requires Google sign-in. CVs, tailored applications and applied
listing markers belong to each user and sync through the server. Applied roles
are hidden from Home and saved in Applications in the sidebar. Search that
history or use “Undo applied” to return a current role to Home. Older applied
roles remain in Applications after a vacancy disappears from the catalogue.
Status and closing-date filters live in the Filters dropdown, alongside sorting.
The shared company catalogue, scans, schedule and ChatGPT connection are managed
by administrators. Members can tailor their own applications using that shared
connection.

Upload a Word `.docx` CV in My CV & settings (up to 5 MiB). Uploads save
automatically to your account and replace your current CV only after the file
has been read successfully. The plain-text editor has been removed.

Scans continue researching until an evidence-backed verdict and discovery
coverage pass validation, or the 45-step / eight-minute limit is reached. A
verified open role is retained while the scanner investigates other candidates
and pagination. If coverage remains incomplete, verified roles are shown with
a warning; an investigation with no validated result is “Couldn't check”. It
cannot become “None found” just because a model stopped, a search failed, or a
generic job board returned a large result count.
Quotes are checked against their exact source pages, and promising vacancy
links must be investigated before a negative result can be accepted. Web search
uses bounded Bing, Yahoo and Google fallbacks when results are unusable.

The latest research trace for each company is stored in `/data/scan-traces`
inside the data volume (override with `SCAN_TRACE_DIR`). Traces contain public
research pages, queries and validation events; they do not contain CVs or login
credentials. Each new scan replaces that company's previous trace.

An inconclusive recheck preserves the previous confirmed result, its evidence
and confirmation date. The card shows that availability needs rechecking.
Partial scans retain older roles with a separate “Needs recheck” label. These
unverified roles cannot generate tailored applications or deadline alerts, and
failed verification never sends a closure notification.

Administrators can recheck older negative results from Settings. This finite
batch checkpoints progress in SQLite and resumes after a server restart. It
runs three companies at a time, sends no batch notifications, and reports
confirmed, inconclusive and failed attempts separately.

Startup adds the account tables and copies the legacy CV and generated documents
to `LEGACY_OWNER_EMAIL` once. The source tables remain intact for rollback.

Set `APP_PORT` to change the web port (default `8080`) and `TZ` to change the
scheduler's time zone (default `Europe/London`). These can be set in your shell
or a root `.env` file.

```sh
docker compose ps
docker compose logs -f
docker compose down
```

`docker compose down -v` also deletes the stored data.

## Checks

```sh
npm run build
npm test
```
