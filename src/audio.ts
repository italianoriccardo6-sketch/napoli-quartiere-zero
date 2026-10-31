// Original synthesized ambient tone. No samples or external audio assets.
export class Audio {
  context:AudioContext|null=null;gain:GainNode|null=null;osc:OscillatorNode|null=null;
  start(){if(this.context){void this.context.resume();return;}try{this.context=new AudioContext();this.gain=this.context.createGain();this.gain.gain.value=0;this.gain.connect(this.context.destination);this.osc=this.context.createOscillator();this.osc.type='sine';this.osc.frequency.value=58;this.osc.connect(this.gain);this.osc.start();}catch{}}
  update(volume:number,riding:boolean,speed:number,paused:boolean){if(!this.context||!this.gain||!this.osc)return;this.gain.gain.setTargetAtTime(paused?0:volume*(riding?.035:.006),this.context.currentTime,.1);this.osc.frequency.setTargetAtTime(riding?55+Math.abs(speed)*8:58,this.context.currentTime,.1);}
}
