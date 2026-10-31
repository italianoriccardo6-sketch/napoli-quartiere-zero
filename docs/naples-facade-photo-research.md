# Authentic Naples facade sources and implementation

The source photographs were acquired without pixel changes by [workflow41252554808](https://github.com/italianoriccardo6-sketch/napoli-quartiere-zero/actions/runs/41252554808). Original bytes, current Commons image metadata, author/license URLs, SHA-1 and SHA-256 are preserved on branch `data/naples-facade-photos-41252554808`, commit `92e56edb00b3bf935b29afa23806415c8fd02f61`.

The two implemented fronts use [DimiTalen's 8July2010 photograph](https://commons.wikimedia.org/wiki/File:View_of_Via_Partenope_and_the_marina_from_Castel_dell%27Ovo,_Naples,_2010.jpg), explicitly released under CC0. Its2939×1954 original has SHA-256 `63d316b36f987dbb39e0b96d0a88518d80eac76b94baa9e099ecec7f9defced6`. Native wall widths are approximately440px and640px; these are not2k facade textures. The photo is not evidence of the current2026 condition or measured facade dimensions.

| Front | Active OSM identity | Source wall edges | Native pixel corners TL,TR,BR,BL | Observed image layout |
|---|---|---|---|---|
| RoyalContinental modern wing | `relation/4779351:1`, named HotelRoyalContinental in source |29→0 |[95,683],[537,694],[537,1109],[84,1118] |Approximately10bays,9regular glazed strips, short top band, ground lobby |
| GrandHotelVesuvio |`way/337012555:0` |20→21→22→23 |[538,738],[1177,745],[1178,1107],[538,1112] |13bays:7central arched stacks and3rectangular stacks each side.4balcony rows, square-window row, upper loggia,2stone base levels |

Vesuvio identity is independently supported by the [hotel's own contact page](https://www.vesuvio.it/contatti/), which links its ViaPartenope45 address to coordinates40.830084,14.2481853. That point falls inside `way/337012555:0` after the application's actual geographic transform. The named RoyalContinental multipolygon supplies the other identity. Their existing OSM heights remain25.6m and28.8m respectively; footprints, courtyards, terrain and colliders are unchanged.

Pixel corners were visually estimated from the downloaded original, approximately±5–10px. `naples-facades.ts` maps a homography onto subdivided actual OSM wall segments, offset4cm outward. It omits the lowest1.4m to avoid projecting foreground traffic onto the wall. Original image bytes remain intact. Geometry rejects future footprint endpoint changes instead of silently applying a photo to another wall. This is manual image alignment, not photogrammetry or a survey.

The modern front gains a10×9 glass grid, top-band glass and white masonry beams. Vesuvio gains28arched glass windows, matching semicircular balcony slabs/rails, rectangular wing windows/balconies, and a square-window row. Glass is reflective PBR; facade color and weathering come from the actual photo. Window/depth calibration remains inferred from the photograph. Detailed geometry totals122parts forRoyal and1337forVesuvio, batched by primitive/material. Generic shutters are excluded for these two buildings so they cannot obscure the observed architecture.

Other inspected originals are retained for research:

- [MisterNo's Vesuvio photograph](https://commons.wikimedia.org/wiki/File:Grande_Albergo_Vesuvio_-_panoramio.jpg),13September2015,CCBY3.0,1600×1200: good daylight architecture reference, below2k.
- [Baku's PalazzoSantaLucia photograph](https://commons.wikimedia.org/wiki/File:SereRegioneCampaniaS.Lucia.jpg),16July2021,CCBY-SA4.0,4032×1908: close oblique/cropped facade, with wires/poles/trees. Not used as a whole-wall texture. Any adaptation must retain applicable ShareAlike attribution/license.
- [AngeloDeSantis's Excelsior photograph](https://commons.wikimedia.org/wiki/File:Hotel_Excelsior_(8639643491).jpg),4October2012,CCBY2.0,2400×1456: blue-hour upper-wall closeup; rejected for the current daytime albedo.

No adequate currentRoyalContinental-specific2kCCphoto or freely downloadable verified photogrammetry model was established. The complete waterfront photograph is never used as a skyline or city billboard. Actual GPU orientation, glare, camera appearance and shadowing still require the shared render QA; NullEngine tests establish geometry and lifecycle behavior only.
