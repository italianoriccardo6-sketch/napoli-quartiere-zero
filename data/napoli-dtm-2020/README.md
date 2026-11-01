# Dislivelli relativi di Napoli

Fonte: **Regione Campania, CTR2020 DTM5K, 2020**, CC BY 4.0. Il TIFF originale, la risposta di esportazione e i metadati del servizio sono conservati in questa cartella. Il servizio restituisce un raster del terreno, senza edifici e vegetazione. La risoluzione nativa è 5 m; l'esportazione geografica contiene 401 × 357 pixel.

Acquisizione ripetibile: `.github/workflows/city-dtm.yml` esegue `scripts/fetch-city-dtm.mjs`, con massimo otto richieste e dimensioni limitate, e conserva un artifact da revisionare. Il workflow ha solo `contents: read`: non scrive rami, non aggiorna il raster pubblico e non attiva nuovi dati nel gioco automaticamente. Il decodificatore GeoTIFF 2.1.3 resta una dipendenza dell'acquisizione offline.

`vertical-reference-review.json` documenta il supporto alla scala in metri attraverso il capitolato regionale e la specifica INTESA GIS prescritta. Il servizio non dichiara l'unità verticale della banda né il datum verticale. L'integrazione usa solo differenze locali, sottraendo il valore campionato sulla strada iniziale di Via Partenope: circa **4,528 m nelle unità della fonte**, sul tratto OSM carrabile `residential` (punto locale circa `[45.170, 194.865]`). Non vengono dichiarate quote certificate sul livello del mare, EGM96, ellissoidiche o ortometriche. Due decimali nel JSON non significano precisione centimetrica; la specifica indica un ordine di precisione verticale di circa 1 m.

`relative-grid.json` aggiunge queste dichiarazioni al raster JSON, senza alterare i campioni. La copia distribuita con il sito è `public/data/city-elevation.json`. Gli zeri marcati noData nell'esportazione sono `null`, mai quote di terra sintetiche.

La politica di costruzione della superficie distingue tre casi:

| Caso | Risultato | Stato |
| --- | --- | --- |
| Quattro campioni validi contribuiscono all'interpolazione bilineare | Differenza di quota dalla strada iniziale | Fonte raster |
| La costa esatta cade in noData, ma un pixel originale valido dista al massimo 10 m | Quota relativa del pixel originale più vicino | Estensione stimata, distanza registrata |
| Nessun pixel originale valido entro 10 m | Precedente piano locale a quota 0 | Area non misurata, mantenuta piatta |

Non viene usata un'interpolazione a lunga distanza. Il piano dell'acqua usa lo zero nativo meno il riferimento iniziale esclusivamente come scelta artistica, senza dichiararlo livello del mare misurato.

La mesh mantiene le sagome originali di terra, i buchi d'acqua e la costa OSM. I bordi condivisi vengono raffinati insieme, fino a 20 m, con raffinamento adattivo a 5 m richiesto solo dove la fonte bilineare è valida e il gradiente supera 0,6 oppure lo scarto al punto medio supera 0,75 m; la chiusura sui bordi più lunghi dei triangoli adiacenti mantiene la qualità senza fessure e può suddividere anche un bordo confinante stimato, che conserva il proprio stato di stima. I vecchi tappi orizzontali sono sostituiti, mentre i bordi verticali seguono le stesse frontiere. La superficie renderizzata fornisce le quote baricentriche per strade, piedi, auto, alberi e arredi. Le strade aggiungono sezioni al massimo ogni 5 m lungo gli stessi segmenti sorgente; asfalto, pavimentazioni, vernice e profili dei cordoli sono poi ritagliati sui triangoli del terreno, conservando UV e altezze locali dei profili. Le superfici seguono così anche le pieghe interne, senza intersecare il terreno fra i vertici. I basamenti piatti degli edifici sono stimati dal terreno lungo il perimetro: non costituiscono un rilievo delle fondazioni.

Il DTM non risolve ogni gradino, ponte, cordolo o muro; terreno 2020 e oggetti OSM 2026 possono differire. Il rilievo SRTM distante ha un riferimento separato: la sua traslazione nella scena è un allineamento artistico, non una trasformazione certificata fra datum.

Verifica locale: `npm run typecheck` e `npm test`. I test controllano noData e limiti di estensione, costa e buchi, interpolazione dei triangoli realmente renderizzati, intero percorso reale e assetto dell'auto sui pendii. Il rendering WebGL e la pubblicazione rimangono nel workflow GitHub del progetto.

Il terreno ripido oltre 45° usa la pietra fotografica generica già presente nel progetto, con proiezione UV verticale. Le altre facce mantengono la pavimentazione. Questa classificazione è artistica e non identifica materiali geologici misurati; non sposta i vertici né il campo delle altezze. Il test su 3.111 punti del pendio di Monte Echia confronta la superficie con il raster: errore medio da circa 0,534 a 0,082 m e massimo da 6,402 a 0,943 m. Questi sono scarti di approssimazione della mesh, non certificazioni di precisione del rilievo.

Le altezze di soli edifici già marcati come stima possono adattarsi al dislivello del proprio perimetro, con supporto bilineare completo ogni 5 m, almeno 3,2 m di copertura artistica sopra il punto più alto e limite di 60 m. Il dato originale resta immutato. Le altezze note da tag/livelli e gli edifici con supporto incompleto non vengono alzati. I metadati registrano ogni modifica come stima visiva, mai come misura di tetti o fondazioni.
