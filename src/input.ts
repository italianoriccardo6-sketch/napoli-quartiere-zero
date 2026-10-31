const CONTROL_CODES=new Set(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft','ShiftRight','KeyE','KeyR','Escape','Space']);
const KEY_FALLBACK:Record<string,string>={w:'KeyW',a:'KeyA',s:'KeyS',d:'KeyD',e:'KeyE',r:'KeyR',arrowup:'ArrowUp',arrowdown:'ArrowDown',arrowleft:'ArrowLeft',arrowright:'ArrowRight',shift:'ShiftLeft',escape:'Escape',esc:'Escape',' ':'Space',spacebar:'Space'};
function controlCode(event:KeyboardEvent):string|undefined {
  return CONTROL_CODES.has(event.code)?event.code:KEY_FALLBACK[event.key?.toLowerCase()];
}
function typingTarget(target:EventTarget|null):boolean {
  const element=target as HTMLElement|null;
  return !!element&&(element.isContentEditable||['INPUT','TEXTAREA','SELECT'].includes(element.tagName??'')||!!element.closest?.('[contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]'));
}
export class Input {
  keys=new Set<string>(); onInteract=()=>{};onRecover=()=>{};onPause=()=>{};onLook=(_x:number,_y:number)=>{};onBlur=()=>{};
  private locked=false;
  constructor(public canvas:HTMLCanvasElement){
    this.locked=document.pointerLockElement===canvas;
    addEventListener('keydown',e=>{
      const code=controlCode(e);
      if(!code||typingTarget(e.target)||e.metaKey||e.ctrlKey||e.altKey)return;
      if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(code))e.preventDefault();
      if(!e.repeat){if(code==='KeyE')this.onInteract();if(code==='KeyR')this.onRecover();if(code==='Escape')this.onPause();}
      this.keys.add(code);
    });
    // Always release a tracked key, including after focus moves into a form field.
    addEventListener('keyup',e=>{const code=controlCode(e);if(code)this.keys.delete(code);});
    addEventListener('blur',()=>{this.clear();this.onBlur();});
    document.addEventListener('visibilitychange',()=>{if(document.hidden){this.clear();this.onBlur();}});
    document.addEventListener('pointerlockchange',()=>{
      const next=document.pointerLockElement===canvas,lost=this.locked&&!next;this.locked=next;
      // Rejected/unsupported requests and other elements' lock events must not pause keyboard movement.
      if(lost){this.clear();this.onBlur();}
    });
    canvas.addEventListener('pointerdown',()=>canvas.focus({preventScroll:true}));
    addEventListener('mousemove',e=>{if(document.pointerLockElement===canvas)this.onLook(e.movementX,e.movementY);});
  }
  clear(){this.keys.clear();}
  axis(positive:string[],negative:string[]){return Number(positive.some(k=>this.keys.has(k)))-Number(negative.some(k=>this.keys.has(k)));}
  async lock(){
    this.canvas.focus({preventScroll:true});
    if(typeof this.canvas.requestPointerLock!=='function')return;
    try{await this.canvas.requestPointerLock();this.locked=document.pointerLockElement===this.canvas;}
    catch{/* Keyboard movement and the application's drag-to-look fallback remain usable. */}
  }
}
