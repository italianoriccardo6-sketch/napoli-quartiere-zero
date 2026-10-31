import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {Canvas} from '@napi-rs/canvas';
import {updateHUD,validateGameUI} from '../src/ui';import {defaults} from '../src/save';import {initialStory,reduceStory,type StoryState} from '../src/story';import type {CityMapData} from '../src/city-data';import {PICKUP,DELIVERY} from '../src/mission';
const markup=readFileSync('index.html','utf8'),map=JSON.parse(readFileSync('public/data/map.json','utf8')) as CityMapData;
function fixture(html=markup){
  const canvas=new Canvas(210,210);
  const elements=new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],{textContent:'',innerHTML:'',classList:{toggle(){}},getContext:()=>canvas.getContext('2d')}]));
  return {elements,document:{getElementById:(id:string)=>elements.get(id)??null} as unknown as Document};
}
function withDocument<T>(doc:Document,fn:()=>T):T{
  const old=Object.getOwnPropertyDescriptor(globalThis,'document'),pickup=[...PICKUP],delivery=[...DELIVERY];Object.defineProperty(globalThis,'document',{configurable:true,value:doc});PICKUP.splice(0,2,...map.city!.pickup);DELIVERY.splice(0,2,...map.city!.delivery);
  try{return fn();}finally{if(old)Object.defineProperty(globalThis,'document',old);else Reflect.deleteProperty(globalThis,'document');PICKUP.splice(0,2,...pickup);DELIVERY.splice(0,2,...delivery);}
}
test('regressione: il markup pubblicato contiene tutti i controlli, incluso il nome strada',()=>{
  const f=fixture();validateGameUI(f.document);assert.ok(f.elements.has('world-note'));
});
test('regressione: un elemento strada mancante è rilevato prima del ciclo di gioco',()=>{
  const f=fixture(markup.replace('id="world-note"',''));
  assert.throws(()=>validateGameUI(f.document),(error:unknown)=>error instanceof Error&&JSON.stringify(error.cause).includes('world-note'));
});
test('regressione del blocco: il primo HUD e gli aggiornamenti successivi sulla città reale non lanciano eccezioni',()=>{
  const f=fixture();withDocument(f.document,()=>{
    validateGameUI();const p=map.city!.spawn,save=defaults();let ticks=0;
    for(let i=0;i<12;i++){updateHUD(save,p[0],p[1]+i*.1,0,false,0,'',map,initialStory());ticks++;}
    assert.equal(ticks,12);assert.match(f.elements.get('world-note')!.textContent,/NAPOLI/);assert.match(f.elements.get('distance')!.textContent,/m$/);
    assert.match(f.elements.get('objective')!.textContent,/Teresa/);
  });
});
test('HUD: cambio strada, guida e tutti gli stati del prologo mantengono l’interfaccia operativa',()=>{
  const f=fixture();withDocument(f.document,()=>{
    let story:StoryState=initialStory();const states=[story];for(const event of ['interact-bar','interact-quay','choose-protect','interact-bar'] as const){story=reduceStory(story,event);states.push(story);}
    for(const state of states)updateHUD(defaults(),map.city!.delivery[0],map.city!.delivery[1],Math.PI,true,5,'Scendi dal motorino',map,state);
    assert.equal(f.elements.get('mission-phase')!.textContent,'PROLOGO COMPLETATO');assert.equal(f.elements.get('coins')!.textContent,'25');assert.equal(f.elements.get('speed')!.textContent,'18 km/h');assert.match(f.elements.get('hint')!.innerHTML,/Scendi/);
  });
});
