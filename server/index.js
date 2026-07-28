'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { RoomManager } = require('./rooms');
const { chooseMove } = require('./bot');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const rooms = new RoomManager();

const PUBLIC = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC));

app.get('/healthz', (_req, res) => res.json({ ok: true, uptime: process.uptime() }));
app.get('/api/stats', (_req, res) => res.json(rooms.stats()));
app.get('/dashboard', (_req, res) => res.sendFile(path.join(PUBLIC, 'dashboard.html')));

// ---- realtime -----------------------------------------------------------

function broadcastRoom(room) {
  // lobby / meta state for everyone in the room
  const meta = {
    code: room.code,
    status: room.status,
    hostId: room.hostId,
    target: room.target,
    players: room.players.map((p) => ({ id: p.id, name: p.name, connected: p.connected })),
    spectators: room.spectators.map((s) => ({ id: s.id, name: s.name })),
  };
  io.to(room.code).emit('room', meta);

  // personalized game view for each seated player
  if (room.game) {
    for (const p of room.players) {
      io.to('sock:' + p.id).emit('game', room.game.viewFor(p.id));
    }
    // spectators see the leader's public-ish view (still hides hands)
    const specView = room.game.viewFor(room.players[0].id);
    specView.spectator = true;
    delete specView.yourHand;
    io.to(room.code).emit('spectate', specView);
  }
}

function pushDashboard() {
  io.to('dashboard').emit('stats', rooms.stats());
}

// Apply a validated action, broadcast, handle the trick-reveal delay, then let
// the bot take its turn if it's a vs-computer room. Throws on illegal moves.
function performAction(room, pid, action) {
  const game = room.game;
  let result = null;
  switch (action.type) {
    case 'play':
      result = game.play(pid, action.card, !!action.meld);
      break;
    case 'exchange':
      result = game.exchangeTrump(pid);
      break;
    case 'close':
      result = game.close(pid);
      break;
    case 'nextHand':
      if (!game.handOver) throw new Error('Hand is not over');
      if (game.matchOver) throw new Error('Match is over');
      game.startHand();
      break;
    case 'rematch':
      if (!game.matchOver) throw new Error('Match is not over');
      rooms.startGame(room);
      break;
    default:
      throw new Error('Unknown action');
  }
  if (game.matchOver) room.status = 'finished';
  if (result && result.notice) io.to(room.code).emit('notice', result.notice);
  broadcastRoom(room);
  pushDashboard();

  if (game.awaitingResolve) {
    setTimeout(() => {
      if (room.game !== game || !game.awaitingResolve) return;
      try {
        game.resolveTrick();
        if (game.matchOver) room.status = 'finished';
        broadcastRoom(room);
        pushDashboard();
        maybeBot(room);
      } catch (_) {
        /* room may have been swept */
      }
    }, 1500);
  } else {
    maybeBot(room);
  }
}

// If it's the computer's turn, think briefly then act.
function maybeBot(room) {
  const game = room.game;
  if (!room || !room.vsBot || !game) return;
  if (game.handOver || game.matchOver || game.awaitingResolve) return;
  if (game.turn !== room.botId) return;
  setTimeout(() => {
    const g = room.game;
    if (!g || g !== game) return;
    if (g.turn !== room.botId || g.handOver || g.awaitingResolve) return;
    let action;
    try {
      action = chooseMove(g, room.botId);
    } catch (_) {
      action = null;
    }
    // safety net: fall back to any legal card
    if (!action || (action.type === 'play' && !g.legalPlays(room.botId).some((c) => c.rank === action.card.rank && c.suit === action.card.suit))) {
      const legal = g.legalPlays(room.botId);
      if (!legal.length) return;
      action = { type: 'play', card: legal[0] };
    }
    try {
      performAction(room, room.botId, action);
    } catch (_) {
      /* ignore and wait for next state */
    }
  }, 750);
}

io.on('connection', (socket) => {
  socket.data.playerId = null;
  socket.data.roomCode = null;

  const joinRealtime = (room, player) => {
    socket.join(room.code);
    socket.join('sock:' + player.id); // per-player channel for private state
    socket.data.playerId = player.id;
    socket.data.roomCode = room.code;
  };

  socket.on('dashboard:sub', () => {
    socket.join('dashboard');
    socket.emit('stats', rooms.stats());
  });

  socket.on('room:create', ({ name, target, vsBot }, cb) => {
    try {
      const { room, player } = rooms.createRoom(name, clampTarget(target));
      joinRealtime(room, player);
      if (vsBot) {
        rooms.addBot(room);
        rooms.startGame(room);
      }
      cb && cb({ ok: true, code: room.code, playerId: player.id, hostId: room.hostId, vsBot: !!vsBot });
      broadcastRoom(room);
      pushDashboard();
      if (vsBot) maybeBot(room); // bot leads the first hand if it's on lead
    } catch (e) {
      cb && cb({ ok: false, error: e.message });
    }
  });

  socket.on('room:join', ({ code, name }, cb) => {
    try {
      const room = rooms.getRoom(code);
      if (!room) return cb && cb({ ok: false, error: 'Room not found' });
      const player = rooms.addPlayer(room, name);
      joinRealtime(room, player);
      cb &&
        cb({
          ok: true,
          code: room.code,
          playerId: player.id,
          hostId: room.hostId,
          role: player.role,
        });
      broadcastRoom(room);
      pushDashboard();
    } catch (e) {
      cb && cb({ ok: false, error: e.message });
    }
  });

  // reconnect with a known playerId
  socket.on('room:resume', ({ code, playerId }, cb) => {
    const room = rooms.getRoom(code);
    if (!room) return cb && cb({ ok: false, error: 'Room not found' });
    const member = rooms.findMember(room, playerId);
    if (!member) return cb && cb({ ok: false, error: 'You are not in this room' });
    member.connected = true;
    joinRealtime(room, member);
    cb && cb({ ok: true, code: room.code, playerId, hostId: room.hostId, role: member.role });
    broadcastRoom(room);
    pushDashboard();
  });

  socket.on('room:start', (_data, cb) => {
    const room = rooms.getRoom(socket.data.roomCode);
    if (!room) return cb && cb({ ok: false, error: 'No room' });
    if (socket.data.playerId !== room.hostId)
      return cb && cb({ ok: false, error: 'Only the host can start' });
    try {
      rooms.startGame(room);
      cb && cb({ ok: true });
      broadcastRoom(room);
      pushDashboard();
    } catch (e) {
      cb && cb({ ok: false, error: e.message });
    }
  });

  // game actions
  socket.on('game:action', (action, cb) => {
    const room = rooms.getRoom(socket.data.roomCode);
    if (!room || !room.game) return cb && cb({ ok: false, error: 'No active game' });
    const pid = socket.data.playerId;
    if (!room.players.some((p) => p.id === pid))
      return cb && cb({ ok: false, error: 'Spectators cannot act' });
    try {
      performAction(room, pid, action);
      cb && cb({ ok: true });
    } catch (e) {
      cb && cb({ ok: false, error: e.message });
    }
  });

  socket.on('disconnect', () => {
    const room = rooms.getRoom(socket.data.roomCode);
    if (!room) return;
    const member = rooms.findMember(room, socket.data.playerId);
    if (member) member.connected = false;
    broadcastRoom(room);
    pushDashboard();
  });
});

function clampTarget(t) {
  const n = parseInt(t, 10);
  if (!Number.isFinite(n)) return 11;
  return Math.min(21, Math.max(3, n));
}

setInterval(() => {
  rooms.sweep();
  pushDashboard();
}, 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Santase 66 server running on http://localhost:${PORT}`);
  console.log(`Dashboard: http://localhost:${PORT}/dashboard`);
});
