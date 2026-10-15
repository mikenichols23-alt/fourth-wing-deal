// Monopoly Deal: Fourth Wing Edition — official card definitions.
// Verified from photos of the real cards (2026-10-14). 106 playable cards
// + 5 signets + 5 reference cards = 116 total, per the Hasbro rulebook.
// Shared by server (require) and client (script tag).

const SETS = [
  { id: 'darkblue',  name: 'Dark Blue',   size: 2, value: 4, rent: [3, 8],       color: '#1f2f6e', glow: '#8a9ae0',
    cards: ['Athebyne Outpost', 'Aretia'] },
  { id: 'darkgreen', name: 'Green',  size: 3, value: 4, rent: [2, 4, 7],    color: '#1e4d2b', glow: '#7fc48a',
    cards: ['The Flight Field', 'The Threshing Field', 'The Gauntlet'] },
  { id: 'red',       name: 'Red',         size: 3, value: 3, rent: [2, 3, 6],    color: '#c22f2f', glow: '#f08a8a',
    cards: ['The Archives', 'The Healer Quadrant', "General Sorrengail's Office"] },
  { id: 'yellow',    name: 'Yellow',      size: 3, value: 3, rent: [2, 4, 6],    color: '#c9a91c', glow: '#f0dd8a',
    cards: ["Liam's Room", "Xaden's Room", "Violet's Room"] },
  { id: 'orange',    name: 'Orange',      size: 3, value: 2, rent: [1, 3, 5],    color: '#e07b1f', glow: '#f5bd7f',
    cards: ['The Gym', 'The Sparring Mats', 'The Challenge Board'] },
  { id: 'pink',      name: 'Pink',        size: 3, value: 2, rent: [1, 2, 4],    color: '#c2438a', glow: '#f0a8cc',
    cards: ["Carr's Classroom", 'Battle Brief', "Kaori's Classroom"] },
  { id: 'lightblue', name: 'Light Blue',  size: 3, value: 1, rent: [1, 2, 3],    color: '#4a90c2', glow: '#a8d4f0',
    cards: ['First-Year Dorms', 'Gathering Hall', 'Dragon Rotunda'] },
  { id: 'brown',     name: 'Brown',       size: 2, value: 1, rent: [1, 2],       color: '#7b4a21', glow: '#d8a05f',
    cards: ['The Parapet', 'Riders Quadrant Courtyard'] },
  { id: 'black',     name: 'Black',       size: 4, value: 2, rent: [1, 2, 3, 4], color: '#2a2a2a', glow: '#909090',
    cards: ['Feirge', 'Andarna', 'Tairn', 'Sgaeyl'] },
  { id: 'lightgreen', name: 'Teal', size: 2, value: 2, rent: [1, 2],      color: '#a2d1cf', glow: '#d4ecea',
    cards: ["Raegan's House", 'Montserrat'] },
];

const SET_BY_ID = Object.fromEntries(SETS.map(s => [s.id, s]));

// [setA, setB, value, copies]
const DUAL_WILDS = [
  ['red', 'yellow', 3, 2],
  ['pink', 'orange', 2, 2],
  ['darkblue', 'darkgreen', 4, 1],
  ['lightblue', 'brown', 1, 1],
  ['darkgreen', 'lightgreen', 4, 1],
  ['black', 'lightgreen', 2, 1],
  ['black', 'lightblue', 4, 1],
];

// Challenge cards: 2 copies of each color pairing.
const RENT_PAIRS = [
  ['pink', 'orange'], ['red', 'yellow'], ['brown', 'lightblue'],
  ['darkblue', 'darkgreen'], ['lightgreen', 'black'],
];

// The five official signets, transcribed from the real cards.
const SIGNETS = [
  { id: 'shadow', name: 'Shadow Wielding',
    text: 'On your turn, draw 3 cards instead of 2.',
    desc: 'Darkness gathers. A deeper draw.' },
  { id: 'mending', name: 'Mending',
    text: 'On your turn, you may give another rider one of your cards. If you do, draw 4 cards instead of 2.',
    desc: 'Give to heal. Draw deep in return.' },
  { id: 'foresight', name: 'Battle Foresight',
    text: 'On your turn, draw 3 cards. Choose 2 to keep and return 1 to the top of the deck.',
    desc: 'See the fight before it happens.' },
  { id: 'lightning', name: 'Lightning Wielding',
    text: 'You may use this card as an every-color wild property. Placing it does not count as a play. If the set is stolen, you keep this card.',
    desc: 'The sky itself, wild and unbound.' },
  { id: 'distance', name: 'Distance Wielding',
    text: 'On your turn, you may play 4 cards instead of 3.',
    desc: 'Space bends. Act once more.' },
];

const ACTIONS = {
  dragonscale:   { name: 'Dragonscale Armor', count: 4,  text: 'Cancel an action card played against you.' },
  tairn_wisdom:  { name: "Tairn's Wisdom",    count: 10, text: 'Draw 2 cards.' },
  dragons_fire:  { name: "Dragon's Fire",     count: 3,  text: 'Take any one property from a rider and place it in the discard pile. You may not take a property that is part of a complete set.' },
  leighorrel:    { name: 'Leighorrel Mushrooms', count: 3, text: "Swap any one of your property cards with any one of another rider's property cards. You may not take a property that is part of a complete set." },
  dagger_acro:  { name: 'Dagger Acrobatics', count: 3,  text: 'Steal one property card from any rider and place it in front of you. You may not steal a property that is part of a complete set.' },
  double_relics:{ name: 'Double Relics',     count: 3,  text: 'Choose any color. Collect blades equal to the number of properties you have in that color from each rider.' },
  memory_reading:{ name: 'Memory Reading',    count: 3,  text: 'Collect 5 blades from any rider.' },
  search_arch:   { name: 'Search the Archives', count: 2, text: 'Take any one card from the discard pile and place it in front of you as part of a property set, or in your armory.' },
  time_stopping: { name: "Andarna's Time Stopping", count: 2, text: "Place on any rider's signet card to stop their signet ability. That rider must discard 10 blades to reverse the action." },
  outsmart:      { name: 'Outsmart',          count: 2,  text: 'Steal a complete property set from any rider.' },
  fonilee:       { name: 'Fonilee Berries',   count: 2,  text: 'Collect 2 blades from each rider.' },
};

const BLADE_DENOMS = [[1, 6], [2, 5], [3, 3], [4, 3], [5, 2], [10, 1]];

function buildDeck() {
  const deck = [];
  let n = 0;
  const id = () => 'c' + (n++);
  for (const s of SETS)
    for (const cname of s.cards)
      deck.push({ id: id(), kind: 'property', set: s.id, name: cname, value: s.value });
  for (const [a, b, value, copies] of DUAL_WILDS)
    for (let i = 0; i < copies; i++)
      deck.push({ id: id(), kind: 'wild', sets: [a, b], name: SET_BY_ID[a].name + ' / ' + SET_BY_ID[b].name, value });
  for (let i = 0; i < 2; i++)
    deck.push({ id: id(), kind: 'wild', sets: SETS.map(s => s.id), name: 'Every-Color Wild', value: 0, everyColor: true });
  for (const [denom, count] of BLADE_DENOMS)
    for (let i =  0; i < count; i++)
      deck.push({ id: id(), kind: 'money', name: denom + ' Blades', value: denom });
  for (const [a, b] of RENT_PAIRS)
    for (let i = 0; i < 2; i++)
      deck.push({ id: id(), kind: 'rent', sets: [a, b], name: 'Challenge', value: 1 });
  for (const [key, a] of Object.entries(ACTIONS))
    for (let i = 0; i < a.count; i++)
      deck.push({ id: id(), kind: 'action', action: key, name: a.name, text: a.text, value: actionValue(key) });
  return deck;
}

function actionValue(key) {
  return { outsmart: 5, time_stopping: 5, dragonscale: 4,
           dragons_fire: 3, leighorrel: 3, dagger_acro: 3,
           double_relics: 3, memory_reading: 3,
           fonilee: 2, search_arch: 2, tairn_wisdom: 1 }[key] || 1;
}

if (typeof module !== 'undefined') module.exports = { SETS, SET_BY_ID, SIGNETS, ACTIONS, buildDeck };
