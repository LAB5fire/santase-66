/* Shared card rendering helpers (used by game + dashboard). */
(function (global) {
  const SUIT_GLYPH = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const SUIT_NAME = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };
  const RED = { H: true, D: true };

  function parseId(id) {
    // id like "10H", "AS", "9D"
    const suit = id.slice(-1);
    const rank = id.slice(0, -1);
    return { rank, suit };
  }

  function cardEl(card, opts = {}) {
    const c = typeof card === 'string' ? parseId(card) : card;
    const el = document.createElement('div');
    el.className = 'playing-card' + (RED[c.suit] ? ' red' : ' black');
    if (opts.disabled) el.classList.add('disabled');
    if (opts.selected) el.classList.add('selected');
    if (opts.small) el.classList.add('small');
    el.dataset.card = c.rank + c.suit;
    el.innerHTML = `
      <span class="corner tl">${c.rank}<i>${SUIT_GLYPH[c.suit]}</i></span>
      <span class="pip">${SUIT_GLYPH[c.suit]}</span>
      <span class="corner br">${c.rank}<i>${SUIT_GLYPH[c.suit]}</i></span>`;
    return el;
  }

  function backEl(opts = {}) {
    const el = document.createElement('div');
    el.className = 'playing-card back' + (opts.small ? ' small' : '');
    el.innerHTML = '<span class="back-motif">66</span>';
    return el;
  }

  global.Cards = { SUIT_GLYPH, SUIT_NAME, RED, parseId, cardEl, backEl };
})(window);
