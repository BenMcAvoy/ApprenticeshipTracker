# Apprenticeship Tracker

A self-hosted apprenticeship vacancy list with application tracking and optional CV tailoring.

The current catalogue is a snapshot of The Apprentice Guide results for Digital apprenticeships, levels 6–7, salary from £20,000, with a 2027 start date. It contains 51 vacancies from 27 employers. The app groups roles by employer and shows the source link, location, salary, start date and closing date where provided.

Scanning employer websites and scheduled scans have been removed. The API snapshot is stored in `backend/data/vacancies.json` and imported into the app database when the backend starts. A future refresh flow can replace this snapshot once the provider's short-lived authorization can be refreshed automatically.

## Run

```sh
docker compose up -d --build
```

The app is available on the configured `APP_PORT` (8080 by default). Sign in with Google from the app. Upload a CV in Settings to enable the optional application tailoring tools; those also require connecting ChatGPT.

## Data and privacy

The SQLite database, CVs, account data and saved applications live in the `data` Docker volume. The provider authorization token is not included in the repository or snapshot. The vacancy snapshot contains only the public vacancy details returned by the provider API.
