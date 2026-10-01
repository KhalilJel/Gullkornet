# Lead intake format

Gullkornet accepts a JSON array of candidate or researched business records. The registry discovery command can generate a candidate list, but it does not evaluate websites or send messages.

## Example

```json
[
  {
    "organizationNumber": "999888777",
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

The company and organization number above are fictional and exist only to illustrate the format. Do not import example data as a real prospect.

Registry discovery records can omit website issue and evidence. They will remain NEW until the website opportunity has been researched.

## Digital-presence opportunity principle

Record the observed need before choosing a service. The possible Cidea solution may be a website, branding, social media setup, or a combination. Do not use a generic recommendation such as "needs a better digital presence" without a concrete observation and source.

For each opportunity, distinguish:
- **Observation:** what was actually visible on a public source.
- **Potential implication:** why the observation might matter to a visitor or prospective customer, phrased cautiously.
- **Possible solution:** a hypothesis to validate with the business, not a conclusion or promise of results.

Do not infer lost sales, poor reputation, or business performance from appearance alone. Outreach is an interest opener, not a pitch; Khalil handles sales conversations.

The current automated pilot supports website research only. Branding and social-media assessment require additional evidence collection and review before they can be used for automated qualification or outreach.

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
3. Deduplicates against existing records and within the incoming batch by organization number, website domain, and contact email.
4. Preserves existing records and statuses.
5. Prints a summary and record-level validation errors.

Invalid records are rejected while valid records in the same batch may still be saved. Review the summary and correct any rejected records before re-importing.
