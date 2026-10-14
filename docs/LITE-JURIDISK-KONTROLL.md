# Juridisk lanseringskontroll – Gullkornet Lite

Gjennomført 14.10.2026 som teknisk forberedelse. **Dette er ikke juridisk rådgivning, og systemet er ikke juridisk godkjent.** Punktene merket *Krever jurist* bør vurderes av en kvalifisert advokat før første utsending.

Kilder (primærkilder der det finnes):
- Markedsføringsloven, LOV-2009-01-09-2, sist endret ved LOV-2026-05-07-17: https://lovdata.no/dokument/NL/lov/2009-01-09-2
- Ehandelsloven, LOV-2003-05-23-35, §§ 8 og 9: https://lovdata.no/dokument/NL/lov/2003-05-23-35
- Personopplysningsloven med GDPR, LOV-2018-06-15-38: https://lovdata.no/dokument/NL/lov/2018-06-15-38
- Forarbeid til § 15 (opprinnelig mfl. § 2 b): Innst. O. nr. 22 (2004–2005), https://www.stortinget.no/no/Saker-og-publikasjoner/Publikasjoner/Innstillinger/Odelstinget/2004-2005/inno-200405-022/4/
- Forbrukertilsynets veiledning om markedsføring via e-post, SMS o.l. Lenken fra 2018 returnerte 404 den 14.10.2026, så gjeldende versjon må hentes fra forbrukertilsynet.no.

## 1. Dokumenterte krav (står i loven)

| Krav | Kilde | Status i Lite |
|---|---|---|
| Samtykke før e-postmarkedsføring til **fysiske personer** | mfl. § 15 første ledd | Lite sender bare til AS/ASA og bare til rolleadresser (post@, info@ …), ingen navngitte adresser og ingen ENK. Om dette faller utenfor § 15, står under punkt 2 |
| Det skal gå klart frem hvem markedsføringen skjer på vegne av | ehl. § 9 første ledd | Avsender er `Cidea Marketing <hello@cideamarketing.com>`, og malen er signert Jelassi, Cidea Marketing |
| Uanmodet e-post skal vise at den inneholder markedsføring **når den mottas** | ehl. § 9 første ledd | **Åpent.** Emnet «En idé til forbedring hos dere» sier ikke at e-posten er markedsføring. Se beslutning B2 |
| Faktiske påstander skal kunne dokumenteres | mfl. § 3 | Hver påstand er knyttet til en kryptert segment-researchfil (≥ 8 nettsider, under 90 dager gammel). Senderen skriver `research=<id>` på raden |
| Ikke villedende overfor næringsdrivende, god forretningsskikk | mfl. §§ 25 og 26 | Fast mal uten påstander om mottakerens egen nettside |
| §§ 6–7 gjelder **forbrukere** (kapittel 2, «Handelspraksis overfor forbrukere») | mfl. kap. 2, § 5 bokstav a | Lite sender ikke til forbrukere. For B2B gjelder §§ 2, 3, 25 og 26 |
| Retten til å protestere mot direkte markedsføring er absolutt | GDPR art. 21 nr. 2–3 | Reservasjonslinje i malen. `Do Not Contact` blokkerer hele domenet. Avkrysning gjøres manuelt samme dag |
| Informasjonsplikt når opplysningene ikke er samlet inn fra personen selv | GDPR art. 14, senest ved første kontakt (nr. 3 bokstav b) | **Åpent** for den delen av dataene som er personopplysninger. Se B4 |

## 2. Tolkningsspørsmål (*Krever jurist*)

1. **Er en rolleadresse i et lite AS en «fysisk person»?** Forarbeidene (Innst. O. nr. 22 (2004–2005)) sier at samtykkekravet ikke gjelder adresser som «firmapost@firma.no» som ikke er rettet mot en bestemt person. Men hos et AS med én eller to ansatte kan post@ i praksis være én persons innboks, og er det uklart, bærer avsenderen risikoen. **Vi antar ikke at rolleadresser fritt kan motta uoppfordret markedsføring.** Lite legger i dag ingen nedre grense for antall ansatte.
2. **Ehl. § 9 og emnefeltet.** Holder det at e-posten er tydelig kommersiell når den åpnes, eller må det fremgå allerede av emnet eller avsendernavnet?
3. **Ehl. § 8** (navn, adresse, e-post, org.nr.): gjelder kravet selve e-posten, eller holder det at opplysningene står på cideamarketing.com? Malen har i dag ikke org.nr. eller adresse.
4. **GDPR-omfang.** Data om et AS er ikke personopplysninger. En rolleadresse som i praksis leses av én identifiserbar person kan likevel være det. Det avgjør om art. 6 nr. 1 bokstav f, art. 14 og en interesseavveining er påkrevd for Lite-radene.

## 3. Personvern og drift

| Tema | Status |
|---|---|
| Behandlingsgrunnlag | Berettiget interesse (art. 6 nr. 1 bokstav f) er det naturlige grunnlaget. **Det finnes ingen skriftlig interesseavveining (LIA).** Se B5 |
| Dataminimering | Lite lagrer firmanavn, org.nr., org.form, NACE-kode, kommune, rolleadresse, nettside og kilde-URL. Ingen navn på personer. Actions-loggene viser bare record-ID-er og tall |
| Lagringstid | Interne standarder er godkjent i [PROSPECT-DATA-RETENTION-POLICY.md](PROSPECT-DATA-RETENTION-POLICY.md): 90 dager etter siste aktivitet, og reservasjoner beholdes så lenge de trengs. **Automatisk sletting er ikke implementert.** |
| Sletting på forespørsel | Manuelt: kryss av `Do Not Contact` først (så raden ikke kontaktes igjen), slett deretter øvrige felt. Behold bare en minimal reservasjonsrad |
| Databehandlere | Airtable (CRM), Resend (sending), Migadu (innboks), Railway (svarmonitor) og GitHub (kode og logger). **Ikke verifisert** at databehandleravtale (DPA) og overføringsgrunnlag (f.eks. EU–US Data Privacy Framework) er akseptert i hver konto. Se B6 |
| Research-filer | AES-256-GCM-kryptert i et offentlig repo, nøkkel som secret. Gyldig i 90 dager |

## 4. Beslutningsliste for eieren

| # | Beslutning | Anbefaling |
|---|---|---|
| B1 | Godta risikoen ved rolleadresser hos AS, eller sette en nedre grense (f.eks. minst 5 registrerte ansatte) | Få en jurist til å vurdere dette før pilot. En ansattgrense kan bygges uten å endre malen |
| B2 | Ehl. § 9: skal emnet eller avsendernavnet vise at e-posten er markedsføring? | Krever ny malversjon og ny godkjenning. Malen er ikke endret |
| B3 | Ehl. § 8: legge org.nr. og adresse i signaturen? | Samme som B2: ny malversjon |
| B4 | Art. 14: legge en lenke til personvernerklæring på cideamarketing.com i malen? | Lag erklæringen først, og legg lenken inn i samme malversjon som B2/B3 |
| B5 | Skriftlig interesseavveining (LIA) for Lite | Én side: formål, nødvendighet, avveining og tiltak (rolleadresser, reservasjon, minimering) |
| B6 | Bekrefte DPA og overføringsgrunnlag i Airtable, Resend, Migadu, Railway og GitHub | Sjekk i kontoinnstillingene. Ingen kostnad |
| B7 | Lagringstid for Lite-rader som aldri sendes, og for `Sent`-rader uten svar | Følg standarden på 90 dager. Automatisk sletting er et eget oppdrag |
