'use strict';

/**
 * Santase / Sixty-Six (66) — 2-player game engine (pure logic, no I/O).
 *
 * Deck: 24 cards, suits S(♠) H(♥) D(♦) C(♣), ranks A,10,K,Q,J,9.
 * Card values: A=11, 10=10, K=4, Q=3, J=2, 9=0  (120 points total).
 *
 * Flow:
 *  - Phase 1 (stock open): winner of trick draws first, loser second.
 *    Following suit is NOT required.
 *  - Phase 2 (stock empty or closed): must follow suit, must beat if able,
 *    must trump when void. No drawing.
 *  - Marriage (K+Q same suit) announced on lead: 20 pts, or 40 in trump.
 *    Melded points only count once the melding player has won a trick.
 *  - Trump exchange: on lead, swap the trump-suit 9 for the face-up trump.
 *  - Closing: on lead, flip the trump face down; phase-2 rules for the rest.
 *  - Reaching 66+ (card points + valid melds) wins the hand.
 *
 * Game points per hand:
 *  - opponent had 0 tricks .............. 3
 *  - opponent < 33 points ............... 2
 *  - opponent 33..65 points ............. 1
 *  - closed and failed to reach 66 ...... opponent gets 2 (3 if they had 0 tricks)
 *  - stock exhausted, nobody reached 66 . winner of last trick gets 1
 * Match is played to a target number of game points (default 11).
 */

const SUITS = ['S', 'H', 'D', 'C'];
const RANKS = ['A', '10', 'K', 'Q', 'J', '9'];
const VALUE = { A: 11, '10': 10, K: 4, Q: 3, J: 2, '9': 0 };
const ORDER = { A: 6, '10': 5, K: 4, Q: 3, J: 2, '9': 1 };

function cardId(c) {
  return `${c.rank}${c.suit}`;
}
function makeDeck() {
  const d = [];
  for (const s of SUITS) for (const r of RANKS) d.push({ rank: r, suit: s });
  return d;
}
function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

class SantaseGame {
  /**
   * @param {[string,string]} playerIds - exactly two player ids
   * @param {object} opts - { target=11, rng }
   */
  constructor(playerIds, opts = {}) {
    if (!Array.isArray(playerIds) || playerIds.length !== 2) {
      throw new Error('Santase needs exactly two players');
    }
    this.players = playerIds.slice();
    this.target = opts.target || 11;
    this.rng = opts.rng || Math.random;
    this.matchPoints = { [this.players[0]]: 0, [this.players[1]]: 0 };
    this.matchOver = false;
    this.matchWinner = null;
    this.dealer = this.players[1]; // non-dealer leads the first hand
    this.handNumber = 0;
    this.log = [];
    this.startHand();
  }

  opponentOf(pid) {
    return this.players[0] === pid ? this.players[1] : this.players[0];
  }

  startHand() {
    this.handNumber += 1;
    // rotate dealer each hand
    this.dealer = this.opponentOf(this.dealer);
    const nonDealer = this.opponentOf(this.dealer);

    const deck = shuffle(makeDeck(), this.rng);
    this.hands = { [this.players[0]]: [], [this.players[1]]: [] };
    // deal 3 each, flip trump, deal 3 each
    for (let k = 0; k < 3; k++) {
      this.hands[nonDealer].push(deck.pop());
      this.hands[this.dealer].push(deck.pop());
    }
    this.trumpCard = deck.pop(); // face-up, last card to be drawn
    this.trumpSuit = this.trumpCard.suit;
    for (let k = 0; k < 3; k++) {
      this.hands[nonDealer].push(deck.pop());
      this.hands[this.dealer].push(deck.pop());
    }
    this.stock = deck; // remaining face-down draw pile, index 0 = top

    this.points = { [this.players[0]]: 0, [this.players[1]]: 0 };
    this.melds = { [this.players[0]]: 0, [this.players[1]]: 0 };
    this.tricksWon = { [this.players[0]]: 0, [this.players[1]]: 0 };
    this.wonCards = { [this.players[0]]: [], [this.players[1]]: [] };

    this.leader = nonDealer;
    this.turn = nonDealer;
    this.trick = []; // [{ playerId, card }]
    this.awaitingResolve = false; // completed trick shown but not yet scored
    this.pendingWinner = null;
    this.closed = false;
    this.closedBy = null;
    this.handOver = false;
    this.handResult = null;
    this.lastTrick = null;
    this.log.push({ t: 'deal', hand: this.handNumber, dealer: this.dealer, trump: this.trumpSuit });
  }

  // remaining draws available (stock + face-up trump)
  drawsLeft() {
    return this.stock.length + (this.trumpCard ? 1 : 0);
  }

  isPhase2() {
    return this.closed || this.drawsLeft() === 0;
  }

  effectiveScore(pid) {
    return this.points[pid] + (this.tricksWon[pid] > 0 ? this.melds[pid] : 0);
  }

  handHas(pid, rank, suit) {
    return this.hands[pid].some((c) => c.rank === rank && c.suit === suit);
  }
  removeFromHand(pid, card) {
    const i = this.hands[pid].findIndex((c) => c.rank === card.rank && c.suit === card.suit);
    if (i < 0) return false;
    this.hands[pid].splice(i, 1);
    return true;
  }

  // ---- validation helpers ----------------------------------------------

  canExchangeTrump(pid) {
    return (
      !this.handOver &&
      this.turn === pid &&
      this.leader === pid &&
      this.trick.length === 0 &&
      !this.closed &&
      this.trumpCard &&
      this.stock.length > 0 && // trump must not be the last remaining draw
      this.trumpCard.rank !== '9' &&
      this.handHas(pid, '9', this.trumpSuit)
    );
  }

  canClose(pid) {
    return (
      !this.handOver &&
      this.turn === pid &&
      this.leader === pid &&
      this.trick.length === 0 &&
      !this.closed &&
      this.stock.length >= 2 // cannot close on the last face-down stock card
    );
  }

  // marriage available on this card if leading and holding the partner
  canMeld(pid, card) {
    if (this.leader !== pid || this.trick.length !== 0) return false;
    if (card.rank !== 'K' && card.rank !== 'Q') return false;
    const partner = card.rank === 'K' ? 'Q' : 'K';
    return this.handHas(pid, partner, card.suit) && this.handHas(pid, card.rank, card.suit);
  }

  /** Cards the player is allowed to play right now. */
  legalPlays(pid) {
    if (this.handOver || this.turn !== pid) return [];
    const hand = this.hands[pid];
    // leading, or phase-1 follow => anything
    if (this.trick.length === 0 || !this.isPhase2()) return hand.slice();

    const led = this.trick[0].card;
    const sameSuit = hand.filter((c) => c.suit === led.suit);
    if (sameSuit.length) {
      const higher = sameSuit.filter((c) => ORDER[c.rank] > ORDER[led.rank]);
      return higher.length ? higher : sameSuit;
    }
    const trumps = hand.filter((c) => c.suit === this.trumpSuit);
    if (trumps.length) return trumps;
    return hand.slice();
  }

  // ---- actions ----------------------------------------------------------

  exchangeTrump(pid) {
    if (!this.canExchangeTrump(pid)) throw new Error('Cannot exchange trump now');
    const nine = { rank: '9', suit: this.trumpSuit };
    const taken = this.trumpCard; // the face-up trump they pick up (e.g. the Ace)
    this.removeFromHand(pid, nine);
    this.hands[pid].push(taken);
    this.trumpCard = nine;
    this.log.push({ t: 'exchange', by: pid });
    return {
      message: `${this.name(pid)} exchanged the trump 9`,
      notice: { by: pid, kind: 'exchange', card: cardId(taken), suit: this.trumpSuit },
    };
  }

  close(pid) {
    if (!this.canClose(pid)) throw new Error('Cannot close now');
    this.closed = true;
    this.closedBy = pid;
    this.log.push({ t: 'close', by: pid });
    return {
      message: `${this.name(pid)} closed the stock`,
      notice: { by: pid, kind: 'close' },
    };
  }

  /**
   * Play a card. `meld` requests a marriage announcement on the led K/Q.
   * @returns {object} event descriptor
   */
  play(pid, card, meld = false) {
    if (this.handOver) throw new Error('Hand is over');
    if (this.turn !== pid) throw new Error('Not your turn');
    const legal = this.legalPlays(pid);
    const ok = legal.some((c) => c.rank === card.rank && c.suit === card.suit);
    if (!ok) throw new Error('Illegal card');

    let meldMsg = '';
    let meldNotice = null;
    if (meld) {
      if (!this.canMeld(pid, card)) throw new Error('No valid marriage on that card');
      const pts = card.suit === this.trumpSuit ? 40 : 20;
      this.melds[pid] += pts;
      meldMsg = ` and announced a ${pts === 40 ? 'royal ' : ''}marriage (+${pts})`;
      meldNotice = { by: pid, kind: 'marriage', points: pts, suit: card.suit };
      this.log.push({ t: 'meld', by: pid, suit: card.suit, pts });
    }

    this.removeFromHand(pid, card);
    this.trick.push({ playerId: pid, card });
    this.log.push({ t: 'play', by: pid, card: cardId(card), meld });

    // a marriage can win the hand immediately if it lifts a trick-holder to 66
    if (meld && this.effectiveScore(pid) >= 66) {
      // still must have led the card; the trick is incomplete but 66 ends it
      this.turn = this.opponentOf(pid); // opponent would respond, but hand ends
    }

    if (this.trick.length < 2) {
      // pass turn to responder (unless hand ended via meld reaching 66)
      if (!this.handOver) {
        if (meld && this.effectiveScore(pid) >= 66) {
          this.endHand({ reason: 'sixtysix', winner: pid });
        } else {
          this.turn = this.opponentOf(pid);
        }
      }
      return { message: `${this.name(pid)} played ${cardId(card)}${meldMsg}`, notice: meldNotice };
    }

    // trick complete -> keep both cards on the table; defer scoring so players
    // can see what was played. The caller invokes resolveTrick() after a pause.
    const [a, b] = this.trick;
    this.pendingWinner = this.trickWinner(a, b);
    this.awaitingResolve = true;
    this.turn = null; // nobody may act during the reveal pause
    this.log.push({ t: 'trickfull', winner: this.pendingWinner });
    return this.publicEvent(
      `${this.name(pid)} played ${cardId(card)}${meldMsg}. ${this.name(this.pendingWinner)} takes the trick.`
    );
  }

  /** Apply the deferred trick: scoring, drawing, win checks. Safe to call once. */
  resolveTrick() {
    if (!this.awaitingResolve) return null;
    const [a, b] = this.trick;
    const winner = this.pendingWinner;
    const loser = this.opponentOf(winner);
    const gained = VALUE[a.card.rank] + VALUE[b.card.rank];
    this.points[winner] += gained;
    this.tricksWon[winner] += 1;
    this.wonCards[winner].push(a.card, b.card);
    this.lastTrick = { cards: [a, b], winner };
    this.trick = [];
    this.awaitingResolve = false;
    this.pendingWinner = null;
    this.leader = winner;
    this.turn = winner;
    this.log.push({ t: 'trick', winner, gained });

    const bothEmpty =
      this.hands[this.players[0]].length === 0 && this.hands[this.players[1]].length === 0;

    // draw phase (only if stock open and not closed and cards remain in hand)
    if (!this.closed && this.drawsLeft() > 0 && !bothEmpty) {
      this.draw(winner);
      this.draw(loser);
    }

    // win checks
    if (this.effectiveScore(winner) >= 66) {
      this.endHand({ reason: 'sixtysix', winner });
    } else if (this.hands[winner].length === 0 && this.hands[loser].length === 0) {
      this.endHand({ reason: 'lasttrick', winner });
    }
    return { winner, gained };
  }

  draw(pid) {
    if (this.stock.length > 0) {
      this.hands[pid].push(this.stock.shift());
    } else if (this.trumpCard) {
      this.hands[pid].push(this.trumpCard);
      this.trumpCard = null;
    }
  }

  trickWinner(a, b) {
    // a = leader's play, b = responder's play
    const lead = a.card;
    const resp = b.card;
    const respBeats =
      (resp.suit === lead.suit && ORDER[resp.rank] > ORDER[lead.rank]) ||
      (resp.suit === this.trumpSuit && lead.suit !== this.trumpSuit);
    return respBeats ? b.playerId : a.playerId;
  }

  endHand({ reason, winner }) {
    if (this.handOver) return;

    // last-trick bonus (+10) when the deck is fully played out to the end
    if (reason === 'lasttrick' && this.lastTrick) {
      this.points[this.lastTrick.winner] += 10;
      winner = this.effectiveScore(this.players[0]) >= 66
        ? this.players[0]
        : this.effectiveScore(this.players[1]) >= 66
        ? this.players[1]
        : this.lastTrick.winner;
    }

    let handWinner = winner;
    let gamePoints = 1;

    if (this.closed) {
      // did the closer reach 66?
      const closer = this.closedBy;
      const other = this.opponentOf(closer);
      if (this.effectiveScore(closer) >= 66 && reason === 'sixtysix' && winner === closer) {
        handWinner = closer;
        gamePoints = this.gamePointsFor(other);
      } else {
        // closer failed -> opponent scores (bonus for the broken promise)
        handWinner = other;
        gamePoints = this.tricksWon[other] === 0 ? 3 : 2;
      }
    } else if (reason === 'sixtysix') {
      handWinner = winner;
      gamePoints = this.gamePointsFor(this.opponentOf(winner));
    } else {
      // last trick, nobody at 66 -> last-trick winner gets 1
      handWinner = winner;
      gamePoints = 1;
    }

    this.matchPoints[handWinner] += gamePoints;
    this.handOver = true;
    this.handResult = {
      reason,
      winner: handWinner,
      gamePoints,
      scores: {
        [this.players[0]]: this.effectiveScore(this.players[0]),
        [this.players[1]]: this.effectiveScore(this.players[1]),
      },
    };
    this.log.push({ t: 'handover', winner: handWinner, gamePoints });

    if (this.matchPoints[handWinner] >= this.target) {
      this.matchOver = true;
      this.matchWinner = handWinner;
    }
  }

  gamePointsFor(loser) {
    if (this.tricksWon[loser] === 0) return 3; // schwarz
    if (this.effectiveScore(loser) < 33) return 2; // schneider
    return 1;
  }

  // display name hook (overridden by server); default = id
  name(pid) {
    return this.names?.[pid] || pid;
  }

  publicEvent(message) {
    return { message };
  }

  // ---- serialization ----------------------------------------------------

  /** Full state tailored to one viewer (opponent hand hidden). */
  viewFor(pid) {
    const opp = this.opponentOf(pid);
    return {
      you: pid,
      opponent: opp,
      handNumber: this.handNumber,
      target: this.target,
      trumpSuit: this.trumpSuit,
      trumpCard: this.trumpCard,
      stockCount: this.stock.length,
      drawsLeft: this.drawsLeft(),
      closed: this.closed,
      closedBy: this.closedBy,
      phase2: this.isPhase2(),
      leader: this.leader,
      turn: this.turn,
      trick: this.trick,
      resolving: !!this.awaitingResolve,
      trickWinner: this.awaitingResolve
        ? this.pendingWinner
        : this.lastTrick
        ? this.lastTrick.winner
        : null,
      yourHand: this.hands[pid].slice().sort(sortCards),
      opponentHandCount: this.hands[opp].length,
      // Only your own hand points are visible — the opponent's running score
      // is hidden, as in real Santase (revealed only when the hand ends).
      points: { [pid]: this.points[pid] },
      melds: { [pid]: this.melds[pid] },
      effective: { [pid]: this.effectiveScore(pid) },
      tricksWon: { [pid]: this.tricksWon[pid] },
      matchPoints: this.matchPoints,
      matchOver: this.matchOver,
      matchWinner: this.matchWinner,
      handOver: this.handOver,
      handResult: this.handResult,
      lastTrick: this.lastTrick,
      dealer: this.dealer,
      legalPlays: this.legalPlays(pid).map(cardId),
      canClose: this.canClose(pid),
      canExchange: this.canExchangeTrump(pid),
      meldable: this.hands[pid].filter((c) => this.canMeld(pid, c)).map(cardId),
    };
  }
}

function sortCards(a, b) {
  const s = SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit);
  if (s !== 0) return s;
  return ORDER[b.rank] - ORDER[a.rank];
}

module.exports = { SantaseGame, makeDeck, cardId, SUITS, RANKS, VALUE, ORDER };
