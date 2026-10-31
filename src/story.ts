import { DELIVERY, PICKUP } from './mission';

/** Original game fiction. These interactions do not claim geographic fidelity. */
export const STORY_SAVE_KEY = 'napoli-quartiere-zero-story-v1';
export type StoryPhase = 'available' | 'carrying' | 'return' | 'completed';
export type StoryChoice = 'protect' | 'negotiate';
export type StoryEvent = 'interact-bar' | 'interact-quay' | 'choose-protect' | 'choose-negotiate';
export interface StoryState {
  version: 1;
  phase: StoryPhase;
  choice: StoryChoice | null;
  /** This prologue's reward only; separate from any legacy mission balance. */
  coins: number;
}
export interface StoryLine { speaker: string; text: string }
export const STORY_TITLE = 'A nome di tua sorella';
export const STORY_REWARDS: Readonly<Record<StoryChoice, number>> = Object.freeze({ protect: 25, negotiate: 75 });

export function initialStory(): StoryState {
  return { version: 1, phase: 'available', choice: null, coins: 0 };
}

/** Choices remain pending until the player returns to the bar and interacts. */
export function reduceStory(state: StoryState, event: StoryEvent): StoryState {
  if (state.phase === 'completed') return state;
  if (state.phase === 'available' && event === 'interact-bar') {
    return { ...state, phase: 'carrying' };
  }
  if (state.phase === 'carrying' && event === 'interact-quay') {
    return { ...state, phase: 'return' };
  }
  if (state.phase === 'return') {
    if (event === 'choose-protect') return { ...state, choice: 'protect' };
    if (event === 'choose-negotiate') return { ...state, choice: 'negotiate' };
    if (event === 'interact-bar' && state.choice) {
      return { ...state, phase: 'completed', coins: STORY_REWARDS[state.choice] };
    }
  }
  return state;
}

/** Restore only coherent versioned states, including an exactly-once reward. */
export function decodeStory(raw: string | null): StoryState {
  try {
    const value: unknown = JSON.parse(raw ?? 'null');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return initialStory();
    const x = value as Record<string, unknown>;
    if (x.version !== 1 || typeof x.phase !== 'string' || !['available', 'carrying', 'return', 'completed'].includes(x.phase)) return initialStory();
    if (x.choice !== null && x.choice !== 'protect' && x.choice !== 'negotiate') return initialStory();
    if ((x.phase === 'available' || x.phase === 'carrying') && x.choice !== null) return initialStory();
    if (x.phase === 'completed' && x.choice === null) return initialStory();
    const expectedCoins = x.phase === 'completed' ? STORY_REWARDS[x.choice as StoryChoice] : 0;
    if (x.coins !== expectedCoins) return initialStory();
    return { version: 1, phase: x.phase as StoryPhase, choice: x.choice as StoryChoice | null, coins: expectedCoins };
  } catch {
    return initialStory();
  }
}

export function storyDestination(state: StoryState): [number, number] | null {
  if (state.phase === 'completed') return null;
  return [...(state.phase === 'carrying' ? DELIVERY : PICKUP)];
}

export function storyObjective(state: StoryState): string {
  switch (state.phase) {
    case 'available': return 'Raggiungi Teresa al bar: tua sorella Ada ha lasciato qualcosa per te.';
    case 'carrying': return 'Porta il telefono di Ada alla banchina e incontra il suo contatto.';
    case 'return': return state.choice
      ? 'Torna da Teresa e conferma la tua decisione al bar.'
      : 'Scegli di chi fidarti, poi torna al bar: il contatto non si è presentato.';
    case 'completed': return state.choice === 'protect'
      ? 'Prova al sicuro. Nora è il tuo nuovo contatto: Ada non è sola.'
      : 'Trattativa aperta. L’intermediario ti richiamerà: ora sei coinvolto.';
  }
}

export function storyContact(state: StoryState): string | null {
  if (state.phase !== 'completed') return null;
  return state.choice === 'protect' ? 'Nora Lenti · giornalista' : 'L’intermediario · numero sconosciuto';
}

export function storyDialogue(state: StoryState): StoryLine[] {
  switch (state.phase) {
    case 'available': return [
      { speaker: 'Teresa', text: 'Luca, tua sorella è passata prima del turno. Mi ha lasciato una custodia. Ha detto di darla soltanto a te.' },
      { speaker: 'Luca', text: 'Ada non mi risponde. Che cosa c’è dentro?' },
    ];
    case 'carrying': return [
      { speaker: 'Teresa', text: 'Il suo telefono. Lo schermo è rotto, ma si accende ancora. Qualcuno la cercava.' },
      { speaker: 'Ada · messaggio salvato', text: 'Luca, vai alla banchina. Se arriva Nora, dalle il telefono. Non farlo vedere a nessun altro.' },
    ];
    case 'return': return [
      { speaker: 'Luca', text: 'Nora non c’è. Sul telefono c’è il video di un’aggressione. Ada ha ripreso anche chi dava gli ordini.' },
      { speaker: 'Numero sconosciuto', text: 'Hai una cosa che non ti appartiene. Possiamo pagarla. Torna dove l’hai presa e decidi.' },
      { speaker: 'Nora · messaggio', text: 'Ada mi aveva contattata. Conserva la prova. Teresa sa come trovarmi.' },
    ];
    case 'completed': return state.choice === 'protect' ? [
      { speaker: 'Luca', text: 'Il telefono resta con noi. Chiama Nora: prima scopriamo dove si trova Ada.' },
      { speaker: 'Teresa', text: 'Ti metto in contatto. E tieni questi per la benzina: stasera ti servirà.' },
    ] : [
      { speaker: 'Luca', text: 'Fisso un incontro. Il telefono lo tengo io finché non mi dicono dov’è Ada.' },
      { speaker: 'Numero sconosciuto', text: 'L’anticipo è arrivato. Adesso rispondi quando chiamiamo.' },
    ];
  }
}
