/* Santase 66 — client */
(function () {
  const socket = io();
  const $ = (id) => document.getElementById(id);
  const state = {
    playerId: null,
    code: null,
    hostId: null,
    role: 'player',
    view: null,
    meldArmed: false,
  };

  // ---- persistence for reconnects --------------------------------------
  function save() {
    if (state.code && state.playerId) {
      localStorage.setItem('santase', JSON.stringify({ code: state.code, playerId: state.playerId }));
    }
  }
  function clearSave() {
    localStorage.removeItem('santase');
  }

  // ---- screens ----------------------------------------------------------
  function show(screen) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    $(screen).classList.add('active');
  }

  function toast(msg, kind) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast' + (kind ? ' ' + kind : '');
    t.hidden = false;
    clearTimeout(t._timer);
    t._timer = setTimeout(() => (t.hidden = true), 3000);
  }

  // ---- home actions -----------------------------------------------------
  function nameVal() {
    const n = $('playerName').value.trim();
    return n || 'Player';
  }

  $('createBtn').onclick = () => {
    socket.emit('room:create', { name: nameVal(), target: $('target').value }, (res) => {
      if (!res.ok) return toast(res.error, 'error');
      enterRoom(res);
    });
  };

  $('joinBtn').onclick = () => {
    const code = $('joinCode').value.trim().toUpperCase();
    if (code.length < 4) return toast('Enter a 4-letter code', 'error');
    socket.emit('room:join', { code, name: nameVal() }, (res) => {
      if (!res.ok) return toast(res.error, 'error');
      enterRoom(res);
      if (res.role === 'spectator') toast('Room full — joined as spectator', 'info');
    });
  };

  $('joinCode').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });

  function enterRoom(res) {
    state.playerId = res.playerId;
    state.code = res.code;
    state.hostId = res.hostId;
    state.role = res.role || 'player';
    save();
    show('lobby');
    $('lobbyCode').textContent = res.code;
  }

  // ---- lobby ------------------------------------------------------------
  $('copyCode').onclick = () => {
    navigator.clipboard?.writeText(state.code).then(
      () => toast('Code copied!', 'info'),
      () => toast(state.code, 'info')
    );
  };
  $('startBtn').onclick = () => {
    socket.emit('room:start', {}, (res) => {
      if (!res.ok) toast(res.error, 'error');
    });
  };
  $('leaveBtn').onclick = leaveToMenu;
  $('menuBtn').onclick = leaveToMenu;

  function leaveToMenu() {
    if (state.view && !state.view.matchOver && !state.view.handOver) {
      if (!confirm('Leave this game and return to the menu?')) return;
    }
    clearSave();
    location.href = location.pathname; // clean reload to home
  }

  socket.on('room', (room) => {
    state.hostId = room.hostId;
    if (room.status === 'lobby') {
      show('lobby');
      renderLobby(room);
    } else {
      $('gameCode').textContent = room.code;
      $('gameTarget').textContent = room.target;
    }
    renderChat(room.chat);
  });

  function renderLobby(room) {
    const list = $('lobbyPlayers');
    list.innerHTML = '';
    room.players.forEach((p) => {
      const el = document.createElement('div');
      el.className = 'player-row' + (p.id === room.hostId ? ' host' : '');
      el.innerHTML = `<span class="dot ${p.connected ? 'on' : 'off'}"></span>
        <span>${escapeHtml(p.name)}</span>
        ${p.id === room.hostId ? '<em>host</em>' : ''}
        ${p.id === state.playerId ? '<em class="me">you</em>' : ''}`;
      list.appendChild(el);
    });
    for (let i = room.players.length; i < 2; i++) {
      const el = document.createElement('div');
      el.className = 'player-row empty';
      el.innerHTML = '<span class="dot"></span><span>Waiting…</span>';
      list.appendChild(el);
    }
    const isHost = state.playerId === room.hostId;
    const full = room.players.length === 2;
    $('startBtn').hidden = !isHost;
    $('startBtn').disabled = !isHost || !full;
    $('lobbyStatus').textContent = full
      ? isHost
        ? 'Ready! Press start.'
        : 'Waiting for host to start…'
      : 'Waiting for a second player…';
    if (room.spectators.length) {
      $('lobbyStatus').textContent += ` (${room.spectators.length} watching)`;
    }
  }

  // ---- game view --------------------------------------------------------
  socket.on('game', (view) => {
    state.view = view;
    state.role = 'player';
    show('game');
    renderGame(view);
  });
  socket.on('spectate', (view) => {
    if (state.role === 'player') return; // players get their own 'game'
    state.view = view;
    show('game');
    renderGame(view);
  });

  function renderGame(v) {
    const myTurn = v.turn === v.you && !v.handOver && state.role === 'player';

    // scores
    $('youMatch').textContent = v.matchPoints[v.you] ?? 0;
    $('oppMatch').textContent = v.matchPoints[v.opponent] ?? 0;
    $('youPts').textContent = (v.effective?.[v.you] ?? v.points[v.you]) + ' pts';
    $('oppPts').textContent = (v.effective?.[v.opponent] ?? v.points[v.opponent]) + ' pts';
    $('youName').textContent = nameFor(v, v.you) + (v.dealer === v.you ? ' (dealer)' : '');
    $('oppName').textContent = nameFor(v, v.opponent) + (v.dealer === v.opponent ? ' (dealer)' : '');
    $('gameCode').textContent = state.code;
    $('gameTarget').textContent = v.target;
    $('youChip').classList.toggle('active', v.turn === v.you);
    $('oppChip').classList.toggle('active', v.turn === v.opponent);

    // trump + stock
    const trump = $('trumpCard');
    trump.innerHTML = '';
    if (v.trumpCard) {
      const c = Cards.cardEl(v.trumpCard, { small: true });
      c.classList.add('trump-face');
      trump.appendChild(c);
    } else {
      const badge = document.createElement('div');
      badge.className = 'trump-badge ' + (Cards.RED[v.trumpSuit] ? 'red' : 'black');
      badge.innerHTML = `<span>${Cards.SUIT_GLYPH[v.trumpSuit]}</span><small>trump</small>`;
      trump.appendChild(badge);
    }
    $('stockCount').textContent = v.stockCount;
    $('stockPile').classList.toggle('empty', v.stockCount === 0 && !v.trumpCard);
    $('stockPile').classList.toggle('closed', v.closed);

    // opponent hand (backs)
    const oh = $('oppHand');
    oh.innerHTML = '';
    const oc = v.spectator ? v.opponentHandCount : v.opponentHandCount;
    for (let i = 0; i < oc; i++) oh.appendChild(Cards.backEl({ small: true }));

    // trick area
    const ta = $('trickArea');
    ta.innerHTML = '';
    v.trick.forEach((play) => {
      const wrap = document.createElement('div');
      wrap.className = 'trick-card ' + (play.playerId === v.you ? 'from-you' : 'from-opp');
      wrap.appendChild(Cards.cardEl(play.card));
      ta.appendChild(wrap);
    });

    // your hand
    const yh = $('youHand');
    yh.innerHTML = '';
    const legal = new Set(v.legalPlays || []);
    const meldable = new Set(v.meldable || []);
    (v.yourHand || []).forEach((card) => {
      const id = card.rank + card.suit;
      const playable = myTurn && legal.has(id);
      const el = Cards.cardEl(card, { disabled: !playable });
      if (meldable.has(id) && myTurn) el.classList.add('meldable');
      if (state.meldArmed && meldable.has(id)) el.classList.add('meld-armed');
      if (playable) {
        el.onclick = () => playCard(card, meldable.has(id));
      }
      yh.appendChild(el);
    });

    // turn banner
    const banner = $('turnBanner');
    if (v.handOver) {
      banner.textContent = 'Hand over';
      banner.className = 'turn-banner';
    } else if (state.role !== 'player') {
      banner.textContent = 'Spectating — ' + nameFor(v, v.turn) + ' to play';
      banner.className = 'turn-banner';
    } else if (myTurn) {
      banner.textContent = v.phase2 ? 'Your turn — follow suit!' : 'Your turn';
      banner.className = 'turn-banner mine';
    } else {
      banner.textContent = nameFor(v, v.opponent) + ' is thinking…';
      banner.className = 'turn-banner';
    }
    if (v.closed) banner.textContent += ' · stock closed';

    // action buttons
    const meldBtn = $('meldBtn');
    meldBtn.hidden = !(myTurn && (v.meldable || []).length);
    meldBtn.classList.toggle('armed', state.meldArmed);
    meldBtn.textContent = state.meldArmed ? 'Marriage armed — pick K or Q' : 'Announce marriage';
    $('exchangeBtn').hidden = !(myTurn && v.canExchange);
    $('closeBtn').hidden = !(myTurn && v.canClose);

    if (!myTurn) state.meldArmed = false;

    // hand / match over modal
    if (v.handOver && v.handResult) showHandOver(v);
    else hideModal();
  }

  function nameFor(v, id) {
    if (id === v.you) return 'You';
    return v.names?.[id] || (id === v.opponent ? 'Opponent' : 'Player');
  }

  function playCard(card, isMeldable) {
    const meld = state.meldArmed && isMeldable;
    state.meldArmed = false;
    socket.emit('game:action', { type: 'play', card, meld }, (res) => {
      if (!res.ok) toast(res.error, 'error');
    });
  }

  $('meldBtn').onclick = () => {
    state.meldArmed = !state.meldArmed;
    if (state.view) renderGame(state.view);
    if (state.meldArmed) toast('Now click the King or Queen to announce', 'info');
  };
  $('exchangeBtn').onclick = () =>
    socket.emit('game:action', { type: 'exchange' }, (r) => !r.ok && toast(r.error, 'error'));
  $('closeBtn').onclick = () => {
    if (!confirm('Close the stock? You must reach 66 or your opponent scores bonus points.')) return;
    socket.emit('game:action', { type: 'close' }, (r) => !r.ok && toast(r.error, 'error'));
  };

  // ---- hand / match over modal -----------------------------------------
  function showHandOver(v) {
    const r = v.handResult;
    const iWon = r.winner === v.you;
    const title = $('modalTitle');
    const body = $('modalBody');
    const actions = $('modalActions');

    if (v.matchOver) {
      const meWon = v.matchWinner === v.you;
      title.textContent = meWon ? '🏆 You win the match!' : 'Match over';
      body.innerHTML =
        `${nameFor(v, v.matchWinner)} reached ${v.target} game points.<br>` +
        `Final: You ${v.matchPoints[v.you]} — ${v.matchPoints[v.opponent]} ${nameFor(v, v.opponent)}`;
      actions.innerHTML = '';
      if (state.role === 'player') {
        addBtn(actions, 'Rematch', 'primary', () =>
          socket.emit('game:action', { type: 'rematch' }, (x) => !x.ok && toast(x.error, 'error'))
        );
      }
      addBtn(actions, 'Leave', 'ghost', () => {
        clearSave();
        location.reload();
      });
    } else {
      title.textContent = iWon ? 'You won the hand 🎉' : 'Hand lost';
      const reason =
        r.reason === 'sixtysix'
          ? 'reached 66'
          : r.reason === 'lasttrick'
          ? 'won the last trick'
          : 'won';
      body.innerHTML =
        `${nameFor(v, r.winner)} ${reason} and scored <b>+${r.gamePoints}</b> game point(s).<br>` +
        `Hand points — You ${r.scores[v.you]} : ${r.scores[v.opponent]} ${nameFor(v, v.opponent)}<br>` +
        `Match — You ${v.matchPoints[v.you]} : ${v.matchPoints[v.opponent]} ${nameFor(v, v.opponent)}`;
      actions.innerHTML = '';
      const isHost = state.playerId === state.hostId;
      if (state.role === 'player') {
        addBtn(actions, 'Deal next hand', 'primary', () =>
          socket.emit('game:action', { type: 'nextHand' }, (x) => !x.ok && toast(x.error, 'error'))
        );
      } else {
        body.innerHTML += '<br><small>Waiting for players to continue…</small>';
      }
      addBtn(actions, 'Leave', 'ghost', leaveToMenu);
    }
    $('modal').hidden = false;
  }
  function addBtn(container, label, cls, onclick) {
    const b = document.createElement('button');
    b.className = cls;
    b.textContent = label;
    b.onclick = onclick;
    container.appendChild(b);
  }
  function hideModal() {
    $('modal').hidden = true;
  }

  // ---- chat / log -------------------------------------------------------
  $('chatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('chatInput').value.trim();
    if (!text) return;
    socket.emit('room:chat', { text });
    $('chatInput').value = '';
  });

  function renderChat(chat) {
    const log = $('gameLog');
    if (!log || !chat) return;
    log.innerHTML = '';
    chat.forEach((m) => {
      const el = document.createElement('div');
      el.className = 'log-line' + (m.system ? ' system' : '');
      el.innerHTML = m.system
        ? `<i>${escapeHtml(m.text)}</i>`
        : `<b>${escapeHtml(m.name)}:</b> ${escapeHtml(m.text)}`;
      log.appendChild(el);
    });
    log.scrollTop = log.scrollHeight;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  // ---- reconnect on load ------------------------------------------------
  socket.on('connect', () => {
    const saved = localStorage.getItem('santase');
    if (saved) {
      try {
        const { code, playerId } = JSON.parse(saved);
        socket.emit('room:resume', { code, playerId }, (res) => {
          if (res.ok) {
            state.playerId = res.playerId;
            state.code = res.code;
            state.hostId = res.hostId;
            state.role = res.role || 'player';
          } else {
            clearSave();
          }
        });
      } catch (_) {
        clearSave();
      }
    }
  });
})();
