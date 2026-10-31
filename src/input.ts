export class Input {
  keys=new Set<string>(); onInteract=()=>{};onRecover=()=>{};onPause=()=>{};onLook=(_x:number,_y:number)=>{};onBlur=()=>{};
  constructor(public canvas:HTMLCanvasElement){
    addEventListener('keydown',e=>{
      if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code))e.preventDefault();
      if(!e.repeat){if(e.code==='KeyE')this.onInteract();if(e.code==='KeyR')this.onRecover();if(e.code==='Escape')this.onPause();}
      this.keys.add(e.code);
    });
    addEventListener('keyup',e=>this.keys.delete(e.code));
    addEventListener('blur',()=>{this.clear();this.onBlur();});
    document.addEventListener('visibilitychange',()=>{if(document.hidden){this.clear();this.onBlur();}});
    document.addEventListener('pointerlockchange',()=>{if(!document.pointerLockElement){this.clear();this.onBlur();}});
    addEventListener('mousemove',e=>{if(document.pointerLockElement===canvas)this.onLook(e.movementX,e.movementY);});
  }
  clear(){this.keys.clear();}
  axis(positive:string[],negative:string[]){return Number(positive.some(k=>this.keys.has(k)))-Number(negative.some(k=>this.keys.has(k)));}
  async lock(){try{await this.canvas.requestPointerLock();}catch{/* The click-and-drag fallback remains available. */}}
}
