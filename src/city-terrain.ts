import type {CityRuntime} from './city-data';
import {parseCityElevationGrid} from './city-elevation';
import {createCityTerrainPolicy} from './city-terrain-policy';
import {openingStreetData} from './vehicle-placement';

/** Shared source loading for the playable scene and direct-engine frame capture. */
export async function loadCityTerrain(city:CityRuntime){
  const response=await fetch(`${import.meta.env?.BASE_URL??'/'}data/city-elevation.json`);
  if(!response.ok)throw new Error('I dislivelli di Napoli non sono disponibili. Ricarica la pagina.');
  const grid=parseCityElevationGrid(await response.json());
  return createCityTerrainPolicy(grid,openingStreetData(city).scooter);
}
