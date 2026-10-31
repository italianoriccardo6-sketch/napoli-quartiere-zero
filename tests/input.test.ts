import test from 'node:test';import assert from 'node:assert/strict';import {Input} from '../src/input';

class Events {
  listeners=new Map<string,Array<(event:any)=>void>>();
  addEventListener=(name:string,listener:(event:any)=>void)=>{const list=this.listeners.get(name)??[];list.push(listener);this.listeners.set(name,list);};
  emit(name:string,event:any={}){for(const listener of this.listeners.get(name)??[])listener(event);}
}
function environment(t:{after:(fn:()=>void)=>void}){
  const window=new Events(),document=Object.assign(new Events(),{pointerLockElement:null as unknown,hidden:false,activeElement:null as unknown});
  let focuses=0;
  const canvas=Object.assign(new Events(),{focus:(_options?:FocusOptions)=>{focuses++;document.activeElement=canvas;},requestPointerLock:undefined as undefined|(()=>Promise<void>)});
  const previousAdd=Object.getOwnPropertyDescriptor(globalThis,'addEventListener'),previousDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'addEventListener',{configurable:true,value:window.addEventListener});Object.defineProperty(globalThis,'document',{configurable:true,value:document});
  t.after(()=>{if(previousAdd)Object.defineProperty(globalThis,'addEventListener',previousAdd);else delete(globalThis as any).addEventListener;if(previousDocument)Object.defineProperty(globalThis,'document',previousDocument);else delete(globalThis as any).document;});
  const input=new Input(canvas as unknown as HTMLCanvasElement);
  return {window,document,canvas,input,get focuses(){return focuses;}};
}
function key(code:string|undefined,keyText:string,target:unknown=null,extra:Record<string,unknown>={}){return {code,key:keyText,target,repeat:false,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},...extra};}

test('tastiera: codice fisico e fallback key funzionano senza pointer lock',t=>{
  const e=environment(t);e.window.emit('keydown',key('KeyW','z'));assert.equal(e.input.axis(['KeyW','ArrowUp'],['KeyS','ArrowDown']),1);e.window.emit('keyup',key('KeyW','z'));
  e.window.emit('keydown',key(undefined,'W'));assert.ok(e.input.keys.has('KeyW'));e.window.emit('keyup',key(undefined,'w'));assert.equal(e.input.keys.size,0);
  const arrow=key(undefined,'ArrowUp');e.window.emit('keydown',arrow);assert.equal(arrow.defaultPrevented,true);assert.equal(e.input.axis(['KeyW','ArrowUp'],['KeyS','ArrowDown']),1);
});
test('richieste mouse assenti o rifiutate non cancellano WASD né mettono in pausa',async t=>{
  const e=environment(t);let pauses=0;e.input.onBlur=()=>pauses++;e.window.emit('keydown',key('KeyW','w'));
  await e.input.lock();e.document.emit('pointerlockchange');assert.ok(e.input.keys.has('KeyW'));assert.equal(pauses,0);assert.equal(e.document.activeElement,e.canvas);
  e.canvas.requestPointerLock=async()=>{throw new Error('Request denied in embedded browser');};await e.input.lock();e.document.emit('pointerlockchange');assert.ok(e.input.keys.has('KeyW'));assert.equal(pauses,0);
});
test('perdita di un blocco mouse realmente acquisito cancella i tasti e richiede pausa una volta',t=>{
  const e=environment(t);let pauses=0;const looks:number[][]=[];e.input.onBlur=()=>pauses++;e.input.onLook=(x,y)=>looks.push([x,y]);
  e.document.pointerLockElement=e.canvas;e.document.emit('pointerlockchange');e.window.emit('keydown',key('KeyW','w'));e.window.emit('mousemove',{movementX:7,movementY:-3});assert.deepEqual(looks,[[7,-3]]);
  e.document.pointerLockElement=null;e.document.emit('pointerlockchange');assert.equal(e.input.keys.size,0);assert.equal(pauses,1);e.document.emit('pointerlockchange');e.document.pointerLockElement={};e.document.emit('pointerlockchange');assert.equal(pauses,1);
});
test('campi di testo e scorciatoie Mac non attivano movimento o interazioni',t=>{
  const e=environment(t);let interactions=0;e.input.onInteract=()=>interactions++;
  for(const target of [{tagName:'INPUT'},{tagName:'TEXTAREA'},{tagName:'SELECT'},{isContentEditable:true},{closest:()=>({})}]){e.window.emit('keydown',key('KeyE','e',target));e.window.emit('keydown',key('KeyW','w',target));}
  for(const modifier of ['metaKey','ctrlKey','altKey'])e.window.emit('keydown',key('KeyW','w',null,{[modifier]:true}));assert.equal(interactions,0);assert.equal(e.input.keys.size,0);
  e.window.emit('keydown',key('KeyW','w'));e.window.emit('keyup',key('KeyW','w',{tagName:'INPUT'}));assert.equal(e.input.keys.size,0);
  e.window.emit('keydown',key('KeyE','e'));e.window.emit('keydown',key('KeyE','e',null,{repeat:true}));assert.equal(interactions,1);
});
test('clic scena riprende focus; perdita focus o pagina nascosta svuota i controlli',t=>{
  const e=environment(t);let pauses=0;e.input.onBlur=()=>pauses++;e.canvas.emit('pointerdown');assert.equal(e.focuses,1);
  e.window.emit('keydown',key('KeyW','w'));e.window.emit('blur');assert.equal(e.input.keys.size,0);assert.equal(pauses,1);
  e.window.emit('keydown',key('KeyD','d'));e.document.hidden=true;e.document.emit('visibilitychange');assert.equal(e.input.keys.size,0);assert.equal(pauses,2);
});
