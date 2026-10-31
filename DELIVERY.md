# Revisione browser 0.3 — geografia reale

Fonte e workflow: https://github.com/italianoriccardo6-sketch/napoli-quartiere-zero . Ogni pubblicazione deriva da un commit presente su GitHub; `/build-info.json` identifica il commit effettivamente servito. GitHub Actions verifica test e build e conserva gli artifact per SHA; il deploy rimane un passaggio esplicito, non un’automazione Netlify già collegata.

La nuova base sostituisce il layout inventato con un estratto OSM centrale di circa 3,7 km². Geometrie attive: 1.803 edifici, di cui 316 con cortili, e 1.531 percorsi di superficie; costa misurata ricomposta dai dati e ritagliata senza nuove rive nel viewport. Il tragitto missione, lungo circa 586 metri, segue Via Santa Lucia, Via Chiatamone, Via Alessandro Dumas e Via Partenope. Il prologo originale con dialoghi e due finali è mantenuto, con punti di interazione spostati sul nuovo percorso.

Terreno ancora piano e architettura a volumi generici. Sono stimate 1.620 altezze; le quote regionali non sono attivate. Nessuna dichiarazione di fotorealismo, città identica, combattimento o inseguimento fisico.

Verifiche locali: 28 test, TypeScript e build superati. Inclusi controlli su coordinate sorgente vere, cortili, costa, buchi, dati geografici e percorso completo con oltre 2.000 campioni e ingombro del motorino. Scena eseguita in NullEngine. Non sono stati eseguiti test GPU, screenshot o prove interattive sul Mac.

L’hosting collegato alla chat usa `.openai/hosting.json` e conserva l’accesso privato al proprietario. Non sono stati modificati siti di produzione diversi. I risultati effettivi di CI e deploy sono confermati nella chat solo dopo averne letto lo stato.


## Patch 0.3.1

Riprodotto e corretto il crash HUD causato da `world-note` privo di ID. Verifica dell’interfaccia prima dell’avvio, input senza pointer lock, focus sulla scena, direzioni A/D e mouse coerenti con la telecamera. Controller di movimento estratto e usato direttamente dall’app e dai test.

43 test effettivi superati, inclusi markup reale/HUD di produzione e movimento sulla mappa attiva. Build e TypeScript verificati. DOM simulato e NullEngine non sostituiscono la prova interattiva sul Mac, non effettuata in questa sessione. La qualità grafica della schermata richiesta dall’utente resta un obiettivo non raggiunto.
