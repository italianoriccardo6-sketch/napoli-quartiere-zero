# Stato geografico 0.3

Estratto OpenStreetMap acquisito tramite il workflow GitHub «Estrai geografia reale di Napoli», run 41247515350, il 31 ottobre 2026 alle 22:18:11 UTC, endpoint overpass-api.de. Originale: `napoli-centro.osm.json`; provenienza: `source.json`; licenza: `OSM-LICENSE.md`.

Perimetro WGS84: sud 40.8260, ovest 14.2410, nord 40.8420, est 14.2660. Origine locale: 40.8281 N, 14.2486 E. I 23.149 elementi sorgente producono 1.803 edifici attivi, di cui 316 con cortili, e 1.531 percorsi di superficie. La costa è una catena di 1.448 punti da due way. Il percorso missione è lungo circa 586 m.

Il vecchio layout inventato non è più la base attiva. I dati derivati sono in `public/data/map.json`; dettagli e scelte in `city-summary.json` e `land-preparation.json`. Sono stimate 1.620 altezze. Terreno ancora piano, facciate e tetti generici, larghezze stradali stimate se assenti. Non è una ricostruzione fotografica o una certificazione dello stato odierno dei luoghi.

I primi tentativi locali verso Overpass erano stati rifiutati dal proxy. La procedura riproducibile su GitHub ha completato l’estrazione pubblica limitata, conservando provenienza e licenza. Non si usano tile raster OSM o dati Google.

I punti quotati regionali seguono una procedura separata e non sono attivati. I controlli hanno individuato alcuni punti restituiti poco fuori dal bbox richiesto: la risposta originale è conservata e il sottoinsieme viene ritagliato localmente senza ampliare il perimetro. Datum e unità verticali restano da verificare prima di generare un terreno altimetrico.
