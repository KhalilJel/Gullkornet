# Forslag til ny e-postmal – Gullkornet Lite

**Status: FORSLAG (forslag-2026-10-14.3). Brukes ikke til sending.** Den godkjente malen 2026-10-14.2 i `src/lite/template.ts` er uendret, og en test låser den. Forslaget ligger i `src/lite/template-proposal.ts` og er testet mot samme kontroll som godkjent mal: avsender, reservasjon, «dere» og bare Cidea Marketing.

## Emne

| Godkjent (2026-10-14.2) | Forslag |
|---|---|
| En idé til forbedring hos dere | **Reklame fra Cidea Marketing: en idé til forbedring hos dere** |

Ehl. § 9: uanmodet e-post skal vise at den er markedsføring *når den mottas*. Emnet er det mottakeren ser før e-posten åpnes.

## Tekst

Brødteksten og reservasjonslinjen er ordrett som i den godkjente malen. Nytt er bunnteksten etter `--`:

```
Hei,

Vi har sett på hvordan bedrifter i deres marked presenterer seg digitalt, og mener det finnes muligheter for å forbedre hvordan dere tiltrekker dere nye kunder.

Vi har en konkret idé som vi tror kan gjøre det enklere for potensielle kunder å finne dere og ta kontakt.

Er dere åpne for at vi sender dere en kort forklaring?

Mvh
Jelassi
Cidea Marketing

Gi gjerne beskjed dersom dere ikke ønsker flere henvendelser.

--
Denne e-posten er markedsføring fra Cidea Marketing (CIDEA AS, org.nr. 927 394 391, Gunnar Schjelderups vei 13A, 0485 Oslo, hello@cideamarketing.com).
Vi fant bedriftens e-postadresse i Enhetsregisteret. Slik behandler vi opplysninger: https://cideamarketing.com/personvern
```

| Linje | Hensyn |
|---|---|
| «Reklame fra Cidea Marketing» i emnet | Ehl. § 9: tydelig at det er markedsføring, og fra hvem |
| CIDEA AS, org.nr., adresse, e-post | Ehl. § 8: navn, adresse, e-post og foretaksregister/org.nr. |
| «Vi fant … i Enhetsregisteret» og lenke | GDPR art. 14 nr. 2 bokstav f (kilde) og art. 14 nr. 3 bokstav b (senest ved første kontakt). Resten av art. 14-informasjonen står i personvernerklæringen |
| Reservasjonslinjen er beholdt | Markedsføringsloven og GDPR art. 21 |

## Før forslaget kan tas i bruk

1. **[BEKREFT]** at Cidea Marketing drives av CIDEA AS (org.nr. 927 394 391, slått opp i Brreg 14.10.2026) og at adressen er riktig.
2. Publiser personvernerklæringen ([PERSONVERNERKLAERING-UTKAST.md](PERSONVERNERKLAERING-UTKAST.md)) på `https://cideamarketing.com/personvern`. Lenken virker ikke før den er publisert.
3. Godkjenning fra eieren, helst etter en jurists vurdering av emnefeltet.
4. Deretter en egen PR: flytt teksten til `LITE_TEMPLATE`, sett `LITE_TEMPLATE_VERSION = "2026-10-14.3"` og oppdater testen som låser malen.

Avveining: «Reklame» i emnet kan gi lavere svarprosent og høyere risiko for spamfilter. Det er en forretningsmessig avveining mot en tydeligere oppfyllelse av § 9, og den må eieren ta.
