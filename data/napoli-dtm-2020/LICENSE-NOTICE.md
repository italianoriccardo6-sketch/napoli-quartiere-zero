# Regione Campania CTR2020 DTM

Source: https://geomaps.regione.campania.it/server/rest/services/DG5009/CTR2020_DTM5K_tif/ImageServer

Regione Campania publishes CTR, DBT and DTM updated to 2020 under Creative Commons Attribution 4.0: https://sit.regione.campania.it/carta-tecnica-regionale . This crop preserves raw source pixels in `napoli-dtm.tif`; JSON is reprojected/resampled and rounded to 0.01 source units. Rounding does not imply centimetre accuracy.

The game uses the supported metre scale documented in `vertical-reference-review.json`, with the opening street's sampled height subtracted. The vertical datum remains unknown: heights are local differences, not certified elevations above sea level. Coastal gaps may extend the nearest original pixel by at most 10 m and are marked estimated. Unsupported areas retain the earlier local flat baseline and are marked unmeasured. The water plane is an artistic native-zero reference, not a surveyed sea level.

`source.json` and `validation.json` preserve the status of the original acquisition, before this separate documentary review and relative integration.
