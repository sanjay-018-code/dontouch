const socket = io();

const loginScreen = document.getElementById('loginScreen');
const consoleEl = document.getElementById('console');
const orgNameInput = document.getElementById('orgName');
const createBtn = document.getElementById('createBtn');
const loginError = document.getElementById('loginError');

const roomCodeText = document.getElementById('roomCodeText');
const roundTag = document.getElementById('roundTag');
const stage = document.getElementById('stage');
const signalText = document.getElementById('signalText');
const stageMeta = document.getElementById('stageMeta');
const startBtn = document.getElementById('startBtn');
const resetBtn = document.getElementById('resetBtn');
const resultPanel = document.getElementById('resultPanel');
const resultList = document.getElementById('resultList');
const playerCount = document.getElementById('playerCount');
const playerList = document.getElementById('playerList');
const settingsError = document.getElementById('settingsError');
const settingsHint = document.getElementById('settingsHint');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const signalPicker = document.getElementById('signalPicker');
const pickHint = document.getElementById('pickHint');
const settingsPanel = document.getElementById('settingsPanel');

// The organizer's pick for the NEXT round: 'PRESS_NOW' | 'DONT_PRESS' | 'RANDOM'.
// It is chosen fresh before every round (resets to Random after each round starts).
let nextSignal = 'RANDOM';
// True once the organizer has typed into the settings form. While true, incoming server
// updates (players joining/leaving etc.) must NOT overwrite what they're typing.
let settingsDirty = false;

let roomCode = localStorage.getItem('dpi_roomCode');
let organizerToken = localStorage.getItem('dpi_organizerToken');

function settingsFields() {
  return {
    rounds: document.getElementById('s_rounds'),
    minWait: document.getElementById('s_minWait'),
    maxWait: document.getElementById('s_maxWait'),
    window: document.getElementById('s_window'),
    dontPress: document.getElementById('s_dontPress'),
    p1: document.getElementById('s_p1'),
    p2: document.getElementById('s_p2'),
    p3: document.getElementById('s_p3'),
    goColor: document.getElementById('s_goColor'),
    dangerColor: document.getElementById('s_dangerColor')
  };
}

function fillSettings(settings) {
  const f = settingsFields();
  f.rounds.value = settings.rounds;
  f.minWait.value = settings.minWaitMs / 1000;
  f.maxWait.value = settings.maxWaitMs / 1000;
  f.window.value = settings.pressWindowMs / 1000;
  f.dontPress.value = Math.round(settings.dontPressChance * 100);
  f.p1.value = settings.pointsFirst;
  f.p2.value = settings.pointsSecond;
  f.p3.value = settings.pointsThird;
  f.goColor.value = settings.goColor;
  f.dangerColor.value = settings.dangerColor;
}

function readSettings() {
  const f = settingsFields();
  return {
    rounds: f.rounds.value,
    minWaitMs: Number(f.minWait.value) * 1000,
    maxWaitMs: Number(f.maxWait.value) * 1000,
    pressWindowMs: Number(f.window.value) * 1000,
    dontPressChance: Number(f.dontPress.value) / 100,
    pointsFirst: f.p1.value,
    pointsSecond: f.p2.value,
    pointsThird: f.p3.value,
    goColor: f.goColor.value,
    dangerColor: f.dangerColor.value
  };
}

// --- simple beep via Web Audio API, no audio files needed ---
let audioCtx = null;
function beep(freq = 880, durationMs = 140) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + durationMs / 1000);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + durationMs / 1000);
  } catch (e) { /* audio not available — ignore */ }
}

let lastCountdownValue = null;

function showConsole() {
  loginScreen.style.display = 'none';
  consoleEl.style.display = 'flex';
}

createBtn.addEventListener('click', () => {
  const name = orgNameInput.value.trim();
  createBtn.disabled = true;
  socket.emit('organizer:create', { name }, res => {
    createBtn.disabled = false;
    if (!res.ok) { loginError.textContent = res.error || 'Could not create room.'; return; }
    roomCode = res.roomCode;
    organizerToken = res.organizerToken;
    localStorage.setItem('dpi_roomCode', roomCode);
    localStorage.setItem('dpi_organizerToken', organizerToken);
    showConsole();
    render(res.state);
  });
});

// Try to resume an existing room on load
if (roomCode && organizerToken) {
  socket.emit('organizer:rejoin', { roomCode, organizerToken }, res => {
    if (res.ok) {
      showConsole();
      render(res.state);
    } else {
      localStorage.removeItem('dpi_roomCode');
      localStorage.removeItem('dpi_organizerToken');
    }
  });
}

socket.on('state', render);

function updatePicker(disabled) {
  signalPicker.querySelectorAll('.pick').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.signal === nextSignal);
    btn.disabled = disabled;
  });
  pickHint.textContent = nextSignal === 'RANDOM'
    ? 'Random: uses the "Don\'t-press odds" from the settings.'
    : `You chose: ${nextSignal === 'PRESS_NOW' ? 'PRESS' : "DON'T PRESS"} for the next round. (Hide this panel if players can see your screen!)`;
}

signalPicker.querySelectorAll('.pick').forEach(btn => {
  btn.addEventListener('click', () => {
    nextSignal = btn.dataset.signal;
    updatePicker(false);
  });
});

settingsPanel.addEventListener('input', () => { settingsDirty = true; });

startBtn.addEventListener('click', () => {
  // Send the current form values along with the pick, so edits are applied even if Save wasn't clicked.
  socket.emit('organizer:startRound', { roomCode, settings: readSettings(), nextSignal }, res => {
    if (!res.ok) { stageMeta.textContent = res.error || ''; return; }
    settingsDirty = false;
    nextSignal = 'RANDOM'; // decide again before every round
  });
});

resetBtn.addEventListener('click', () => {
  if (!confirm('Reset scores and start the game over?')) return;
  socket.emit('organizer:resetGame', { roomCode });
});

saveSettingsBtn.addEventListener('click', () => {
  settingsError.textContent = '';
  socket.emit('organizer:updateSettings', { roomCode, settings: readSettings() }, res => {
    if (!res.ok) { settingsError.textContent = res.error || 'Could not save settings.'; return; }
    settingsDirty = false;
  });
});

function renderPlayers(players) {
  playerCount.textContent = players.length;
  playerList.innerHTML = '';
  if (players.length === 0) {
    playerList.innerHTML = '<div style="color:var(--text-dim); font-size:14px;">No players yet — share the room code.</div>';
    return;
  }
  players.forEach(p => {
    const row = document.createElement('div');
    row.className = 'player-row' + (p.eliminated ? ' eliminated' : '');
    row.innerHTML = `
      <div class="name">
        <span class="dot ${p.connected ? '' : 'off'}"></span>
        <span>${escapeHtml(p.name)}</span>
      </div>
      <div style="display:flex; align-items:center; gap:10px;">
        <span class="score">${p.score}</span>
        <button class="kick" data-id="${p.id}">kick</button>
      </div>`;
    playerList.appendChild(row);
  });
  playerList.querySelectorAll('.kick').forEach(btn => {
    btn.addEventListener('click', () => {
      socket.emit('organizer:kickPlayer', { roomCode, playerId: btn.dataset.id });
    });
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function render(state) {
  roomCodeText.textContent = state.code;

  // Apply this round's colors live, everywhere they're used.
  document.documentElement.style.setProperty('--go', state.settings.goColor);
  document.documentElement.style.setProperty('--danger', state.settings.dangerColor);

  // Everything (rounds, timing, odds, points, colors) can be edited in the lobby and between
  // rounds. Only locked while a round is actually running.
  const canEditAny = state.phase === 'lobby' || state.phase === 'result';
  const f = settingsFields();
  Object.values(f).forEach(el => { el.disabled = !canEditAny; });
  saveSettingsBtn.disabled = !canEditAny;
  settingsHint.textContent = canEditAny ? '' : 'Settings lock while a round is in progress.';
  // Refresh the form from the server, but never clobber edits the organizer is in the middle of.
  if (canEditAny && !settingsDirty) fillSettings(state.settings);
  updatePicker(!canEditAny);

  renderPlayers(state.players);

  stage.className = 'stage';
  resultPanel.style.display = 'none';

  if (state.phase === 'countdown') {
    if (state.countdownValue !== lastCountdownValue) {
      lastCountdownValue = state.countdownValue;
      beep(state.countdownValue === 1 ? 1100 : 700, 150);
    }
  } else {
    lastCountdownValue = null;
  }

  if (state.phase === 'lobby') {
    roundTag.textContent = 'Lobby';
    signalText.className = 'signal wait';
    signalText.textContent = 'WAITING FOR PLAYERS';
    stageMeta.textContent = `${state.totalRounds} rounds configured — press Start when ready.`;
    startBtn.disabled = state.players.length === 0;
    startBtn.textContent = 'Start round';
  } else if (state.phase === 'countdown') {
    roundTag.textContent = `Round ${state.roundIndex} / ${state.totalRounds}`;
    signalText.className = 'countdown-num';
    signalText.textContent = String(state.countdownValue);
    stageMeta.textContent = 'Get ready...';
    startBtn.disabled = true;
  } else if (state.phase === 'waiting') {
    roundTag.textContent = `Round ${state.roundIndex} / ${state.totalRounds}`;
    signalText.className = 'signal wait';
    signalText.textContent = 'WAIT...';
    stageMeta.textContent = 'Signal incoming — keep players on their toes.';
    startBtn.disabled = true;
  } else if (state.phase === 'live') {
    roundTag.textContent = `Round ${state.roundIndex} / ${state.totalRounds}`;
    if (state.currentSignal === 'PRESS_NOW') {
      stage.classList.add('live-go');
      signalText.className = 'signal go';
      signalText.textContent = '🟢 PRESS NOW!';
      stageMeta.textContent = 'Fastest three score points.';
    } else {
      stage.classList.add('live-danger');
      signalText.className = 'signal danger';
      signalText.textContent = '🔴 DON\'T PRESS!';
      stageMeta.textContent = 'Anyone who presses is eliminated.';
    }
    startBtn.disabled = true;
  } else if (state.phase === 'collecting') {
    roundTag.textContent = `Round ${state.roundIndex} / ${state.totalRounds}`;
    signalText.className = 'signal wait';
    signalText.textContent = 'TIME\'S UP';
    stageMeta.textContent = 'Collecting last presses...';
    startBtn.disabled = true;
  } else if (state.phase === 'result') {
    roundTag.textContent = `Round ${state.roundIndex} / ${state.totalRounds}`;
    signalText.className = 'signal wait';
    signalText.textContent = 'ROUND OVER';
    stageMeta.textContent = state.roundIndex >= state.totalRounds ? 'Last round complete.' : 'Ready for the next round.';
    startBtn.disabled = false;
    startBtn.textContent = state.roundIndex >= state.totalRounds ? 'Show final results' : 'Start next round';
    showResult(state.lastResult);
  } else if (state.phase === 'ended') {
    roundTag.textContent = 'Game over';
    signalText.className = 'signal wait';
    signalText.textContent = '🏁 GAME OVER';
    const top = state.players[0];
    stageMeta.textContent = top ? `${top.name} wins with ${top.score} points!` : 'No players scored.';
    startBtn.disabled = true;
    startBtn.textContent = 'Start round';
    showResult(state.lastResult);
  }
}

function showResult(result) {
  if (!result) return;
  resultPanel.style.display = 'block';
  if (result.signal === 'PRESS_NOW') {
    if (result.winners.length === 0) {
      resultList.innerHTML = 'Nobody pressed in time.';
    } else {
      resultList.innerHTML = result.winners
        .map((w, i) => `<div><span class="win">#${i + 1} ${escapeHtml(w.name)}</span> — +${w.points} pts (${w.ms}ms)</div>`)
        .join('');
    }
  } else {
    resultList.innerHTML = result.eliminated.length === 0
      ? 'Nobody pressed — everyone survives!'
      : result.eliminated.map(e => `<div><span class="out">💀 ${escapeHtml(e.name)} eliminated</span></div>`).join('');
  }
}

socket.on('kicked', () => {
  alert('This organizer session was removed.');
});
