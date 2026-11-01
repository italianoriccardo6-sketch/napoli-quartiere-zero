/** Optional browser speech; the browser voice may be local or remote. No voice service account is configured here. */
export function createNarration(){
  let enabled=false;
  const available=typeof speechSynthesis!=='undefined'&&typeof SpeechSynthesisUtterance!=='undefined';
  function stop(){if(available)speechSynthesis.cancel();}
  return{available,get enabled(){return enabled;},setEnabled(value:boolean){enabled=value&&available;if(!enabled)stop();},stop,
    speak(speaker:string,text:string){if(!enabled||!available)return;stop();const line=new SpeechSynthesisUtterance(`${speaker}. ${text}`);line.lang='it-IT';line.rate=.98;const voice=speechSynthesis.getVoices().find(v=>v.lang.toLowerCase().startsWith('it'));if(voice)line.voice=voice;speechSynthesis.speak(line);}};
}
