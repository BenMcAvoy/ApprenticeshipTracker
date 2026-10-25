# Apprentice Scanner

Apprentice Scanner is a self-hosted tool for finding tech degree apprenticeships.
You keep a list of employers, and it checks each one's careers pages with an AI
agent. It shows which employers have open roles, when they close, and keeps a
record of the evidence behind each result.

For open roles you can upload your CV as a Word file, and the app will write a
tailored version along with a cover letter. You can run scans by hand or let the
app scan every day and send a notification when something opens or is about to
close.

It is built to be run by one person or a small group. Each person signs in with
their own Google account and keeps their own CV and applications. The
administrator manages the shared list of employers, the scans and the ChatGPT
connection. It is not a public job board.

## What you need

- Docker with Docker Compose
- A Google account, for signing in
- A ChatGPT account, which the scanner uses for its AI work
- A Firebase project, which handles Google sign-in (free)

## Setup

### 1. Create a Firebase project

1. Go to the [Firebase console](https://console.firebase.google.com) and create a project.
2. Under **Build > Authentication**, choose **Get started**, then enable the
   **Google** sign-in provider.
3. In the project settings, add a **Web app**. Firebase shows a configuration
   block with `apiKey`, `authDomain`, `projectId` and `appId`. Keep it open.

These values are for the web app, so they are not secret, but they still belong
in your own `.env` file rather than in the code.

### 2. Configure the app

Copy the example settings file and fill it in:

```sh
cp .env.example .env
```

Set the four `FIREBASE_` values from step 1, and set `INITIAL_ADMIN_EMAIL` to the
Google address you will sign in with. That account becomes the administrator on
first start.

Leave `LEGACY_OWNER_EMAIL` blank unless you are moving data from an older
version of the app.

### 3. Start it

```sh
docker compose up -d --build
```

Open <http://localhost:8080> and sign in with Google.

### 4. Connect ChatGPT

As the administrator, open **Settings** and choose **Sign in with ChatGPT**. The
sign-in finishes on a local callback at `http://localhost:1455`, so run the
browser on the same machine as Docker. If Docker runs on another machine, forward
port 1455 to it first.

Scans use your ChatGPT plan's usage limits. A full scan of a long list uses a
lot of them, so you may prefer to scan a few companies at a time.

## Using it

Administrators do the steps marked *(admin)*. Everyone else sees the same list
and can tailor applications to their own CV.

**Adding employers (admin).** Use **Add companies** and either type or paste a
list, one employer per line, or upload a `.txt` or `.csv` file. Names that are
already in the list are skipped.

**Scanning (admin).** **Scan all** checks every employer. The arrow next to it
can scan only the employers that have never been scanned, or re-check results
that could not be verified. Each card also has its own scan button. Progress
appears in the panel at the bottom of the screen.

**Reading a result.** Each card shows the status (open, opening soon, closed,
none found, or couldn't check), the open roles with their closing dates, and an
"Employer details" section with the sources the scanner used. A result of "none
found" is only given when the scanner has read the employer's own vacancy pages,
not just a job board.

**Filtering.** Search by name, role or location. The Filters menu narrows by
status or by closing within two weeks. The Sort menu changes the order.

**Tailoring.** On an open role, choose **Tailor CV**. Upload your CV first in
**Settings** as a `.docx` file (up to 5 MB). The app returns a revised CV with a
list of what it changed, plus a cover letter, and you can download both as Word
files. The draft is checked against your CV so it does not add experience you
don't have, but read it through before you send anything.

**Tracking applications.** Mark a role as applied and it moves out of the main
list into **Applications**, where you can search your history. Use "Undo applied"
to bring it back.

**Daily scans and notifications (admin).** In **Settings**, turn on the daily
scan and choose a time. Notifications go out through [ntfy](https://ntfy.sh). Enter a
topic name that is hard to guess, because anyone who knows it can read the
messages. The app also sends reminders as a closing date gets close.

**Export.** **Export** produces a plain list of employers and their application
links, as text or CSV. It can include only open roles.

## Your data

Everything is stored in a Docker volume called `data`: the SQLite database, your
CV, your settings, the ChatGPT login, and the research trace for each scan. The
volume survives rebuilds and `docker compose down`.

To back it up, copy the volume's contents. To delete everything, run
`docker compose down -v`. That cannot be undone.

Research traces contain the public pages the scanner read and the searches it
ran. They do not contain your CV or your login.

## Configuration

These values can be set in `.env`:

| Variable | Default | Purpose |
| --- | --- | --- |
| `APP_PORT` | `8080` | Port for the web app |
| `TZ` | `Europe/London` | Time zone for the daily scan and reminders |
| `LOG_LEVEL` | `info` | How much the backend logs: `error`, `warn`, `info` or `debug` |
| `SCAN_TRACE_DIR` | `/data/scan-traces` | Where research traces are kept |

## Troubleshooting

- **Sign-in fails with "unauthorized domain".** Add the address you are using to
  the authorised domains under Firebase's Authentication settings. `localhost`
  is allowed by default.
- **ChatGPT sign-in never finishes.** Check that port 1455 is free and that the
  browser is on the Docker machine. See step 4.
- **A scan says "couldn't check".** The employer's site may block automated
  visits, or the page may need JavaScript that did not load. Try the scan again
  later, or add the company's careers page address in its details.
- **Something else.** Run `docker compose logs -f` to see the backend log. Set
  `LOG_LEVEL=debug` in `.env` and restart for more detail.

## Development

You need Node.js 24 and npm.

```sh
npm install
npm run dev     # backend on http://localhost:3000, frontend on http://localhost:5173
npm run build   # type-check the backend, build the frontend
npm test        # run the backend and frontend tests
```

The backend uses Prisma with SQLite. The schema lives in `backend/prisma/`. The
frontend uses React, Vite, TanStack Router and shadcn/ui.

Never commit your `.env`, the `data` volume, or `backend/dev.db`. They are
already listed in `.gitignore`.
