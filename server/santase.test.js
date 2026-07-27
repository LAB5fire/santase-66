'use strict';
// Lightweight self-test: play many random-but-legal games and assert invariants.
const { SantaseGame, cardId } = require('./santase');

let seed = 12345;
function rng() {
  // deterministic LCG so failures reproduce
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}

function pick(arr) {
  return arr[Math.floor(rng() * arr.length)];
}

let games = 0;
let hands = 0;
let assertions = 0;
function assert(cond, msg) {
  assertions++;
  if (!cond) throw new Error('ASSERT FAILED: ' + msg);
}

for (let g = 0; g < 500; g++) {
  const game = new SantaseGame(['A', 'B'], { target: 11, rng });
  let guard = 0;
  while (!game.matchOver) {
    if (++guard > 100000) throw new Error('runaway loop');
    if (game.awaitingResolve) {
      game.resolveTrick();
      continue;
    }
    if (game.handOver) {
      hands++;
      // total card points across both players must be <= 130 (120 + 10 last trick)
      const tot = game.points['A'] + game.points['B'];
      assert(tot <= 130, `card points ${tot} exceed 130`);
      game.startHand();
      continue;
    }
    const pid = game.turn;
    // sometimes exchange or close if legal, to exercise those paths
    if (game.canExchangeTrump(pid) && rng() < 0.3) {
      game.exchangeTrump(pid);
      continue;
    }
    if (game.canClose(pid) && rng() < 0.05) {
      game.close(pid);
    }
    const legal = game.legalPlays(pid);
    assert(legal.length > 0, 'no legal plays but hand not over');
    const card = pick(legal);
    const meldable = game.canMeld(pid, card);
    game.play(pid, card, meldable && rng() < 0.7);
  }
  games++;
  assert(game.matchWinner === 'A' || game.matchWinner === 'B', 'no match winner');
  assert(
    game.matchPoints[game.matchWinner] >= game.target,
    'winner below target'
  );
}

console.log(`OK — ${games} matches, ${hands} hands, ${assertions} assertions passed.`);
