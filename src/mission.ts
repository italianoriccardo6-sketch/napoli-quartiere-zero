import type { Save } from './save';
export const PICKUP:[number,number]=[27,59];
export const DELIVERY:[number,number]=[47,-47];
export function interactMission(save:Save,at:'bar'|'delivery'):Save {
  if(save.mission==='available'&&at==='bar') return {...save,mission:'active'};
  if(save.mission==='active'&&at==='delivery') return {...save,mission:'completed',coins:save.coins+25};
  return save;
}
export function target(save:Save):[number,number] { return save.mission==='active'?DELIVERY:PICKUP; }
