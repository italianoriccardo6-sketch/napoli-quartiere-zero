# Dislivelli relativi di Napoli

Fonte: **Regione Campania, CTR2020 DTM5K, 2020**, CC BY 4.0. Il TIFF originale, la risposta di esportazione e i metadati del servizio sono conservati in questa cartella. Il servizio restituisce un raster del terreno, senza edifici e vegetazione. La risoluzione nativa è 5 m; l'esportazione geografica contiene 401 × 357 pixel.

Acquisizione ripetibile: `.github/workflows/city-dtm.yml` esegue `scripts/fetch-city-dtm.mjs`, con massimo otto richieste e dimensioni limitate, e conserva un artifact da revisionare. Il workflow ha solo `contents: read`: non scrive rami, non aggiorna il raster pubblico e non attiva nuovi dati nel gioco automaticamente. Il decodificatore GeoTIFF 2.1.3 resta una dipendenza dell'acquisizione offline.

`vertical-reference-review.json` documenta il supporto alla scala in metri attraverso il capitolato regionale e la specifica INTESA GIS prescritta. Il servizio non dichiara l'unità verticale della banda né il datum verticale. L'integrazione usa solo differenze locali, sottraendo il valore campionato sulla strada iniziale di Via Partenope: circa **4,132 m nelle unità della fonte**. Non vengono dichiarate quote certificate sul livello del mare, EGM96, ellissoidiche o ortometriche. Due decimali nel JSON non significano precisione centimetrica; la specifica indica un ordine di precisione verticale di circa 1 m.

`relative-grid.json` aggiunge queste dichiarazioni al raster JSON, senza alterare i campioni. La copia distribuita con il sito è `public/data/city-elevation.json`. Gli zeri marcati noData nell'esportazione sono `null`, mai quote di terra sintetiche.

La politica di costruzione della superficie distingue tre casi:

| Caso | Risultato | Stato |
| --- | --- | --- |
| Quattro campioni validi contribuiscono all'interpolazione bilineare | Differenza di quota dalla strada iniziale | Fonte raster |
| La costa esatta cade in noData, ma un pixel originale valido dista al massimo 10 m | Quota relativa del pixel originale più vicino | Estensione stimata, distanza registrata |
| Nessun pixel originale valido entro 10 m | Precedente piano locale a quota 0 | Area non misurata, mantenuta piatta |

Non viene usata un'interpolazione a lunga distanza. Il piano dell'acqua usa lo zero nativo meno il riferimento iniziale esclusivamente come scelta artistica, senza dichiararlo livello del mare misurato.

La mesh mantiene le sagome originali di terra, i buchi d'acqua e la costa OSM. I bordi condivisi vengono raffinati insieme, fino a 20 m; i vecchi tappi orizzontali sono sostituiti, mentre i bordi verticali seguono le stesse frontiere. La superficie renderizzata fornisce le quote baricentriche per strade, piedi, auto, alberi e arredi. Le strade aggiungono sezioni al massimo ogni 5 m lungo gli stessi segmenti sorgente. I basamenti piatti degli edifici sono stimati dal terreno lungo il perimetro: non costituiscono un rilievo delle fondazioni.

Il DTM non risolve ogni gradino, ponte, cordolo o muro; terreno 2020 e oggetti OSM 2026 possono differire. Il rilievo SRTM distante ha un riferimento separato: la sua traslazione nella scena è un allineamento artistico, non una trasformazione certificata fra datum.

Verifica locale: `npm run typecheck` e `npm test`. I test controllano noData e limiti di estensione, costa e buchi, interpolazione dei triangoli realmente renderizzati, intero percorso reale e assetto dell'auto sui pendii. Il rendering WebGL e la pubblicazione rimangono nel workflow GitHub del progetto.
