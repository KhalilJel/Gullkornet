# Beslutningspakke for juridisk gjennomgang – Gullkornet Lite

14.10.2026. Kort pakke til advokaten. **Systemet er ikke erklært lovlig. Utsending er av.** Bakgrunn i [LITE-JURIDISK-KONTROLL.md](LITE-JURIDISK-KONTROLL.md), [LITE-INTERESSEAVVEINING.md](LITE-INTERESSEAVVEINING.md), [PERSONVERNERKLAERING-UTKAST.md](PERSONVERNERKLAERING-UTKAST.md), [LITE-EPOSTMAL-FORSLAG.md](LITE-EPOSTMAL-FORSLAG.md) og [LITE-DATABEHANDLERE.md](LITE-DATABEHANDLERE.md).

## Hva vi vil gjøre

Cidea Marketing (CIDEA AS, org.nr. 927 394 391, bekreftet av eier 15.10.2026) vil sende **én** e-post med fast tekst til felles e-postadresser hos AS/ASA. Sprintens utgangspunkt er 423 Lite Ready, hvorav 403 teknisk klare i forrige audit. Oslo/Akershus dekker frisør, rørlegger, elektriker, snekker/tømrer, bilverksted, taktekker, renhold og regnskap. Utvidelsen dokumenterer også rørlegger/elektriker i Østfold og Buskerud og rørlegger i Vestfold; øvrige nye segmenter er sperret. Bufferens mål er 700. Planlagt tak er 95/dag, men eventuell kontrollert aktivering starter med pilot maks 5/dag og 1/kjøring. Ingen oppfølging uten svar. Adressene er hentet fra Enhetsregisteret eller bedriftens egen nettside. Reservasjon blokkerer hele domenet. Ingen sporingspiksler. Ingen teknisk status utgjør et lovlig kontaktgrunnlag.

## Spørsmål til advokaten, i prioritert rekkefølge

| # | Spørsmål | Hvorfor det blokkerer | Kilder |
|---|---|---|---|
| **1** (B1) | Er en **felles adresse** (post@, info@, firmapost@) hos et **AS** en henvendelse til en «fysisk person» etter mfl. § 15 første ledd? Spesielt der AS-et har 1–5 ansatte. Hjelper det å kreve et minste antall ansatte? | Er svaret ja, er samtykke påkrevd og hele Lite-modellen ulovlig uten det. **Hovedblokkeringen** | mfl. § 15 (LOV-2009-01-09-2). Innst. O. nr. 22 (2004–2005) om «firmapost@firma.no». Forbrukertilsynets veiledning om e-post/SMS (gjeldende versjon) |
| **2** (B2) | Ehl. § 9: må det fremgå **av emnet eller avsendernavnet** at e-posten er markedsføring? Holder «Reklame fra Cidea Marketing: …»? | Hvis ja, kan dagens godkjente mal (emne «En idé til forbedring hos dere») ikke brukes | ehl. § 9 første ledd (LOV-2003-05-23-35) |
| **3** (B4) | GDPR art. 14: holder det med én linje om kilde og en lenke til personvernerklæringen i første e-post (art. 14 nr. 3 bokstav b)? | Dagens mal har ingen art. 14-informasjon | GDPR art. 14 (personopplysningsloven § 1) |
| 4 (B3) | Ehl. § 8: må org.nr. og adresse stå i selve e-posten? | Lav risiko. Rettes uansett i forslaget | ehl. § 8 |
| 5 (B5) | Holder interesseavveiningen, gitt at svaret på spørsmål 1 er nei? | Grunnlaget for art. 6 nr. 1 bokstav f | LIA-utkastet |
| 6 | Telefon: kan vi ringe de samme AS-ene muntlig, uten samtykke? | Salgsplanen bygger på telefon til topp 20 | mfl. § 15 annet ledd (muntlig telefon er unntatt). Om reservasjon etter mfl. § 12 gjelder for AS |

Kontoenes DPA-er, USA-overføringer og faktiske lagringsrutiner er ikke bekreftet. De skal avklares før personvernerklæringen publiseres og før aktivering. Retensjonskode er bygget, men ikke aktivert; ingen sletting er godkjent i denne sprinten.

## Foreslått malversjon til vurdering

Eierens beslutning 15.10.2026 er å beholde godkjent **2026-10-14.2 uendret**, slik den finnes i `src/lite/template.ts`. Juristens vurdering må gjelde denne faktiske teksten, emnet og informasjonsplikten. Forslaget `.3` i [LITE-EPOSTMAL-FORSLAG.md](LITE-EPOSTMAL-FORSLAG.md) er bare et historisk alternativ og er ikke godkjent for bruk. Dersom juristen krever endringer, stopper aktiveringen til en ny mal er uttrykkelig godkjent.

## Personvern i korte trekk

- **Data per bedrift:** firmanavn, org.nr., org.form, NACE, kommune, felles e-post, nettside, kilde-URL og status. Navngitte mottakeradresser avvises; innkommende svar kan likevel inneholde personopplysninger.
- **Grunnlag:** art. 6 nr. 1 bokstav f (berettiget interesse), forutsatt at § 15 ikke krever samtykke.
- **Foreslått lagring, ikke aktivert:** aldri kontaktet slettes etter 90 dager, kontaktet uten svar minimeres etter 90 dager, reservasjoner minimeres og beholdes. Innboks og svarmonitorens e-postkopier mangler vedtatt lagringstid.
- **Databehandlere:** Airtable (USA), Resend (USA, sender fra EU-regionen), Migadu (Sveits), Railway (USA, lagrer kopier av innkommende e-post) og GitHub.

## Eierens beslutninger etter advokatens svar

1. Bekrefte om den uendrede 2026-10-14.2 kan brukes. Ingen malendring uten ny uttrykkelig godkjenning.
2. Eventuelt sette en nedre grense for antall ansatte (kan bygges som et filter uten å endre malen).
3. Fullføre DPA-/overførings- og lagringsavklaringer og publisere en faktakontrollert personvernerklæring.
4. Gi et særskilt uttrykkelig klarsignal for kontrollert pilot etter avklart lovlig grunnlag og teknisk kontroll. Sprinten setter ikke `GULLKORNET_LITE_ENABLE_LIVE_SEND`.
