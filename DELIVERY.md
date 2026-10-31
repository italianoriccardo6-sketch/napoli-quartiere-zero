# Consegna — 31 ottobre 2026

## Anteprima Netlify

URL finale fornito nella risposta della chat. Lo ZIP è scaricabile da `/napoli-quartiere-zero.zip` sulla stessa anteprima.

Password: `My-Drop-Site`.

Stato `ready` verificato tramite Netlify prima della consegna. Creato su un nuovo sito temporaneo; nessun sito preesistente è stato sovrascritto. È un caricamento anonimo, non collegato all’account o al repository GitHub. Il termine originario per rivendicare questo deploy era il 31 ottobre 2026; il suo stato attuale non è stato riverificato durante il caricamento su GitHub. Il link riservato era stato fornito nella risposta della chat, non salvato nel codice. I deploy anonimi non applicano tutte le regole del progetto Netlify: la configurazione netlify.toml è pronta per un successivo deploy autenticato.

## Contenuto

- Sorgenti completi, package-lock.json, configurazione Netlify.
- Build statica pronta in `dist/`, da servire via HTTP (non aprire index.html con file://).
- README, ASSETS, licenze distribuite, stato dei dati e script di estrazione/importazione.
- Repository GitHub: https://github.com/italianoriccardo6-sketch/napoli-quartiere-zero . Sorgenti, documentazione, test e lockfile sono versionati. Build e dipendenze si rigenerano con `npm ci && npm run build`.

## Verifiche

`npm test`: 8/8 superati. `npm run build`: TypeScript e build superati. Scena reale costruita ed eseguita per 10 frame con Babylon NullEngine, corridoio consegna e collisioni verificati con campionamento, multipoligoni/cortili verificati con fixture sintetica. Pagina di produzione, dati e 12 riferimenti iniziali agli asset: HTTP 200 in locale. Deploy remoto: ready.

Non sono state effettuate prove interattive WebGL, screenshot o misure FPS: nessuno strumento browser collegato era disponibile. Il recupero dello screenshot automatico Netlify è stato rifiutato dalla rete con HTTP 403. Il funzionamento GPU e il ciclo completo tramite tastiera/mouse devono essere verificati nel browser.

## Limiti di rete e pubblicazione

- OSM: richieste piccole e limitate a Overpass principale, alternativa e API OSM rifiutate dal proxy con HTTP 403. Non è incluso alcun estratto reale. La scena mostra la dicitura «ricostruzione artistica provvisoria». `data/STATUS.md` specifica perimetro e file richiesto.
- GitHub: caricamento completato nel repository indicato dall’utente, tramite il connettore GitHub. Il repository era vuoto e l’account dispone di accesso in scrittura. La precedente limitazione della CLI non impedisce questa pubblicazione tramite connettore.
- Netlify: la CLI non dispone di una sessione autenticata; il deploy temporaneo anonimo è riuscito usando il proxy configurato. Per rendere permanente l’anteprima è necessaria la rivendicazione tramite il link fornito nella chat.
