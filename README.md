# Napoli — Quartiere Zero

Prima demo 3D per browser, Vite + TypeScript + Babylon.js. Piccola avventura originale ispirata a Borgo Marinari e Castel dell’Ovo: esplorazione in terza persona, motorino arcade e consegna «Un caffè al volo».

**Stato geografico: ambiente artistico provvisorio, non basato su un estratto OSM.** I server di estrazione sono esclusi dalla rete dell’ambiente (HTTP 403). Non dichiarare fedeltà cartografica o fotografica. Il ciclo di gioco è implementato; le prove interattive WebGL con tastiera/mouse e la verifica visiva restano da effettuare su un browser reale.

## Avvio

Node.js 22.12+ (consigliato 22 LTS), npm.

```sh
npm ci
npm run dev
```

Aprire l’URL stampato da Vite. Per la versione di produzione:

```sh
npm test
npm run build
npm run preview
```

`npm run typecheck` controlla TypeScript senza generare file. `package-lock.json` blocca le versioni. Le dipendenze Babylon core e loaders sono entrambe 9.33.1; loaders è predisposto per futuri GLB, nessun modello remoto viene caricato. Nessun database o servizio di backend è richiesto. La build contiene anche i font; il gioco non interroga Overpass né CDN a ogni avvio.

## Comandi e consegna

- **WASD / frecce:** cammina; **Shift:** corri.
- **Mouse:** ruota la telecamera dopo «Gioca»; se il blocco puntatore non è disponibile, trascina sulla scena.
- **E:** ritira al bar, sali sul motorino, scendi da fermo, consegna sulla banchina.
- **Motorino:** W accelera, S frena e poi inserisce la retromarcia, A/D sterzano. Velocità massima arcade 39,6 km/h; retromarcia 10,8 km/h.
- **R:** recupera il motorino in un punto libero vicino al personaggio; se sei a bordo, torna alla piazzetta iniziale.
- **Esc / pulsante pausa:** ferma la partita. «Riprendi» riattiva i comandi. La perdita di focus o del pointer lock mette in pausa.

Il personaggio parte vicino al motorino (corallo). Il bar è poco più a est, sotto la tenda chiara. Avvicinati al segnale e premi E: il pacco appare sulla schiena e l’obiettivo passa al pescatore sulla banchina sud-est. Segui il percorso tratteggiato sulla minimappa, scendi da fermo e premi E al segnale. Ricompensa: **25 monete**, assegnate una sola volta. Poi puoi esplorare.

Completamento, monete, volume e qualità sono salvati in localStorage (`napoli-quartiere-zero-v1`). Valori corrotti, dati assenti e storage non disponibile sono gestiti. Posizione e motorino ripartono dalla piazzetta dopo il ricaricamento. «Ripristina partita» richiede due clic e azzera il salvataggio locale. I crediti sono raggiungibili dalla schermata iniziale e durante la partita. Nessun controllo touch implementato: nessuna dichiarazione di supporto mobile.

## Geografia e aggiornamento OSM

Area richiesta: **40.8264–40.8306 N, 14.2462–14.2506 E**. Origine locale **40.8281 N, 14.2486 E**, vicino al castello. Come riferimento di localizzazione, [Castel dell’Ovo](https://en.wikipedia.org/wiki/Castel_dell%27Ovo) è indicato a circa 40.82778 N, 14.24806 E. Questa localizzazione non è una fonte delle geometrie del gioco.

`src/geo.ts` converte WGS84 in metri con proiezione equirettangolare locale: x verso est, z verso nord; raggio terrestre 6.378.137 m. Adeguata per questo piccolo perimetro, non una proiezione cartografica di precisione.

```sh
npm run data:fetch
npm run data:prepare
```

Il primo comando effettua al massimo una richiesta per ciascuno dei due endpoint Overpass, con timeout contenuti. Salva query, estratto originale e metadati fonte/data/perimetro/licenza. Non servono account o chiavi. Il secondo usa `osmtogeojson` per assemblare le way e le relation multipolygon, preserva i cortili e produce `data/map.osm.local.json`. Altezza: `height`, altrimenti `building:levels × 3,2 m`, altrimenti 10 m stimati; tetto tecnico di 60 m. La conversione conserva un flag sulle stime.

L’importazione **non sostituisce automaticamente** `public/data/map.json`: una linea di costa incompleta non è un poligono di terreno sicuro. Prima di attivare i dati reali occorre chiudere e verificare la superficie di terra, rivedere i punti missione e i volumi speciali del castello, assicurare un collegamento libero largo almeno 2 m e aggiornare i test del percorso. La provenienza e il testo dell’interfaccia vanno aggiornati solo dopo tale verifica. Non basta rinominare il file generato.

Vedi [data/STATUS.md](data/STATUS.md) per gli errori effettivi e il file mancante. Le fixture OSM nei test sono sintetiche, non dati di Napoli.

## Licenze dei dati

Attribuzione prevista: [© OpenStreetMap contributors](https://www.openstreetmap.org/copyright). Dati OSM soggetti a [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Quando si distribuisce un estratto o una banca dati derivata, conservare attribuzione, avvisi e licenza; in caso di uso pubblico di una banca dati derivata renderla disponibile secondo gli obblighi ODbL, inclusa la possibilità di ottenere la banca dati o le modifiche. Le opere prodotte devono riportare l’attribuzione pertinente. Distinguere la licenza dei dati dalla licenza del codice e degli asset originali. In questa consegna non è distribuito alcun estratto OSM; l’attribuzione nell’interfaccia rimanda alla fonte per l’importatore predisposto, come chiarito nei crediti.

Nessuna texture raster OSM; nessun dato, immagine o geometria Google Maps, Earth o Street View.

## Architettura

| Modulo | Responsabilità |
| --- | --- |
| `geo.ts`, `import-osm.ts`, `scripts/` | Conversione metrica, poligoni/cortili, estrazione e preparazione offline |
| `world.ts` | Terreno, ingombri, edifici, castello composto, decorazioni istanziate, mare shader |
| `character.ts`, `input.ts` | Personaggio stilizzato, animazione, tastiera, focus e mouse |
| `vehicle.ts` | Modello originale del motorino e accelerazione arcade |
| `camera.ts` | Inseguimento, orbita e raycast sugli ostacoli |
| `mission.ts`, `save.ts` | Stati, ricompensa idempotente e salvataggi validati |
| `ui.ts`, `style.css`, `index.html` | Schermate, HUD, minimappa, errori e impostazioni |
| `main.ts`, `audio.ts` | Coordinamento, collisioni con sottopassi, interazioni e audio sintetico |

Nessun motore fisico esterno: cinematica 2D deterministica su terreno piano con cerchi contro sagome poligonali e bordi, movimento suddiviso in passi da massimo 20 cm per evitare l’attraversamento degli ostacoli. A piedi è previsto scorrimento lungo i muri; il motorino si ferma all’urto. Il raggio veicolo è 0,93 m. La discesa cerca quattro punti liberi accanto al mezzo. I bordi impediscono l’ingresso in acqua; un controllo di validità riposiziona comunque il personaggio se finisce fuori mappa. Questo approccio non simula pendenze o fisica realistica.

Ombre direzionali limitate a edifici/personaggio/veicolo, decorazioni ripetute tramite istanze. Qualità alta con ombre e pixel ratio massimo 1,5; bassa senza ombre e ratio massimo 1. La build iniziale JS è circa 1,1 MB prima della compressione (circa 270 kB gzip, più shader/chunk richiesti). Vite segnala un chunk sopra 500 kB; è un avviso, non un errore. Nessun benchmark FPS verificato.

## Ricostruzioni e adattamenti

Terreno piano, ponte abbreviato, banchine allargate, disposizione degli edifici e distanze compresse sono scelte originali provvisorie. Il castello è un modello composto semplificato con torri, terrazze e merlature, non un rilievo. Bar, insegne, arredi, profilo lontano, barche e punto del pescatore sono inventati. Per la giocabilità il motorino può percorrere aree normalmente pedonali. Il castello non è visitabile all’interno. Nessun traffico, folla o multiplayer.

## Verifiche eseguite e limiti

- TypeScript: superato.
- Build Vite di produzione: superata.
- 8 test automatici: origine e scala delle coordinate; poligono concavo; altezze; missione e ricompensa; salvataggi corrotti e round-trip; accelerazione/freno/retromarcia; multipoligono con due corpi e cortile; scena Babylon con NullEngine, 10 frame, collisioni, spawn, punti di discesa e oltre 800 campioni del corridoio per il motorino.
- NullEngine esegue la costruzione reale della scena e gli aggiornamenti, ma **non verifica WebGL, shader sulla GPU, aspetto, tastiera o pointer lock in un browser**.
- Strumenti browser collegati non disponibili in questa sessione: screenshot, completamento manuale della missione, ricaricamento effettivo del browser e console WebGL non verificati. La verifica headless non viene presentata come prova di gioco interattiva.

Checklist da eseguire in un browser: Gioca → muovi e urta un muro → raggiungi il bar e ritira → sali e guida fino alla banchina → frena/scendi/consegna → verifica 25 monete → ricarica → verifica completamento e monete → pausa/riprendi → R → qualità/volume → crediti. Controllare console e fotogramma iniziale, in particolare il raycast della telecamera e lo spazio occupato dall’HUD.

## Netlify e GitHub

`netlify.toml`: build `npm run build`, directory `dist`, Node 22. Asset generati con nomi hash e percorsi Vite; `data/map.json` è incluso nella build. `.netlify/` è ignorata e non contiene codice da committare.

Per un’anteprima autenticata, da una sessione Netlify collegata:

```sh
npx netlify deploy --dir dist --no-build
```

Non usare `--prod` per questa prima anteprima. Nessun sito di produzione esistente deve essere sovrascritto. Un eventuale deploy anonimo è temporaneo e richiede di essere rivendicato entro il termine indicato da Netlify.

Il codice è consegnato in un repository Git locale autonomo. Nessun file degli altri repository presenti è stato modificato. La creazione di un nuovo repository GitHub non è disponibile nel connettore e l’API `api.github.com` è bloccata (CLI: Forbidden); non è stato scelto un repository diverso né pubblicato su un progetto esistente. Per caricare dopo aver ripristinato l’accesso:

```sh
gh repo create napoli-quartiere-zero --private --source . --push
```

Vedi `DELIVERY.md` per l’esito finale della pubblicazione della sessione.
