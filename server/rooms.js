'use strict';

const { SantaseGame } = require('./santase');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 confusion

function makeCode(existing) {
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
  } while (existing.has(code));
  return code;
}

function makePlayerId() {
  return 'p_' + Math.random().toString(36).slice(2, 10);
}

class RoomManager {
  constructor() {
    /** @type {Map<string, Room>} */
    this.rooms = new Map();
    this.createdCount = 0;
  }

  createRoom(hostName, target = 11) {
    const code = makeCode(new Set(this.rooms.keys()));
    const room = {
      code,
      createdAt: Date.now(),
      status: 'lobby', // lobby | playing | finished
      target,
      players: [], // {id, name, connected}
      spectators: [], // {id, name}
      hostId: null,
      game: null,
      chat: [],
    };
    this.rooms.set(code, room);
    this.createdCount += 1;
    const player = this.addPlayer(room, hostName);
    room.hostId = player.id;
    return { room, player };
  }

  addPlayer(room, name) {
    const id = makePlayerId();
    const clean = (name || 'Player').toString().slice(0, 20).trim() || 'Player';
    if (room.players.length < 2 && room.status === 'lobby') {
      const p = { id, name: clean, connected: true, role: 'player' };
      room.players.push(p);
      return p;
    }
    const s = { id, name: clean, connected: true, role: 'spectator' };
    room.spectators.push(s);
    return s;
  }

  getRoom(code) {
    return this.rooms.get((code || '').toUpperCase());
  }

  findMember(room, playerId) {
    return (
      room.players.find((p) => p.id === playerId) ||
      room.spectators.find((s) => s.id === playerId) ||
      null
    );
  }

  startGame(room) {
    if (room.players.length !== 2) throw new Error('Need two players to start');
    const ids = room.players.map((p) => p.id);
    const game = new SantaseGame(ids, { target: room.target });
    game.names = {};
    room.players.forEach((p) => (game.names[p.id] = p.name));
    room.game = game;
    room.status = 'playing';
    return game;
  }

  nextHand(room) {
    if (!room.game) throw new Error('No game');
    if (room.game.matchOver) return;
    room.game.startHand();
  }

  removeRoom(code) {
    this.rooms.delete(code);
  }

  // housekeeping: drop empty / stale rooms
  sweep() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      const anyConnected =
        room.players.some((p) => p.connected) || room.spectators.some((s) => s.connected);
      const age = now - room.createdAt;
      if (!anyConnected && age > 1000 * 60 * 30) {
        this.rooms.delete(code);
      }
    }
  }

  stats() {
    const rooms = [...this.rooms.values()].map((r) => ({
      code: r.code,
      status: r.status,
      players: r.players.map((p) => ({ name: p.name, connected: p.connected })),
      spectators: r.spectators.length,
      target: r.target,
      handNumber: r.game ? r.game.handNumber : 0,
      matchPoints: r.game ? r.game.matchPoints : null,
      ageSeconds: Math.floor((Date.now() - r.createdAt) / 1000),
    }));
    return {
      totalRoomsCreated: this.createdCount,
      activeRooms: this.rooms.size,
      playing: rooms.filter((r) => r.status === 'playing').length,
      inLobby: rooms.filter((r) => r.status === 'lobby').length,
      playersOnline: rooms.reduce(
        (n, r) => n + r.players.filter((p) => p.connected).length,
        0
      ),
      rooms,
    };
  }
}

module.exports = { RoomManager };
