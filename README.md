# Apprenticeship Tracker

A self-hosted apprenticeship vacancy list with application tracking and optional CV tailoring.

The vacancy page queries The Apprentice Guide as filters and pages change. Its defaults are Digital, levels 6–7, salary from £20,000, and a 2027 start date. The app groups roles by employer and shows the source link, location, salary, start date and closing date where provided.

Scanning employer websites and scheduled scans have been removed. The backend uses the logged-in TAG session cookie to request short-lived bearer tokens from TAG, then fetches the selected results from its API. If no session cookie is configured, the app falls back to the saved snapshot in `backend/data/vacancies.json`.

## Run

```sh
docker compose up -d --build
```

The app is available on the configured `APP_PORT` (8080 by default). Sign in with Google from the app. Upload a CV in Settings to enable the optional application tailoring tools; those also require connecting ChatGPT.

To enable live TAG results, set `TAG_SESSION_COOKIE` in the private deployment `.env` file to the TAG `better-auth.session_token` cookie pair, then rebuild the backend. The bearer token is refreshed by the backend and never sent to the browser or written to logs. If TAG rotates the session cookie, the updated value is stored in the private `data` Docker volume. Never commit `.env` or share this cookie.

## Data and privacy

The SQLite database, CVs, account data, saved applications and any refreshed TAG session cookie live in the `data` Docker volume. No TAG bearer token or session cookie is included in the repository or snapshot. The saved vacancy snapshot contains only the public vacancy details returned by the provider API.
