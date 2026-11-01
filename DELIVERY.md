# Preview 0.6.0-preview.2 — traffico in tutto il comune

Il traffico della partita fotografica non è più fissato alla partenza: segue il giocatore nei quartieri raggiunti guidando o con il viaggio rapido. Le auto vicine vengono conservate, quelle nuove compaiono ad almeno 70 m, e nessuno spostamento avviene durante un’allerta. I tratti di strada già validati per l’ingombro dell’auto sono riusati; il reticolo prodotto è identico a quello precedente (verificato su 34 punti della mappa centrale e comunale). Misura in Node, non nel browser: la prima ricostruzione costa circa 130 ms, le successive, ogni 250 m di guida, circa 25–55 ms. Restano quattro auto alla volta. Verifica: 259 test superati, TypeScript e build superati; resa nella mappa Google non verificata visivamente.

---

# Preview 0.6.0-preview.1 — partita fotografica nativa

`/photoreal.html` avvia ora la partita con **Gioca a Napoli**, usando la chiave Maps JavaScript già configurata. Guida e cammino, prima persona e avatar statico in terza persona, interazioni, colpi con mano visibile, traffico locale, pattuglia e storia operano nella stessa mappa nativa Google. Vista libera e partita condividono l’istanza; non serve un server GPU né Geocoding API per i quartieri.

Il mondo indipendente di collisione copre l’estensione comunale: **56.201 edifici, 23.373 parti di strada e 30 arrivi di viaggio rapido** da fonti cartografiche. La base centrale non è sovrascritta. Archivio PMTiles fissato con hash, fonti e licenze in `data/photo-world/`; mondo, destinazioni e GLB sono preparati da `pretest`/`prebuild`. La geometria vettoriale ha quantizzazione circa 0,25 m e non certifica ogni ostacolo, strada o altezza. Traffico e pattuglia restano entro 500 m dalla partenza; la storia conserva il percorso centrale. Prologo e campagna sono salvati localmente, mentre posizione, salute e scontro ripartono al ricaricamento.

Verifica della revisione: 255 test superati, controllo TypeScript e build superati. Le prove automatiche esercitano controller, collisioni, combattimento, traffico, salvataggi e confine SDK con un adattatore locale. Le fotografie Google sono archiviate, non in diretta. Resa nativa dei GLB, assi, contatto con la strada, dettaglio dei singoli quartieri e Safari/Mac non sono verificati visivamente senza la chiave dell’utente. Terreno naturale DTM e superficie fotografica DSM possono differire. Nessuna immagine o mesh Google è estratta o distribuita nel repository. Stato, controlli e limiti nel README; configurazione e costi in `public/PHOTOREAL-SETUP.txt`.

---

# Base conservata e documentazione storica

La base Babylon conservata è la **0.4.2**: geografia OSM, terreno DTM regionale relativo, auto, prologo e tre fronti fotografici. I paragrafi 0.3/0.3.1 qui sotto sono conservati come resoconto storico e non descrivono il terreno o la grafica correnti.

Resoconto storico precedente alla partita fotografica: il ramo `work/napoli-city-streaming` preparava il caricamento progressivo dei volumi e dettagli delle facciate, l’acquisizione offline per singoli settori e la correzione Vite della calibrazione fotografica. In quella fase precedente alla 0.5 non conteneva l’intera città e il relativo lavoro non era stato pubblicato. Queste note non descrivono il mondo comunale o lo stato del deploy della revisione corrente.

---

# Revisione browser 0.3 — geografia reale

Fonte e workflow: https://github.com/italianoriccardo6-sketch/napoli-quartiere-zero . Ogni pubblicazione deriva da un commit presente su GitHub; `/build-info.json` identifica il commit effettivamente servito. GitHub Actions verifica test e build e conserva gli artifact per SHA; il deploy rimane un passaggio esplicito, non un’automazione Netlify già collegata.

La nuova base sostituisce il layout inventato con un estratto OSM centrale di circa 3,7 km². Geometrie attive: 1.803 edifici, di cui 316 con cortili, e 1.531 percorsi di superficie; costa misurata ricomposta dai dati e ritagliata senza nuove rive nel viewport. Il tragitto missione, lungo circa 586 metri, segue Via Santa Lucia, Via Chiatamone, Via Alessandro Dumas e Via Partenope. Il prologo originale con dialoghi e due finali è mantenuto, con punti di interazione spostati sul nuovo percorso.

Terreno ancora piano e architettura a volumi generici. Sono stimate 1.620 altezze; le quote regionali non sono attivate. Nessuna dichiarazione di fotorealismo, città identica, combattimento o inseguimento fisico.

Verifiche locali: 28 test, TypeScript e build superati. Inclusi controlli su coordinate sorgente vere, cortili, costa, buchi, dati geografici e percorso completo con oltre 2.000 campioni e ingombro del motorino. Scena eseguita in NullEngine. Non sono stati eseguiti test GPU, screenshot o prove interattive sul Mac.

L’hosting collegato alla chat usa `.openai/hosting.json` e conserva l’accesso privato al proprietario. Non sono stati modificati siti di produzione diversi. I risultati effettivi di CI e deploy sono confermati nella chat solo dopo averne letto lo stato.


## Patch 0.3.1

Riprodotto e corretto il crash HUD causato da `world-note` privo di ID. Verifica dell’interfaccia prima dell’avvio, input senza pointer lock, focus sulla scena, direzioni A/D e mouse coerenti con la telecamera. Controller di movimento estratto e usato direttamente dall’app e dai test.

43 test effettivi superati, inclusi markup reale/HUD di produzione e movimento sulla mappa attiva. Build e TypeScript verificati. DOM simulato e NullEngine non sostituiscono la prova interattiva sul Mac, non effettuata in questa sessione. La qualità grafica della schermata richiesta dall’utente resta un obiettivo non raggiunto.
