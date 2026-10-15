# Skrivebeskyttet oversikt over meldingskopier

POST /v1/retention-status med JSON {} og eksisterende lesetoken for reply-status. Krever konfigurert, frisk svarmonitor for samme låste postkasse. Ingen ny nøkkel, utførelsesflagg, filter eller postkassevelger. Maks forespørsel er 1024 byte. Ugyldig/ukjent innhold avvises; databasefeil gir 503, ikke et falskt tomt sammendrag.

Svaret inneholder mode=read_only_retention_inventory, policy_days=30, ttl_enabled=false, send_triggered=false, data_changed=false og tellinger: total, with_content, processed_older_than_policy, pending_older_than_policy, invalid_dates. Det eksponerer ingen adresser, emner, meldings-ID-er, råmeldinger eller tekst. Ett SELECT avgrenser til innkommende meldinger i konfigurert postkasse. recorded_at er systemets egen registreringstid, ikke avsenderens Date-header. Utgående meldinger og andre postkasser omfattes ikke. Backend- og tidsformat støttes eksplisitt bare for SQLite/USE_TZ; andre oppsett feiler fremfor å gjette.

Dette er oversikt og behov for gjennomgang, ikke en sletteplan. processed_at beviser behandling, ikke at en separat original fortsatt er bevart. Før eventuell opprydding må original/kunde-/regnskapsbehov og sperre-/svarbevis sikres. Ubehandlet innhold slettes ikke automatisk. Eksisterende Message-ID-rader bør ikke slettes ukritisk: de inngår i identitet/gjeninnlesing og har relaterte leveringshendelser.

Uavhengige tester bruker SQLite-authorizer som nekter alle skriveoperasjoner og kontrollerer tellegrense, systemdato, tomt resultat, feil, postkasse-/retningsavgrensning, tilgangskontroll, avvisning av execute og fravær av privat innhold i respons. Docker kjører testen mot samme Python-versjon som produksjon før deploy. CI kjører også hele Python-suiten.

Ingen TTL eller faktisk opprydding er aktivert av denne funksjonen. Produksjonssvaret og deploy dokumenteres i PR-kommentar etter gjennomføring.