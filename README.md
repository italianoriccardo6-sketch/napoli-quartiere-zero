# Napoli — Quartiere Zero

Gioco 3D per browser, tastiera e mouse. Si apre da un sito online anche su Mac; non richiede Unreal Engine o installazione di un gioco desktop.

**Stato: prototipo artistico, non fotorealistico e non basato su una cartografia OSM verificata.** Il recupero dei dati reali resta bloccato dalla rete. Questa revisione aggiunge un prologo originale, materiali generati con normal map, dettagli architettonici, luce ricalibrata e telecamera più bassa. Non è un open world della scala di GTA e non ne utilizza personaggi o asset.

## GitHub è la fonte del progetto

Repository: https://github.com/italianoriccardo6-sketch/napoli-quartiere-zero . Ogni revisione viene prima caricata su GitHub. `.github/workflows/verify.yml` esegue test e build per push su `main` e pull request e conserva la build come artifact associato allo SHA. La pubblicazione viene effettuata da un checkout del commit GitHub verificato; l’eventuale repository tecnico del servizio di hosting è una copia dello stesso commit, non una fonte alternativa di modifiche.

La build espone `/build-info.json` con commit e link GitHub. `.openai/hosting.json` identifica l’hosting collegato alla chat (nuovo sito privato per il proprietario). `netlify.toml` rimane disponibile per Netlify. Le vecchie anteprime anonime Netlify avevano una scadenza; non sono usate come garanzia di hosting permanente. Nessuna distribuzione autenticata automatica Netlify è stata configurata: richiede il collegamento del repository nell’account Netlify. L’automazione GitHub verifica e prepara gli artifact; la pubblicazione corrente resta un passaggio esplicito dal commit verificato.

## Avvio e verifiche

Node.js 22.12+ e npm:

```sh
npm ci
npm run dev
```

```sh
npm test
npm run build
npm run preview
```

Vite + TypeScript + Babylon.js core e loaders 9.33.1 (nessun GLB remoto). Font inclusi nella build, nessun backend. `dist/`, dipendenze e credenziali non sono versionati. `npm run typecheck` esegue solo il controllo dei tipi.

## Prologo: «A nome di tua sorella»

Luca Serra cerca Ada, sua sorella. Teresa gli consegna un telefono danneggiato al bar; alla banchina il contatto non si presenta. Sul telefono ci sono una prova e due messaggi incompatibili. Il giocatore decide di proteggere la prova per la giornalista Nora oppure di aprire una trattativa, poi torna da Teresa per confermare il finale.

Flusso giocabile: **bar → banchina → scelta nei dialoghi → ritorno al bar**. Si può completare a piedi o usando il motorino. Proteggere dà 25 monete e il contatto Nora; trattare dà 75 monete e il contatto dell’intermediario. La ricompensa viene assegnata una sola volta. Nessun inseguitore fisico, inseguimento simulato, combattimento o dialogo doppiato è implementato. Personaggi e vicenda sono di fantasia. Teresa è rappresentata dal punto di interazione al bar, non da un personaggio animato.

- WASD/frecce: movimento; Shift: corsa.
- Mouse: guarda; trascinamento sulla scena se pointer lock non disponibile.
- E: parla, controlla il telefono, sali/scendi dal motorino. Fermarsi prima di scendere.
- Motorino: W accelera; S frena e poi retromarcia; A/D sterzano.
- R: recupero in punto sicuro; Esc: pausa (durante un dialogo usare il pulsante Continua).
- I dialoghi fermano il movimento; al termine la partita riprende. La perdita di focus mette in pausa la guida/esplorazione.

Salvataggi locali distinti: `napoli-quartiere-zero-v1` conserva impostazioni ed eventuali vecchie monete; `napoli-quartiere-zero-story-v1` conserva fase, scelta e ricompensa del nuovo prologo. Le monete del prologo sono mostrate insieme alle vecchie monete. Dati corrotti sono respinti, storage indisponibile lascia proseguire in memoria. «Ripristina partita» richiede due clic e azzera entrambi. Posizione e mezzo ripartono dalla piazzetta al ricaricamento. Nessun controllo touch o supporto mobile dichiarato.

## Geografia e dati reali

Area di estrazione prevista: 40.8264–40.8306 N, 14.2462–14.2506 E; origine locale 40.8281 N, 14.2486 E. Coordinate locali in metri, x est e z nord, proiezione equirettangolare a raggio 6.378.137 m. Riferimento di localizzazione: https://en.wikipedia.org/wiki/Castel_dell%27Ovo (non fonte di geometrie).

```sh
npm run data:fetch
npm run data:prepare
```

L’estrazione tenta al massimo una richiesta per endpoint Overpass (due endpoint), con timeout limitati. Salva `data/borgo-marinari.osm.json`, query e metadati di fonte/data/perimetro/licenza. Non servono chiavi o account. La query è inclusa in `data/query.overpassql`.

`osmtogeojson` assembla way e relation multipolygon, preservando cortili e corpi distinti. L’importatore produce `data/map.osm.local.json` separatamente. Altezza: `height`, altrimenti livelli × 3,2 m, altrimenti 10 m stimati; massimo tecnico 60 m. Non attiva automaticamente un terreno ricavato da una costa aperta. Per usare i dati reali occorre prima chiudere e verificare le superfici, punti missione, castello e corridoio largo almeno 2 m e aggiornare i test. Vedi `data/STATUS.md`.

Il layout attuale, il castello composto, i palazzi, il ponte abbreviato, le quote piane e il profilo lontano sono approssimazioni artistiche originali. Le aree pedonali sono adattate alla guida arcade. Non sono una riproduzione fotografica. Nessun dato, texture o modello Google Maps/Earth/Street View.

Futuri dati OSM: [© OpenStreetMap contributors](https://www.openstreetmap.org/copyright), [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Estratti e banche dati derivate richiedono attribuzione e rispetto delle condizioni ODbL, inclusa la disponibilità della banca dati derivata o delle modifiche quando prevista dalla licenza. La licenza dei dati è distinta da quella di codice e asset. Questa consegna non contiene un estratto OSM.

## Moduli e grafica

- `geo.ts`, `import-osm.ts`, `scripts/`: geografia offline.
- `world.ts`, `surfaces.ts`: scena, dettagli e texture originali di colore/normali. StandardMaterial: non una pipeline PBR fotografica. Mare con riflesso di un cielo analitico, non riflessi della geometria della scena.
- `character.ts`, `vehicle.ts`, `camera.ts`, `input.ts`: personaggio procedurale con arti gerarchici, motorino, telecamera e controlli. Non ci sono mocap o personaggi fotorealistici.
- `story.ts`, `mission.ts`, `save.ts`: prologo, logica legacy e impostazioni; logica missione originale mantenuta per compatibilità/test.
- `main.ts`, `ui.ts`, `style.css`, `audio.ts`: interazioni, dialoghi, HUD e audio sintetico.

Collisioni cinematiche su piano, raggio veicolo 0,93 m, sottopassi massimi di 20 cm, scorrimento a piedi e stop del mezzo contro ostacoli. Bordi non attraversabili; controllo di recupero se si esce dalla mappa. Ombre selettive e istanze per decorazioni; qualità alta con pixel ratio massimo 1,5, bassa massimo 1 senza ombre. Nessun benchmark FPS verificato. Vite segnala il chunk JS iniziale sopra 500 kB: avviso, non errore.

## Evidenze e limiti

TypeScript, build di produzione e **13 test automatici** passano: coordinate, poligono concavo, altezze, missione legacy, salvataggi, velocità/frenata, relation multipoligono con cortile, scena reale in NullEngine/corridoio percorribile, sequenza del prologo, entrambi i finali, scelta persistita, dati corrotti e ricompensa idempotente.

NullEngine esegue costruzione e aggiornamenti della scena ma non prova shader sulla GPU, qualità visiva, browser/macOS, mouse o completamento interattivo. Nessun tool browser collegato disponibile in questa sessione; screenshot e prova manuale non eseguiti. Il cambio della camera e dei materiali richiede ancora un controllo visivo nel browser. Nessuna promessa di fotorealismo o fedeltà geografica.

Licenze e font: `ASSETS.md` e `public/licenses/`.
