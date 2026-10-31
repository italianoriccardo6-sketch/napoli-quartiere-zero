export type MissionState='available'|'active'|'completed';
export interface Save { version:1; mission:MissionState; coins:number; volume:number; quality:'alta'|'bassa' }
export const SAVE_KEY='napoli-quartiere-zero-v1';
export const defaults=():Save=>({version:1,mission:'available',coins:0,volume:0.25,quality:'alta'});
export function decodeSave(raw:string|null):Save {
  try {
    const x=JSON.parse(raw??'null');
    if(!x||x.version!==1) return defaults();
    const base=defaults();
    return {...base,mission:['available','active','completed'].includes(x.mission)?x.mission:base.mission,
      coins:typeof x.coins==='number'&&Number.isSafeInteger(x.coins)&&x.coins>=0?Math.min(x.coins,999999):0,
      volume:typeof x.volume==='number'&&Number.isFinite(x.volume)?Math.max(0,Math.min(1,x.volume)):base.volume,
      quality:x.quality==='bassa'?'bassa':'alta'};
  } catch { return defaults(); }
}
export function loadSave():Save {try{return decodeSave(localStorage.getItem(SAVE_KEY));}catch{return defaults();}}
export function storeSave(save:Save):boolean {try{localStorage.setItem(SAVE_KEY,JSON.stringify(save));return true;}catch{return false;}}
