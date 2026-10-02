# Digital presence segmentation

Gullkornet can now inspect public homepage HTML for links to Facebook, Instagram, LinkedIn, TikTok, and YouTube, and separately identify Google Places candidates with no website URL listed.

Run against a Google Places candidate JSON array:

```bash
npx tsx src/cli/research-digital-presence.ts data/google-candidates.json > data/digital-presence-results.json
```

The report separates:
- `NO_WEBSITE_LISTED`: Google Places did not return a website URL. This is a research lead, not proof that no website exists.
- `WEBSITE_WITH_SOCIAL_LINKS`: supported social profile links were found on the homepage. Activity and profile quality are not assessed.
- `WEBSITE_WITHOUT_DETECTED_SOCIAL_LINKS`: no supported social links were found on the homepage. This is not proof that the business lacks social accounts.
- `FETCH_ERROR` / `BLOCKED_URL`: no conclusion could be made.

All records require human review. This is a research aid, not a contact qualification decision. No email is sent and the tool does not search social networks independently.
