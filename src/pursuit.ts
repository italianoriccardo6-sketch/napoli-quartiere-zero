export type PursuitIncident='collision'|'assault'|'mission';
export type PursuitEvent='alert'|'searching'|'escaped'|'caught';
export interface PursuitState {heat:number;level:0|1|2|3;mode:'clear'|'pursuit'|'search';unseenSeconds:number;captureSeconds:number;escapes:number;captures:number}
const level=(heat:number):0|1|2|3=>heat<=0?0:heat<45?1:heat<80?2:3;
/** Fictional game rules, independent from real police locations or procedures. */
export function createPursuitController(onEvent:(event:PursuitEvent,state:Readonly<PursuitState>)=>void=()=>{}){
  const state:PursuitState={heat:0,level:0,mode:'clear',unseenSeconds:0,captureSeconds:0,escapes:0,captures:0};
  function reportIncident(incident:PursuitIncident){
    if(!['collision','assault','mission'].includes(incident))throw Error('Invalid pursuit incident.');
    state.heat=Math.min(100,state.heat+({collision:30,assault:60,mission:45}[incident]));state.level=level(state.heat);state.mode='pursuit';state.unseenSeconds=0;state.captureSeconds=0;onEvent('alert',state);
  }
  function update(dt:number,input:{nearestPatrol:number;visible:boolean;playerSpeed:number}){
    if(!Number.isFinite(dt)||dt<=0||dt>.25||(!Number.isFinite(input.nearestPatrol)&&input.nearestPatrol!==Infinity)||input.nearestPatrol<0||!Number.isFinite(input.playerSpeed))return;
    if(state.mode==='clear')return;
    if(input.visible){state.unseenSeconds=0;if(state.mode==='search')state.mode='pursuit';}
    else{
      state.unseenSeconds+=dt;
      if(state.unseenSeconds>=4&&state.mode==='pursuit'){state.mode='search';onEvent('searching',state);}
      if(state.unseenSeconds>10)state.heat=Math.max(0,state.heat-dt*5);
    }
    state.captureSeconds=input.visible&&input.nearestPatrol<7&&Math.abs(input.playerSpeed)<1.2?state.captureSeconds+dt:Math.max(0,state.captureSeconds-dt*2);
    state.level=level(state.heat);
    if(state.captureSeconds>=6){state.heat=0;state.level=0;state.mode='clear';state.captureSeconds=0;state.captures++;onEvent('caught',state);}
    else if(state.heat<=0){state.mode='clear';state.level=0;state.unseenSeconds=0;state.escapes++;onEvent('escaped',state);}
  }
  function reset(){state.heat=0;state.level=0;state.mode='clear';state.unseenSeconds=0;state.captureSeconds=0;}
  return {state,reportIncident,update,reset};
}
