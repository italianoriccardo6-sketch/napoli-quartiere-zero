import test from 'node:test';
import assert from 'node:assert/strict';
import { DELIVERY, PICKUP } from '../src/mission';
import { initialStory, reduceStory, decodeStory, storyDestination, storyContact, STORY_REWARDS, type StoryChoice } from '../src/story';

test('prologo: richiede ritiro, banchina, scelta e ritorno al bar', () => {
  const initial = initialStory();
  assert.equal(reduceStory(initial, 'interact-quay'), initial);
  assert.equal(reduceStory(initial, 'choose-negotiate'), initial);
  assert.deepEqual(storyDestination(initial), PICKUP);
  const carrying = reduceStory(initial, 'interact-bar');
  assert.equal(carrying.phase, 'carrying');
  assert.deepEqual(storyDestination(carrying), DELIVERY);
  assert.equal(reduceStory(carrying, 'interact-bar'), carrying);
  assert.equal(reduceStory(carrying, 'choose-protect'), carrying);
  const returning = reduceStory(carrying, 'interact-quay');
  assert.equal(returning.phase, 'return');
  assert.deepEqual(storyDestination(returning), PICKUP);
  assert.equal(reduceStory(returning, 'interact-bar'), returning);
  const chosen = reduceStory(returning, 'choose-protect');
  assert.equal(chosen.phase, 'return');
  assert.equal(chosen.coins, 0);
  assert.equal(storyContact(chosen), null);
  assert.equal(reduceStory(chosen, 'interact-bar').phase, 'completed');
});

test('due finali: contatti e ricompense distinti, assegnati una sola volta', () => {
  const endings = (['protect', 'negotiate'] as StoryChoice[]).map(choice => {
    let state = reduceStory(reduceStory(initialStory(), 'interact-bar'), 'interact-quay');
    state = reduceStory(state, choice === 'protect' ? 'choose-protect' : 'choose-negotiate');
    state = reduceStory(state, 'interact-bar');
    assert.equal(state.coins, STORY_REWARDS[choice]);
    assert.equal(storyDestination(state), null);
    for (const event of ['interact-bar', 'interact-quay', 'choose-protect', 'choose-negotiate'] as const) assert.equal(reduceStory(state, event), state);
    assert.deepEqual(decodeStory(JSON.stringify(state)), state);
    return state;
  });
  assert.notEqual(endings[0].coins, endings[1].coins);
  assert.notEqual(storyContact(endings[0]), storyContact(endings[1]));
});

test('ripristino: stato intermedio valido, scelta modificabile fino alla conferma', () => {
  let state = reduceStory(reduceStory(initialStory(), 'interact-bar'), 'interact-quay');
  state = reduceStory(state, 'choose-negotiate');
  state = decodeStory(JSON.stringify(state));
  state = reduceStory(state, 'choose-protect');
  assert.equal(state.choice, 'protect');
  assert.equal(reduceStory(state, 'interact-bar').coins, STORY_REWARDS.protect);
});

test('salvataggi corrotti o incoerenti ripartono dal prologo senza accreditare premi', () => {
  for (const raw of [null, '{', 'null', '[]', '{}', '{"version":2}',
    '{"version":1,"phase":"completed","choice":null,"coins":75}',
    '{"version":1,"phase":"carrying","choice":"protect","coins":0}',
    '{"version":1,"phase":"return","choice":null,"coins":75}',
    '{"version":1,"phase":"completed","choice":"protect","coins":999999}',
    '{"version":1,"phase":"fake","choice":null,"coins":0}',
    '{"version":1,"phase":["available"],"choice":null,"coins":0}']) assert.deepEqual(decodeStory(raw), initialStory());
});

test('la destinazione restituita non permette di modificare le coordinate condivise', () => {
  const position = storyDestination(initialStory())!;
  position[0] = 123456;
  assert.deepEqual(storyDestination(initialStory()), PICKUP);
});
