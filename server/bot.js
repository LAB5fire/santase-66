'use strict';

/**
 * Santase AI.
 *
 * Two layers:
 *  - Expert heuristics for the open phase (imperfect information): exchange the
 *    trump 9, announce marriages, capture Aces/Tens cheaply, duck worthless
 *    tricks, keep trumps, and close only when it is safe.
 *  - A perfect-information minimax END-GAME SOLVER that runs once the stock is
 *    exhausted (drawsLeft === 0). At that point the opponent's hand is fully
 *    determined (it is exactly the set of unseen cards), so the bot can compute
 *    the move that guarantees the best result against optimal defence.
 *
 * The heuristics never look at the opponent's hidden hand; only the end-game
 * solver uses it, and only when it is legitimately deducible.
 */

const { VALUE, ORDER } = require('./santase');

const val = (c) => VALUE[c.rank];
const ord = (c) => ORDER[c.rank];
const cid = (c) => c.rank + c.suit;
const eq = (a, b) => a.rank === b.rank && a.suit === b.suit;

function beats(lead, resp, trump) {
  return (
    (resp.suit === lead.suit && ORDER[resp.rank] > ORDER[lead.rank]) ||
    (resp.suit === trump && lead.suit !== trump)
  );
}

function without(arr, card) {
  const i = arr.findIndex((c) => eq(c, card));
  const copy = arr.slice();
  if (i >= 0) copy.splice(i, 1);
  return copy;
}

// phase-2 legal responses: follow & beat if able, else trump, else anything
function legalResponses(hand, led, trump) {
  const same = hand.filter((c) => c.suit === led.suit);
  if (same.length) {
    const higher = same.filter((c) => ORDER[c.rank] > ORDER[led.rank]);
    return higher.length ? higher : same;
  }
  const tr = hand.filter((c) => c.suit === trump);
  if (tr.length) return tr;
  return hand.slice();
}

function hasPartner(hand, card) {
  if (card.rank !== 'K' && card.rank !== 'Q') return false;
  const partner = card.rank === 'K' ? 'Q' : 'K';
  return hand.some((c) => c.rank === partner && c.suit === card.suit);
}

// ---- entry point ---------------------------------------------------------

function chooseMove(game, me) {
  const leading = game.trick.length === 0;

  if (leading && game.canExchangeTrump(me)) return { type: 'exchange' };

  // perfect end-game once the stock is gone (opponent hand fully deducible)
  if (game.drawsLeft() === 0) {
    try {
      const best = solveBestMove(game, me);
      if (best) return best;
    } catch (_) {
      /* budget exceeded -> fall through to heuristics */
    }
  }

  if (leading) {
    const marriage = bestMarriage(game, me);
    if (marriage) return marriage;
    if (game.canClose(me) && shouldClose(game, me)) return { type: 'close' };
    return { type: 'play', card: chooseLead(game, me) };
  }
  return { type: 'play', card: chooseResponse(game, me) };
}

// ---- heuristics ----------------------------------------------------------

function bestMarriage(game, me) {
  const hand = game.hands[me];
  const trump = game.trumpSuit;
  let pick = null;
  for (const c of hand) {
    if ((c.rank === 'K' || c.rank === 'Q') && hasPartner(hand, c)) {
      const isTrump = c.suit === trump;
      // prefer the trump marriage (40); lead the Queen, keep the King
      if (!pick || (isTrump && !pick.isTrump) || (c.rank === 'Q' && !pick.q && isTrump === pick.isTrump)) {
        pick = { card: c, isTrump, q: c.rank === 'Q' };
      }
    }
  }
  return pick ? { type: 'play', card: pick.card, meld: true } : null;
}

function shouldClose(game, me) {
  const eff = game.effectiveScore(me);
  const hand = game.hands[me];
  const trump = game.trumpSuit;
  if (eff < 46) return false;
  let sure = 0;
  for (const c of hand) if (c.suit === trump && (c.rank === 'A' || c.rank === '10')) sure += val(c);
  if (eff >= 60 && hand.some((c) => c.suit === trump && ORDER[c.rank] >= 4)) return true;
  return eff + sure >= 66;
}

function chooseLead(game, me) {
  const trump = game.trumpSuit;
  // dump the cheapest non-trump card; keep Aces/Tens and trumps
  return game.hands[me]
    .slice()
    .sort((a, b) => {
      const ta = a.suit === trump ? 1 : 0;
      const tb = b.suit === trump ? 1 : 0;
      return ta - tb || val(a) - val(b) || ord(a) - ord(b);
    })[0];
}

function chooseResponse(game, me) {
  const led = game.trick[0].card;
  const trump = game.trumpSuit;
  const legal = game.legalPlays(me);
  const winners = legal.filter((c) => beats(led, c, trump));
  const nonWinners = legal.filter((c) => !winners.some((w) => eq(w, c)));
  const eff = game.effectiveScore(me);

  // cheapest way to win: prefer a same-suit winner over burning a trump, low value first
  const cheapestWinner = winners.slice().sort((a, b) => {
    const ta = a.suit === trump ? 1 : 0;
    const tb = b.suit === trump ? 1 : 0;
    return ta - tb || val(a) - val(b) || ord(a) - ord(b);
  })[0];

  if (!nonWinners.length) return cheapestWinner || legal[0]; // forced to win / only option
  const ledHigh = val(led) >= 10; // capturing an Ace/Ten is worth it
  const worthIt = cheapestWinner && (ledHigh || eff >= 60 || val(led) + val(cheapestWinner) >= 13);
  if (worthIt) return cheapestWinner;

  // duck: throw the least valuable non-winner (prefer low non-trump)
  return nonWinners.slice().sort((a, b) => {
    const ta = a.suit === trump ? 1 : 0;
    const tb = b.suit === trump ? 1 : 0;
    return val(a) - val(b) || ord(a) - ord(b) || ta - tb;
  })[0];
}

// ---- perfect end-game solver --------------------------------------------

function solveBestMove(game, me) {
  const opp = game.opponentOf(me);
  const trump = game.trumpSuit;
  const start = { me: game.effectiveScore(me), opp: game.effectiveScore(opp) };
  const budget = { n: 0, cap: 400000 };
  const memo = new Map();

  const key = (h, pts, lead, last) =>
    h.me.map(cid).sort().join() + '/' + h.opp.map(cid).sort().join() +
    '|' + pts.me + '|' + pts.opp + '|' + (lead ? 1 : 0) + '|' + (last ? 1 : 0);

  // want[x] = boolean value that player x wants returned (true = "me" wins hand)
  const pickFor = (playerIsMe, a, b) => {
    if (a === null) return b;
    if (b === null) return a;
    if (a === playerIsMe) return a;
    if (b === playerIsMe) return b;
    return a;
  };

  // returns true iff "me" wins the hand with both sides optimal
  function solve(h, pts, leaderIsMe, lastMeWon) {
    if (pts.me >= 66) return true;
    if (pts.opp >= 66) return false;
    if (!h.me.length && !h.opp.length) return lastMeWon;
    if (++budget.n > budget.cap) throw new Error('budget');
    const k = key(h, pts, leaderIsMe, lastMeWon);
    const c = memo.get(k);
    if (c !== undefined) return c;

    const leaderHand = leaderIsMe ? h.me : h.opp;
    let best = null;
    for (const lc of leaderHand) {
      const meldable = hasPartner(leaderHand, lc); // melding when leading is free value
      const ptsL = { me: pts.me, opp: pts.opp };
      if (meldable) ptsL[leaderIsMe ? 'me' : 'opp'] += lc.suit === trump ? 40 : 20;

      let outcome;
      if (leaderIsMe && ptsL.me >= 66) outcome = true;
      else if (!leaderIsMe && ptsL.opp >= 66) outcome = false;
      else {
        const hLead = {
          me: leaderIsMe ? without(h.me, lc) : h.me,
          opp: leaderIsMe ? h.opp : without(h.opp, lc),
        };
        const follHand = leaderIsMe ? hLead.opp : hLead.me;
        const respIsMe = !leaderIsMe;
        let respBest = null;
        for (const rc of legalResponses(follHand, lc, trump)) {
          const winnerIsMe = beats(lc, rc, trump) ? respIsMe : leaderIsMe;
          const ptsT = { me: ptsL.me, opp: ptsL.opp };
          ptsT[winnerIsMe ? 'me' : 'opp'] += val(lc) + val(rc);
          const hAfter = {
            me: respIsMe ? without(hLead.me, rc) : hLead.me,
            opp: respIsMe ? hLead.opp : without(hLead.opp, rc),
          };
          const sub = solve(hAfter, ptsT, winnerIsMe, winnerIsMe);
          respBest = pickFor(respIsMe, respBest, sub);
          if (respBest === respIsMe) break; // responder found its best
        }
        outcome = respBest;
      }
      best = pickFor(leaderIsMe, best, outcome);
      if (best === leaderIsMe) break; // leader found a guaranteed win
    }
    memo.set(k, best);
    return best;
  }

  const meHand = game.hands[me].map((c) => ({ rank: c.rank, suit: c.suit }));
  const opHand = game.hands[opp].map((c) => ({ rank: c.rank, suit: c.suit }));

  if (game.trick.length === 0) {
    // leading
    let bestMove = null;
    let bestOutcome = null;
    for (const lc of meHand) {
      const meldable = hasPartner(meHand, lc);
      const ptsL = { me: start.me, opp: start.opp };
      if (meldable) ptsL.me += lc.suit === trump ? 40 : 20;
      let outcome;
      if (ptsL.me >= 66) outcome = true;
      else {
        const hLead = { me: without(meHand, lc), opp: opHand };
        let respBest = null;
        for (const rc of legalResponses(hLead.opp, lc, trump)) {
          const winnerIsMe = beats(lc, rc, trump) ? false : true;
          const ptsT = { me: ptsL.me, opp: ptsL.opp };
          ptsT[winnerIsMe ? 'me' : 'opp'] += val(lc) + val(rc);
          const hAfter = { me: hLead.me, opp: without(hLead.opp, rc) };
          respBest = pickFor(false, respBest, solve(hAfter, ptsT, winnerIsMe, winnerIsMe));
          if (respBest === false) break;
        }
        outcome = respBest;
      }
      if (bestOutcome === null || (outcome === true && bestOutcome !== true)) {
        bestOutcome = outcome;
        bestMove = { type: 'play', card: lc, meld: meldable };
      }
      if (bestOutcome === true) break;
    }
    return bestMove;
  }

  // responding (opponent already led; its card is out of opHand already)
  const led = game.trick[0].card;
  let bestMove = null;
  let bestOutcome = null;
  for (const rc of legalResponses(meHand, led, trump)) {
    const winnerIsMe = beats(led, rc, trump) ? true : false;
    const ptsT = { me: start.me, opp: start.opp };
    ptsT[winnerIsMe ? 'me' : 'opp'] += val(led) + val(rc);
    const hAfter = { me: without(meHand, rc), opp: opHand };
    const outcome = solve(hAfter, ptsT, winnerIsMe, winnerIsMe);
    if (bestOutcome === null || (outcome === true && bestOutcome !== true)) {
      bestOutcome = outcome;
      bestMove = { type: 'play', card: rc };
    }
    if (bestOutcome === true) break;
  }
  return bestMove;
}

module.exports = { chooseMove };
