# Event record format

`data/events.json` is the permanent store written by the pipeline. Every
listing from every source is normalised into this record, duplicates are
merged, and each event keeps one slug forever.

```json
{
  "slug": "ethglobal-mumbai-2026",
  "type": "hackathon",
  "title": "ETHGlobal Mumbai",
  "organiser": "ETHGlobal",
  "series": "ETHGlobal",
  "sources": [{ "platform": "ethglobal", "sourceId": "527", "url": "https://ethglobal.com/events/mumbai" }],
  "applyUrl": "https://ethglobal.com/events/mumbai",
  "applyPlatform": "ethglobal",
  "startDate": "2026-11-05T00:00:00.000Z",
  "endDate": "2026-11-07T00:00:00.000Z",
  "registrationDeadline": "2026-11-03T18:29:00.000Z",
  "deadlineKind": "registration",
  "timezone": null,
  "mode": "in-person",
  "city": "Mumbai",
  "locationText": null,
  "country": "India",
  "countryCode": "IN",
  "prizeText": null,
  "niches": ["Web3"],
  "eligibilityText": null,
  "eligibility": null,
  "teamSizeText": null,
  "lastCheckedAt": "2026-10-27T05:56:12.000Z",

  "firstSeenAt": "2026-10-27T05:56:12.000Z",
  "status": "upcoming",
  "qualityScore": 60,
  "qualityMissing": ["prize", "description"],
  "indexable": true,
  "description": "...",
  "summary": "...",
  "descriptionStatus": "placeholder",
  "factsHash": "3f1c0a9e5b7d2c41",
  "published": true,
  "publishedAt": "2026-10-27T05:56:12.000Z"
}
```

## Source facts

| Field | Meaning |
| --- | --- |
| `slug` | Permanent URL key: `/hackathons/<slug>/`. Title plus start year, assigned on first sight, never changed. |
| `type` | `hackathon` or `competition`. Kaggle listings, and Unstop's capture the flag, bug bounty and quiz listings, are competitions. Records stored before this field existed are hackathons. |
| `title`, `organiser`, `series` | As the source states them. `series` groups editions for the roll-up page (nullable). When no source states a series, the pipeline sets one for titles that differ only by year or edition marker (`seriesDerived: true`), see `pipeline/lib/series.mjs`. |
| `sources` | Every listing merged into this event: `platform`, `sourceId`, `url`. |
| `applyUrl`, `applyPlatform` | Where to apply, from the highest priority source (seed, Devfolio, Devpost, ETHGlobal, HackerEarth, MLH, Hack Club). |
| `startDate`, `endDate`, `registrationDeadline` | ISO instant when the source states a time, `YYYY-MM-DD` when it only states a day. |
| `deadlineKind` | `registration` or `submission`, matching the source's own wording. Devpost states a submission deadline (you can join until then). |
| `timezone` | IANA zone when the source states one. |
| `mode` | `online`, `in-person` or `hybrid`. |
| `city`, `country`, `countryCode` | Structured place (ISO 3166 alpha-2). |
| `locationText` | Place exactly as the source wrote it when it is not a clean city and country (often a venue name). |
| `prizeText`, `eligibilityText`, `teamSizeText` | As stated by the source. Never reworded. |
| `eligibility` | Filter value: `students`, `open`, `professionals`, `mixed`, or `null` when nothing is stated. |
| `niches` | 1 to 3 of: AI and ML, Web3, Fintech, Health, Climate, Design, Data Science, Hardware, Gaming, Social Impact, Student, Enterprise, Open. |
| `lastCheckedAt` | Last time a source confirmed these facts. |

Stated text gets typographic normalisation only: HTML stripped, entities
decoded, whitespace collapsed, and an em dash replaced by a spaced hyphen.
No words or numbers change.

## Computed by the pipeline

| Field | Meaning |
| --- | --- |
| `status` | `upcoming`, `live` or `ended`, from dates. The site recomputes it at build time. |
| `qualityScore` | 20 points each for dates, deadline, apply link, prize and an approved original description. |
| `indexable` | `qualityScore >= 60`. Pages below are built with `noindex` and left out of the sitemap. |
| `description`, `summary` | Original text. `descriptionStatus` says where it came from: `ai` (passed every check), `reviewed` (approved by a person in `data/reviews.json`), `placeholder` (built from facts because no AI key was set), `review` (AI output failed checks twice). |
| `factsHash` | Hash of the facts and the source's own text. A rewrite runs only when it changes. |
| `published` | `false` only for a never-published event waiting for review. A page that is already live stays live with a flagged placeholder while under review. |

`data/events.json` also holds `redirects`: when two stored pages turn out to
be the same event, the newer slug redirects to the older one.

## Winners (`data/winners.json`)

Written only by the weekly winners pipeline (`npm run winners`), keyed by
event slug. The site attaches it to the event record at build time.

```json
{
  "events": {
    "marina-hacks-6-0-2026": {
      "winnersStatus": "published",
      "winners": [
        { "place": "Best Overall", "project": "Hot Limit", "projectUrl": "https://devpost.com/software/hot-limit", "team": "Mirella Miranda, Cailyn Omuro" }
      ],
      "source": "devpost",
      "sourceUrl": "https://marina-hacks-6-0.devpost.com/project-gallery",
      "endDate": "2026-10-25",
      "firstFoundAt": "2026-10-27T07:40:00.000Z",
      "checkedAt": "2026-10-27T07:40:00.000Z"
    },
    "some-quiet-event-2026": {
      "winnersStatus": "not published",
      "winners": [],
      "checked": ["devpost"],
      "endDate": "2026-10-11",
      "firstCheckedAt": "2026-10-27T07:40:00.000Z",
      "checkedAt": "2026-10-27T07:40:00.000Z"
    }
  }
}
```

| Field | Meaning |
| --- | --- |
| `winnersStatus` | `published` when the platform lists winners; `not published` when it was checked and lists none yet. Events not listed here were not checked (no Devpost or Devfolio source, or ended before winners tracking began). |
| `winners[].place` | The prize or place exactly as stated (Devpost: the prize name on the project page, or "Winner" if none is named; Devfolio: the prize name). |
| `winners[].project`, `projectUrl` | Project name and link exactly as the platform states them. |
| `winners[].team` | Devpost: the "Created by" names, joined with commas. Devfolio: the team name. |

A project that won several prizes appears once per place. Only HTML entities
are decoded and surrounding spaces trimmed; nothing is reworded, and em dashes
in names are kept as published (the site check exempts the winners table).
