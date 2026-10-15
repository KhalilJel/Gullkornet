# Databehandlere og overføringer – Gullkornet Lite

**Ny kontroll 15.10.2026:** Kontoenes signerte avtaler er fortsatt ikke dokumentert. Airtables offentlige DPA er nå datert **08.09.2026** og krever gyldig signering av partene; datoen i den eldre kartleggingen under er historisk. Railway krever utfylt DocuSign og Railways signering. Resend beskriver aksept av hovedavtalen eller separat signering, med utført avtale tilgjengelig i dashbordet. Ingen avtaler er signert i sprinten. Se [lanseringsrapporten](LITE-LANSERINGSSPRINT-2026-10-15.md) for kontrollerte kilder og eierens handlinger.

Kartlagt 14.10.2026 fra koden, Railway-konfigurasjonen, Resend-API-et (lesing) og leverandørenes offentlige vilkår. **«Akseptert» betyr at vilkårene finnes og hvordan de inngås. Det er ikke kontrollert at de er inngått i hver av Cideas kontoer.** Eieren må bekrefte dette i hver konto (kolonnen «Eierens handling»).

| Leverandør | Rolle i Lite | Data | Hvor | DPA | Overføringsgrunnlag | Eierens handling |
|---|---|---|---|---|---|---|
| **Airtable** (Formagrid Inc.) | CRM: alle lead-rader | Firmadata, felles e-postadresser, status, salgsnotater | USA | Airtable DPA (datert 05.12.2025). Inngås via skjema og signeres med DocuSign. Hvilke planer som dekkes er oppgitt ulikt i kildene | SCC ifølge sekundærkilder. DPF-status er ikke bekreftet (kontroller «Formagrid» på dataprivacyframework.gov) | Signer DPA-en via airtable.com/dpa og bekreft at planen dekkes. Kontroller DPF |
| **Resend** (Plus Five Five, Inc.) | Sender e-posten | Mottakeradresse, emne, tekst og leveringslogg | Domenet sender fra eu-west-1 (Irland), API og primær behandling i USA (DPA § 6.1) | Resend DPA. Bindende ved aksept av vilkårene, signert versjon i dashbordet | EU SCC (2021/914) og EU–US DPF (DPA § 11) | Last ned signert DPA fra Resend-dashbordet og arkiver den |
| **Migadu** (Migadu-Mail GmbH, Sveits) | Innboks hello@ (svar) | Innkommende e-post | Sveits (selskap). Datasenter ikke bekreftet | Personvernerklæringen gjelder også som DPA | Sveits har adekvansbeslutning fra EU | Les migadu.com/privacy (underleverandører og datasentre). Be om signert DPA ved behov |
| **Railway** (Railway Corporation) | Svarmonitor (openoutreach) | **Kopi av innkommende e-post** lagret på volumet `openoutreach-data`, statuslogg | **USA, region sfo** | Railway DPA (railway.com/legal/dpa). Standard, ikke forhandlingsbar. Signert kopi via skjema | SCC (har forrang i DPA-en). Underleverandører: se trust.railway.com | Be om signert DPA. Avklar lagringstid for e-postkopiene på volumet |
| **GitHub** (Microsoft) | Kjører workflows, kode | Ingen e-postadresser i klartekst i logger (bare record-ID-er og tall). Researchen er AES-256-GCM-kryptert. Secrets | USA | GitHub DPA gjelder betalte planer og kunder med Microsoft-avtale. For gratiskonto gjelder personvernerklæringen | DPF / SCC (Microsoft) | Avklar plan. Behandlingen er minimal fordi ingen personopplysninger ligger i klartekst |
| **OpenRouter** | **Ikke i bruk i Lite.** Konfigurert i openoutreach (`OUTSEND_LLM_API_BASE`, modell `openrouter/free`) for upstream-sending, som er låst | Ingen i dag | USA | – | – | **Anbefaling:** fjern LLM-konfigurasjonen fra openoutreach hvis den ikke trengs. Gratismodeller kan logge forespørsler. Kodekontroll: svarmonitorens `mail_pass` klassifiserer med regler, uten LLM |
| **Brønnøysundregistrene** | Kilde (åpne data) | – | Norge | Ikke databehandler (offentlig kilde) | – | – |

## Funn som krever oppfølging

1. **Railway lagrer kopier av e-post i USA.** OpenOutSend speiler innboksen (`mirror`) til volumet i sfo. Det er den mest omfattende behandlingen av personopplysninger i systemet. Lagringstiden er ikke definert. **Beslutning:** godta det med Railway-DPA og SCC, og sett en lagringstid, eller flytt tjenesten til en EU-region (flytting kan gi kostnad eller nedetid).
2. **LLM-nøkkel til OpenRouter** finnes i Railway-variablene uten at Lite bruker den.
3. DPA-ene er **ikke** verifisert som inngått i Cideas kontoer.

Kilder: airtable.com/dpa · support.airtable.com (Data Processing Addendum) · resend.com/legal/dpa · migadu.com/privacy · railway.com/legal/dpa · trust.railway.com. Resend-domene, region og sporing er lest fra Resend-API-et 14.10.2026. Railway-region og volum er lest fra Railway CLI 14.10.2026.
