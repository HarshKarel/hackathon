# Seed file format

`data/seed-events.json` holds well known events that publish no feed we can
read (for example NASA Space Apps and Smart India Hackathon). It is edited by
hand and read by the pipeline on every run like any other source, under the
platform name `seed`.

Each entry uses the same field names as the normalised record (see
`docs/RECORD_FORMAT.md`). Fields the pipeline computes are left out: `slug`,
`status`, `qualityScore`, `indexable`, `description`, `summary`,
`descriptionStatus`, `factsHash`.

```json
{
  "format": "hackathon.so seed v1 (see docs/SEED_FORMAT.md)",
  "events": [
    {
      "title": "NASA International Space Apps Challenge 2026",
      "organiser": "NASA",
      "series": "NASA Space Apps Challenge",
      "sources": [
        { "platform": "seed", "sourceId": "nasa-space-apps-2026", "url": "https://www.spaceappschallenge.org/2026/" }
      ],
      "applyUrl": "https://www.spaceappschallenge.org/2026/",
      "startDate": "2026-11-14",
      "endDate": "2026-11-15",
      "registrationDeadline": null,
      "deadlineKind": null,
      "timezone": null,
      "mode": "hybrid",
      "city": null,
      "country": null,
      "prizeText": null,
      "niches": ["Data Science", "Climate", "Open"],
      "eligibilityText": "Open to all ages; ...",
      "eligibility": "open",
      "teamSizeText": "Up to 6 participants per team",
      "lastCheckedAt": "2026-10-27T00:00:00.000Z",
      "notes": "Where the facts came from and when. Never published."
    }
  ]
}
```

## Field rules

| Field | Required | Rule |
| --- | --- | --- |
| `title` | yes | The event's own name, as the organiser writes it. |
| `organiser` | no | Who runs it. |
| `series` | no | Name shared by every edition, for the series roll-up page. |
| `sources` | yes | First entry must be `{ "platform": "seed", "sourceId": "<unique id>", "url": "<official page>" }`. The `sourceId` must never change once published, because it keeps the event on the same permanent page. Add more entries (for example `{ "platform": "devpost", "sourceId": "30790", "url": "..." }`) if the same event is also listed on a platform we read: the dedupe step then merges them by exact source id. |
| `applyUrl` | yes | Where people register. The official page, never a third party. |
| `startDate`, `endDate` | yes | `YYYY-MM-DD` when only the day is known, or a full ISO time with offset (`2026-11-14T09:00:00+05:30`) when the time is stated. Never invent a time. |
| `registrationDeadline` | no | Same date rules. `null` when the organiser states none. |
| `deadlineKind` | no | `registration` or `submission`, matching the organiser's wording. |
| `timezone` | no | IANA name (`Asia/Kolkata`) when the organiser states one. |
| `mode` | yes | `online`, `in-person` or `hybrid`. |
| `city` | no | `null` for online or multi-city events. |
| `country` | no | ISO 3166 alpha-2 code (`IN`) or English name. `null` for worldwide events. |
| `prizeText` | no | The prize exactly as stated. `null` if not stated. |
| `niches` | yes | 1 to 3 values from: AI and ML, Web3, Fintech, Health, Climate, Design, Data Science, Hardware, Gaming, Social Impact, Student, Enterprise, Open. |
| `eligibilityText` | no | Who can take part, as stated. |
| `eligibility` | no | Filter value: `students`, `open`, `professionals` or `mixed`. Derived from `eligibilityText` when left out. |
| `teamSizeText` | no | Team size, as stated. |
| `lastCheckedAt` | yes | When a person last checked these facts against the official page. |
| `notes` | no | Where the facts came from. Kept in the repo, never shown on the site. |

## Editing checklist

1. Copy facts from the official page only. Do not paste the organiser's
   description: the rewrite engine writes the description.
2. Update `lastCheckedAt` whenever you re-check an entry.
3. Run `npm run pipeline` and `npm test`. The pipeline rejects entries that
   break the rules above and logs why in `data/health/latest.json`.
