# Lead intake format

Gullkornet currently accepts a JSON array of manually researched records. It does not scrape the web or send messages.

## Example

```json
[
  {
    "companyName": "Example Regnskap AS",
    "websiteUrl": "https://example.no",
    "contactEmail": "post@example.no",
    "city": "Oslo",
    "industry": "Regnskapsbyrå",
    "websiteIssue": "WEAK_CONTACT_PATH",
    "opportunity": "Make the enquiry route easier to find.",
    "sourceUrl": "https://example.no",
    "evidence": [
      {
        "sourceUrl": "https://example.no",
        "observation": "The homepage does not show a clearly visible contact or enquiry action."
      }
    ]
  }
]
```

The company above is fictional and exists only to illustrate the format. Do not import example data as a real prospect.

## Supported website issue values

- `NO_WEBSITE`
- `OUTDATED_DESIGN`
- `UNCLEAR_SERVICES`
- `WEAK_CONTACT_PATH`
- `MOBILE_USABILITY`
- `PERFORMANCE`
- `NONE`

Use `NONE` when research finds no concrete opportunity. Such a record will not qualify.

## Required evidence standard

Each evidence item requires:
- An absolute source URL
- A concrete, neutral observation of at least 10 characters

Do not infer company revenue, customer satisfaction, or lost sales from website appearance alone. For performance claims, record the measurement source and result in the observation.

## Import command

```bash
npm run import:leads -- ./path/to/leads.json
```

The default store is `data/leads.json`. Override it with `LEAD_STORE_PATH=/path/to/store.json`.

The importer:
1. Validates each record and rejects unknown fields.
2. Computes a qualification score.
3. Deduplicates against existing records and within the incoming batch by website domain and contact email.
4. Preserves existing records and statuses.
5. Prints a summary and record-level validation errors.

Invalid records are rejected while valid records in the same batch may still be saved. Review the summary and correct any rejected records before re-importing.
