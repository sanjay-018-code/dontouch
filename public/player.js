const socket = io();

const joinScreen = document.getElementById('joinScreen');
const gameScreen = document.getElementById('gameScreen');
const roomCodeInput = document.getElementById('roomCodeInput');
const nameInput = document.getElementById('nameInput');
const joinBtn = document.getElementById('joinBtn');
const joinError = document.getElementById('joinError');

const roomBadge = document.getElementById('roomBadge');
const scoreText = document.getElementById('scoreText');
const statusText = document.getElementById('statusText');
const roundBadge = document.getElementById('roundBadge');
const pressBtn = document.getElementById('pressBtn');
const eliminatedBanner = document.getElementById('eliminatedBanner');

let roomCode = localStorage.getItem('dpi_p_roomCode');
let playerToken = localStorage.getItem('dpi_p_token');
let myId = localStorage.getItem('dpi_p_id');
let savedName = localStorage.getItem('dpi_p_name') || '';

nameInput.value = savedName;
if (roomCode) roomCodeInput.value = roomCode;

function doJoin(code, name) {
  joinBtn.disabled = true;
  socket.emit('player:join', { roomCode: code, name, playerToken }, res => {
    joinBtn.disabled = false;
    if (!res.ok) { joinError.textContent = res.error || 'Could not join.'; return; }
    roomCode = res.state.code;
    playerToken = res.playerToken;
    myId = res.playerId;
    localStorage.setItem('dpi_p_roomCode', roomCode);
    localStorage.setItem('dpi_p_token', playerToken);
    localStorage.setItem('dpi_p_id', myId);
    localStorage.setItem('dpi_p_name', name);
    showGame();
    render(res.state);
  });
}

joinBtn.addEventListener('click', () => {
  // Unlock audio on this user gesture so later beeps (triggered by server events) aren't blocked.
  try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
  const code = roomCodeInput.value.trim().toUpperCase();
  const name = nameInput.value.trim() || 'Player';
  if (code.length !== 4) { joinError.textContent = 'Enter the 4-letter room code.'; return; }
  doJoin(code, name);
});

// Auto-resume if we already joined this room in this browser
if (roomCode && playerToken && myId) {
  doJoin(roomCode, savedName || 'Player');
}

function showGame() {
  joinScreen.style.display = 'none';
  gameScreen.style.display = 'flex';
  roomBadge.textContent = `Room ${roomCode}`;
}

let currentPhase = null;
let pressedThisRound = false;
let lastCountdownValue = null;

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

socket.on('state', state => {
  if (state.code !== roomCode) return;
  render(state);
});

function render(state) {
  document.documentElement.style.setProperty('--go', state.settings.goColor);
  document.documentElement.style.setProperty('--danger', state.settings.dangerColor);

  const me = state.players.find(p => p.id === myId);
  scoreText.textContent = `${me ? me.score : 0} pts`;

  if (state.phase === 'countdown') {
    if (state.countdownValue !== lastCountdownValue) {
      lastCountdownValue = state.countdownValue;
      beep(state.countdownValue === 1 ? 1100 : 700, 150);
    }
  } else {
    lastCountdownValue = null;
  }

  if (me && me.eliminated) {
    eliminatedBanner.style.display = 'block';
  } else {
    eliminatedBanner.style.display = 'none';
  }

  if (state.roundIndex > 0 && state.phase !== 'lobby') {
    roundBadge.style.display = 'inline-block';
    roundBadge.textContent = `Round ${state.roundIndex} / ${state.totalRounds}`;
  } else {
    roundBadge.style.display = 'none';
  }

  if (state.phase !== currentPhase) {
    pressedThisRound = false;
    currentPhase = state.phase;
  }

  gameScreen.className = 'player-screen';
  pressBtn.className = 'press-btn';

  const eliminated = !!(me && me.eliminated);

  if (state.phase === 'lobby') {
    statusText.className = 'status-text wait';
    statusText.textContent = "Waiting for the host to start...";
    pressBtn.disabled = true;
    pressBtn.textContent = 'PRESS';
  } else if (state.phase === 'waiting') {
    statusText.className = 'status-text wait';
    statusText.textContent = eliminated ? "You're out — watching this one." : 'Get ready...';
    pressBtn.disabled = true;
    pressBtn.textContent = 'WAIT';
  } else if (state.phase === 'countdown') {
    statusText.className = 'status-text wait';
    statusText.textContent = 'Round starting in...';
    pressBtn.disabled = true;
    pressBtn.textContent = String(state.countdownValue);
  } else if (state.phase === 'live') {
    if (state.currentSignal === 'PRESS_NOW') {
      gameScreen.classList.add('live-go');
      pressBtn.classList.add('go');
      statusText.className = 'status-text go';
      statusText.textContent = 'PRESS NOW!';
      pressBtn.textContent = 'PRESS!';
    } else {
      gameScreen.classList.add('live-danger');
      pressBtn.classList.add('danger');
      statusText.className = 'status-text danger';
      statusText.textContent = "DON'T PRESS!";
      pressBtn.textContent = 'DON\'T!';
    }
    pressBtn.disabled = eliminated || pressedThisRound;
  } else if (state.phase === 'result') {
    statusText.className = 'status-text wait';
    statusText.textContent = 'Round over.';
    pressBtn.disabled = true;
    pressBtn.textContent = 'PRESS';
  } else if (state.phase === 'ended') {
    statusText.className = 'status-text wait';
    const rank = state.players.findIndex(p => p.id === myId) + 1;
    statusText.textContent = rank ? `Game over — you placed #${rank}!` : 'Game over!';
    pressBtn.disabled = true;
    pressBtn.textContent = 'GAME OVER';
  }
}

pressBtn.addEventListener('click', () => {
  if (pressBtn.disabled) return;
  pressedThisRound = true;
  pressBtn.disabled = true;
  if (navigator.vibrate) navigator.vibrate(30);
  socket.emit('player:press', { roomCode });
});

socket.on('kicked', () => {
  localStorage.removeItem('dpi_p_roomCode');
  localStorage.removeItem('dpi_p_token');
  localStorage.removeItem('dpi_p_id');
  alert("You've been removed from the game.");
  location.reload();
});
