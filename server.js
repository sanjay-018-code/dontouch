// server.js — "Don't Press It!" game server
// In-memory rooms. Organizer controls settings + round flow, players press a button.

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ---------- helpers ----------

function makeRoomCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O to avoid confusion
  let code;
  do {
    code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function makeToken() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const DEFAULT_SETTINGS = {
  rounds: 8,          // total rounds in a game
  minWaitMs: 2000,     // shortest delay before a signal appears
  maxWaitMs: 6000,     // longest delay before a signal appears
  pressWindowMs: 2500, // how long the signal stays live
  dontPressChance: 0.35, // probability a round is "DON'T PRESS"
  pointsFirst: 5,
  pointsSecond: 3,
  pointsThird: 1,
  goColor: '#2fe07a',     // "PRESS NOW" signal color, editable per round
  dangerColor: '#ff3b3b'  // "DON'T PRESS" signal color, editable per round
};

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
const COUNTDOWN_START = 3; // seconds counted down before each round

// rooms: Map<roomCode, RoomState>
const rooms = new Map();

function newRoom(organizerName) {
  const code = makeRoomCode();
  const organizerToken = makeToken();
  const room = {
    code,
    organizerToken,
    organizerName: organizerName || 'Organizer',
    settings: { ...DEFAULT_SETTINGS },
    players: new Map(), // playerToken -> { id, name, score, eliminated, connected, socketId }
    phase: 'lobby',     // lobby | countdown | waiting | live | result | ended
    roundIndex: 0,
    countdownValue: null,
    currentSignal: null, // 'PRESS_NOW' | 'DONT_PRESS'
    signalStartedAt: null,
    presses: [],          // [{ playerToken, name, atMs }] for the current live round
    lastResult: null,
    timers: {}
  };
  rooms.set(code, room);
  return room;
}

function clearTimers(room) {
  Object.values(room.timers).forEach(t => clearTimeout(t));
  room.timers = {};
}

function publicPlayers(room) {
  return Array.from(room.players.values())
    .map(p => ({ id: p.id, name: p.name, score: p.score, eliminated: p.eliminated, connected: p.connected }))
    .sort((a, b) => b.score - a.score);
}

function publicState(room) {
  return {
    code: room.code,
    organizerName: room.organizerName,
    settings: room.settings,
    phase: room.phase,
    roundIndex: room.roundIndex,
    totalRounds: room.settings.rounds,
    countdownValue: room.phase === 'countdown' ? room.countdownValue : null,
    currentSignal: room.phase === 'live' ? room.currentSignal : null,
    players: publicPlayers(room),
    lastResult: room.lastResult
  };
}

function broadcast(room) {
  io.to(room.code).emit('state', publicState(room));
}

function activePlayers(room) {
  return Array.from(room.players.values()).filter(p => !p.eliminated);
}

function startRound(room) {
  if (room.phase === 'ended') return;
  if (room.roundIndex >= room.settings.rounds) {
    endGame(room);
    return;
  }
  clearTimers(room);
  room.roundIndex += 1;
  room.currentSignal = null;
  room.presses = [];
  room.lastResult = null;
  runCountdown(room, COUNTDOWN_START);
}

function runCountdown(room, value) {
  room.phase = 'countdown';
  room.countdownValue = value;
  broadcast(room);

  if (value <= 1) {
    room.timers.toWait = setTimeout(() => beginWait(room), 1000);
    return;
  }
  room.timers.tick = setTimeout(() => runCountdown(room, value - 1), 1000);
}

function beginWait(room) {
  if (room.phase !== 'countdown') return;
  room.phase = 'waiting';
  room.countdownValue = null;
  broadcast(room);

  const { minWaitMs, maxWaitMs } = room.settings;
  const wait = Math.floor(minWaitMs + Math.random() * Math.max(0, maxWaitMs - minWaitMs));

  room.timers.toSignal = setTimeout(() => goLive(room), wait);
}

function goLive(room) {
  if (room.phase !== 'waiting') return;
  room.phase = 'live';
  room.currentSignal = Math.random() < room.settings.dontPressChance ? 'DONT_PRESS' : 'PRESS_NOW';
  room.signalStartedAt = Date.now();
  room.presses = [];
  broadcast(room);

  room.timers.toResult = setTimeout(() => resolveRound(room), room.settings.pressWindowMs);
}

function resolveRound(room) {
  if (room.phase !== 'live') return;
  clearTimers(room);

  const signal = room.currentSignal;
  let result;

  if (signal === 'PRESS_NOW') {
    const ranked = room.presses.slice().sort((a, b) => a.atMs - b.atMs);
    const pointsTable = [room.settings.pointsFirst, room.settings.pointsSecond, room.settings.pointsThird];
    const winners = ranked.slice(0, 3).map((p, i) => {
      const player = room.players.get(p.playerToken);
      const pts = pointsTable[i] || 0;
      if (player) player.score += pts;
      return { name: p.name, points: pts, ms: Math.round(p.atMs - room.signalStartedAt) };
    });
    result = { signal, winners, eliminated: [] };
  } else {
    // DONT_PRESS — anyone who pressed is eliminated
    const eliminated = [];
    room.presses.forEach(p => {
      const player = room.players.get(p.playerToken);
      if (player && !player.eliminated) {
        player.eliminated = true;
        eliminated.push({ name: p.name });
      }
    });
    result = { signal, winners: [], eliminated };
  }

  room.phase = 'result';
  room.currentSignal = null;
  room.lastResult = result;
  broadcast(room);
}

function endGame(room) {
  clearTimers(room);
  room.phase = 'ended';
  room.currentSignal = null;
  room.countdownValue = null;
  broadcast(room);
}

function resetGame(room) {
  clearTimers(room);
  room.phase = 'lobby';
  room.roundIndex = 0;
  room.currentSignal = null;
  room.countdownValue = null;
  room.presses = [];
  room.lastResult = null;
  room.players.forEach(p => {
    p.score = 0;
    p.eliminated = false;
  });
  broadcast(room);
}

// ---------- socket wiring ----------

io.on('connection', socket => {
  // --- organizer ---
  socket.on('organizer:create', ({ name }, cb) => {
    const room = newRoom(name);
    socket.join(room.code);
    socket.data.role = 'organizer';
    socket.data.roomCode = room.code;
    cb && cb({ ok: true, roomCode: room.code, organizerToken: room.organizerToken, state: publicState(room) });
  });

  socket.on('organizer:rejoin', ({ roomCode, organizerToken }, cb) => {
    const room = rooms.get(roomCode);
    if (!room || room.organizerToken !== organizerToken) {
      cb && cb({ ok: false, error: 'Room not found.' });
      return;
    }
    socket.join(room.code);
    socket.data.role = 'organizer';
    socket.data.roomCode = room.code;
    cb && cb({ ok: true, roomCode: room.code, organizerToken: room.organizerToken, state: publicState(room) });
  });

  function requireOrganizer(socket, room) {
    return room && socket.data.role === 'organizer' && socket.data.roomCode === room.code;
  }

  socket.on('organizer:updateSettings', ({ roomCode, settings }, cb) => {
    const room = rooms.get(roomCode);
    if (!requireOrganizer(socket, room)) return cb && cb({ ok: false, error: 'Not authorized.' });
    // Points and colors can change between rounds (lobby or right after a round resolves).
    // Timing settings (rounds/wait/window/odds) are locked once the game is underway to keep rounds fair.
    if (room.phase !== 'lobby' && room.phase !== 'result') {
      return cb && cb({ ok: false, error: 'Wait for the round to finish before changing settings.' });
    }

    const s = room.settings;
    const clamp = (v, lo, hi, fallback) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return fallback;
      return Math.min(hi, Math.max(lo, n));
    };
    const color = (v, fallback) => (typeof v === 'string' && HEX_COLOR_RE.test(v)) ? v : fallback;

    if (room.phase === 'lobby') {
      // Timing/structure settings only editable before the game starts at all.
      s.rounds = clamp(settings.rounds, 1, 50, s.rounds);
      s.minWaitMs = clamp(settings.minWaitMs, 500, 20000, s.minWaitMs);
      s.maxWaitMs = clamp(settings.maxWaitMs, s.minWaitMs, 30000, s.maxWaitMs);
      s.pressWindowMs = clamp(settings.pressWindowMs, 500, 10000, s.pressWindowMs);
      s.dontPressChance = clamp(settings.dontPressChance, 0, 0.9, s.dontPressChance);
    }

    // Points and colors: editable in lobby AND between rounds, so the organizer
    // can change the stakes/look round to round.
    s.pointsFirst = clamp(settings.pointsFirst, 0, 100, s.pointsFirst);
    s.pointsSecond = clamp(settings.pointsSecond, 0, 100, s.pointsSecond);
    s.pointsThird = clamp(settings.pointsThird, 0, 100, s.pointsThird);
    s.goColor = color(settings.goColor, s.goColor);
    s.dangerColor = color(settings.dangerColor, s.dangerColor);

    broadcast(room);
    cb && cb({ ok: true });
  });

  socket.on('organizer:startRound', ({ roomCode }, cb) => {
    const room = rooms.get(roomCode);
    if (!requireOrganizer(socket, room)) return cb && cb({ ok: false, error: 'Not authorized.' });
    if (room.phase !== 'lobby' && room.phase !== 'result') {
      return cb && cb({ ok: false, error: 'Round already in progress.' });
    }
    if (activePlayers(room).length === 0 && room.players.size > 0 && room.phase !== 'lobby') {
      // everyone eliminated — end game early
      endGame(room);
      return cb && cb({ ok: true });
    }
    startRound(room);
    cb && cb({ ok: true });
  });

  socket.on('organizer:endGame', ({ roomCode }, cb) => {
    const room = rooms.get(roomCode);
    if (!requireOrganizer(socket, room)) return cb && cb({ ok: false, error: 'Not authorized.' });
    endGame(room);
    cb && cb({ ok: true });
  });

  socket.on('organizer:resetGame', ({ roomCode }, cb) => {
    const room = rooms.get(roomCode);
    if (!requireOrganizer(socket, room)) return cb && cb({ ok: false, error: 'Not authorized.' });
    resetGame(room);
    cb && cb({ ok: true });
  });

  socket.on('organizer:kickPlayer', ({ roomCode, playerId }, cb) => {
    const room = rooms.get(roomCode);
    if (!requireOrganizer(socket, room)) return cb && cb({ ok: false, error: 'Not authorized.' });
    for (const [token, p] of room.players) {
      if (p.id === playerId) {
        room.players.delete(token);
        io.to(p.socketId).emit('kicked');
        break;
      }
    }
    broadcast(room);
    cb && cb({ ok: true });
  });

  // --- player ---
  socket.on('player:join', ({ roomCode, name, playerToken }, cb) => {
    const room = rooms.get((roomCode || '').toUpperCase());
    if (!room) return cb && cb({ ok: false, error: 'Room not found. Check the code.' });

    let token = playerToken && room.players.has(playerToken) ? playerToken : null;
    let player;
    if (token) {
      player = room.players.get(token);
      player.connected = true;
      player.socketId = socket.id;
      if (name) player.name = name.trim().slice(0, 20);
    } else {
      token = makeToken();
      player = {
        id: token.slice(0, 8),
        name: (name || 'Player').trim().slice(0, 20) || 'Player',
        score: 0,
        eliminated: false,
        connected: true,
        socketId: socket.id
      };
      room.players.set(token, player);
    }

    socket.join(room.code);
    socket.data.role = 'player';
    socket.data.roomCode = room.code;
    socket.data.playerToken = token;

    broadcast(room);
    cb && cb({ ok: true, playerToken: token, playerId: player.id, state: publicState(room) });
  });

  socket.on('player:press', ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room || room.phase !== 'live') return;
    const token = socket.data.playerToken;
    const player = room.players.get(token);
    if (!player || player.eliminated) return;
    if (room.presses.some(p => p.playerToken === token)) return; // one press per round
    room.presses.push({ playerToken: token, name: player.name, atMs: Date.now() });
    // let the organizer see live press count without exposing order to players
    io.to(room.code).emit('press:ack', { count: room.presses.length });
  });

  socket.on('disconnect', () => {
    const { role, roomCode, playerToken } = socket.data;
    const room = rooms.get(roomCode);
    if (!room) return;
    if (role === 'player' && playerToken) {
      const player = room.players.get(playerToken);
      if (player) {
        player.connected = false;
        broadcast(room);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Don't Press It! running on http://localhost:${PORT}`);
});
