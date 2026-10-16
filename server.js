import 'dotenv/config';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import bcrypt from 'bcryptjs';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import rateLimit from 'express-rate-limit';
import { Pool } from 'pg';
import { Server as SocketServer } from 'socket.io';
import { generateQuestion, gradeAnswer, isAiEnabled } from './quiz.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = __dirname;
const PORT = Number(process.env.PORT || 3000);
if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL. Configura PostgreSQL en Render o en el archivo .env local.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      username VARCHAR(24) NOT NULL,
      username_normalized VARCHAR(24) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS leagues (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(50) NOT NULL,
      code VARCHAR(8) NOT NULL UNIQUE,
      created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      topic VARCHAR(100) NOT NULL DEFAULT 'Cultura general',
      scoring_mode VARCHAR(12) NOT NULL DEFAULT 'target',
      limit_value INTEGER NOT NULL DEFAULT 5,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS league_members (
      league_id BIGINT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (league_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS league_standings (
      league_id BIGINT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      played INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      points INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (league_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS matches (
      id VARCHAR(40) PRIMARY KEY,
      mode VARCHAR(12) NOT NULL,
      topic VARCHAR(100) NOT NULL,
      scoring_mode VARCHAR(12) NOT NULL,
      limit_value INTEGER NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'lobby',
      league_id BIGINT REFERENCES leagues(id) ON DELETE SET NULL,
      winner_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS match_players (
      match_id VARCHAR(40) NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      score INTEGER NOT NULL DEFAULT 0,
      correct_answers INTEGER NOT NULL DEFAULT 0,
      rebound_points INTEGER NOT NULL DEFAULT 0,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (match_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_match_players_user ON match_players(user_id);
    CREATE INDEX IF NOT EXISTS idx_matches_finished ON matches(status, finished_at DESC);
    CREATE INDEX IF NOT EXISTS idx_leagues_code ON leagues(code);
  `);
}

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '30kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));

const PgSession = connectPgSimple(session);
const sessionMiddleware = session({
  store: new PgSession({ pool, tableName: 'user_sessions', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'local-development-secret-please-change-this',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 30,
  },
});
app.use(sessionMiddleware);

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false });
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/api/config', (_req, res) => res.json({ aiEnabled: isAiEnabled, aiModel: isAiEnabled ? (process.env.OPENAI_MODEL || 'gpt-5.5') : null }));

function validUsername(username) {
  return typeof username === 'string' && /^[\p{L}\p{N}_-]{3,20}$/u.test(username.trim());
}
function validPassword(password) {
  return typeof password === 'string' && password.length >= 8 && password.length <= 128;
}
function makeCode(length = 6) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < length; i += 1) result += alphabet[crypto.randomInt(0, alphabet.length)];
  return result;
}
function cleanCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}
function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
function currentUserId(req) {
  return req.session?.userId ? String(req.session.userId) : null;
}
function requireAuth(req, res, next) {
  if (!currentUserId(req)) return res.status(401).json({ error: 'Inicia sesión para continuar.' });
  next();
}

app.post('/api/register', authLimiter, async (req, res) => {
  const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
  const password = req.body.password;
  if (!validUsername(username)) {
    return res.status(400).json({ error: 'El usuario debe tener entre 3 y 20 caracteres y solo puede incluir letras, números, guion y guion bajo.' });
  }
  if (!validPassword(password)) return res.status(400).json({ error: 'La contraseña debe tener entre 8 y 128 caracteres.' });
  try {
    const hash = await bcrypt.hash(password, 12);
    const normalized = username.toLocaleLowerCase('es');
    const { rows } = await pool.query(
      'INSERT INTO users (username, username_normalized, password_hash) VALUES ($1,$2,$3) RETURNING id, username, created_at',
      [username, normalized, hash],
    );
    req.session.userId = String(rows[0].id);
    req.session.username = rows[0].username;
    return req.session.save((error) => error ? res.status(500).json({ error: 'No se pudo guardar la sesión.' }) : res.status(201).json({ user: { id: String(rows[0].id), username: rows[0].username } }));
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Ese nombre de usuario ya está ocupado.' });
    console.error('Error de registro:', error);
    return res.status(500).json({ error: 'No se pudo crear el perfil. Inténtalo de nuevo.' });
  }
});

app.post('/api/login', authLimiter, async (req, res) => {
  const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
  const password = req.body.password;
  if (!username || typeof password !== 'string') return res.status(400).json({ error: 'Introduce usuario y contraseña.' });
  try {
    const { rows } = await pool.query('SELECT id, username, password_hash FROM users WHERE username_normalized=$1', [username.toLocaleLowerCase('es')]);
    if (!rows.length || !(await bcrypt.compare(password, rows[0].password_hash))) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
    }
    req.session.userId = String(rows[0].id);
    req.session.username = rows[0].username;
    return req.session.save((error) => error ? res.status(500).json({ error: 'No se pudo guardar la sesión.' }) : res.json({ user: { id: String(rows[0].id), username: rows[0].username } }));
  } catch (error) {
    console.error('Error de inicio de sesión:', error);
    return res.status(500).json({ error: 'No se pudo iniciar sesión.' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy((error) => {
    if (error) return res.status(500).json({ error: 'No se pudo cerrar la sesión.' });
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

async function profilePayload(userId) {
  const { rows: userRows } = await pool.query('SELECT id, username, created_at FROM users WHERE id=$1', [userId]);
  if (!userRows.length) return null;
  const { rows: statRows } = await pool.query(`
    SELECT COUNT(*) FILTER (WHERE m.status='finished')::int AS played,
      COUNT(*) FILTER (WHERE m.status='finished' AND m.winner_id=$1)::int AS wins,
      COUNT(*) FILTER (WHERE m.status='finished' AND m.winner_id IS NOT NULL AND m.winner_id<>$1)::int AS losses,
      COALESCE(SUM(mp.correct_answers) FILTER (WHERE m.status='finished'),0)::int AS correct_answers,
      COALESCE(SUM(mp.rebound_points) FILTER (WHERE m.status='finished'),0)::int AS rebound_points
    FROM match_players mp JOIN matches m ON m.id=mp.match_id WHERE mp.user_id=$1
  `, [userId]);
  const { rows: history } = await pool.query(`
    SELECT m.id, m.mode, m.topic, m.scoring_mode, m.limit_value, m.created_at, m.finished_at, m.winner_id,
      mp.score, CASE WHEN m.winner_id=$1 THEN 'win' WHEN m.winner_id IS NULL THEN 'unknown' ELSE 'loss' END AS result
    FROM match_players mp JOIN matches m ON m.id=mp.match_id
    WHERE mp.user_id=$1 AND m.status='finished'
    ORDER BY m.finished_at DESC NULLS LAST LIMIT 10
  `, [userId]);
  return { user: { id: String(userRows[0].id), username: userRows[0].username, createdAt: userRows[0].created_at }, stats: statRows[0], history };
}

app.get('/api/me', requireAuth, async (req, res) => {
  try {
    const data = await profilePayload(currentUserId(req));
    if (!data) return res.status(401).json({ error: 'El perfil ya no existe. Vuelve a crear una cuenta.' });
    res.json({ ...data, aiEnabled: isAiEnabled });
  } catch (error) {
    console.error('Error cargando perfil:', error);
    res.status(500).json({ error: 'No se pudo cargar el perfil.' });
  }
});

function validateLeagueSettings(body) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length < 3 || name.length > 50) throw new Error('El nombre de la liga debe tener entre 3 y 50 caracteres.');
  const scoringMode = body.scoringMode === 'questions' ? 'questions' : 'target';
  const limitValue = scoringMode === 'questions' ? clampInt(body.limitValue, 3, 100, 15) : clampInt(body.limitValue, 1, 50, 5);
  const topic = typeof body.topic === 'string' ? body.topic.trim().slice(0, 100) : 'Cultura general';
  return { name, scoringMode, limitValue, topic: topic || 'Cultura general' };
}

async function leaguePayload(code, userId) {
  const { rows: leagueRows } = await pool.query('SELECT * FROM leagues WHERE code=$1', [code]);
  if (!leagueRows.length) return null;
  const league = leagueRows[0];
  const { rows: membership } = await pool.query('SELECT 1 FROM league_members WHERE league_id=$1 AND user_id=$2', [league.id, userId]);
  if (!membership.length) return { notMember: true };
  const { rows: standings } = await pool.query(`
    SELECT u.id, u.username, ls.played, ls.wins, ls.losses, ls.points
    FROM league_members lm JOIN users u ON u.id=lm.user_id
    JOIN league_standings ls ON ls.league_id=lm.league_id AND ls.user_id=lm.user_id
    WHERE lm.league_id=$1
    ORDER BY ls.points DESC, ls.wins DESC, u.username ASC
  `, [league.id]);
  const { rows: recentMatches } = await pool.query(`
    SELECT m.id, m.topic, m.finished_at, m.winner_id,
      winner.username AS winner_username,
      (SELECT STRING_AGG(u.username, ', ' ORDER BY u.username)
       FROM match_players mp2 JOIN users u ON u.id=mp2.user_id WHERE mp2.match_id=m.id) AS players
    FROM matches m LEFT JOIN users winner ON winner.id=m.winner_id
    WHERE m.league_id=$1 AND m.status='finished'
    ORDER BY m.finished_at DESC LIMIT 10
  `, [league.id]);
  return {
    league: {
      id: String(league.id), name: league.name, code: league.code,
      creatorId: String(league.created_by), topic: league.topic,
      scoringMode: league.scoring_mode, limitValue: league.limit_value,
      createdAt: league.created_at,
    },
    standings: standings.map((row) => ({ ...row, id: String(row.id) })),
    recentMatches: recentMatches.map((row) => ({ ...row, id: row.id, winner_id: row.winner_id == null ? null : String(row.winner_id) })),
  };
}

app.get('/api/leagues/my', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT l.id, l.name, l.code, l.topic, l.scoring_mode, l.limit_value,
        COALESCE(ls.points,0)::int AS points, COALESCE(ls.wins,0)::int AS wins,
        (SELECT COUNT(*)::int FROM league_members lm2 WHERE lm2.league_id=l.id) AS member_count
      FROM league_members lm JOIN leagues l ON l.id=lm.league_id
      LEFT JOIN league_standings ls ON ls.league_id=l.id AND ls.user_id=lm.user_id
      WHERE lm.user_id=$1 ORDER BY l.created_at DESC
    `, [currentUserId(req)]);
    res.json({ leagues: rows.map((row) => ({ ...row, id: String(row.id) })) });
  } catch (error) {
    console.error('Error cargando ligas:', error);
    res.status(500).json({ error: 'No se pudieron cargar las ligas.' });
  }
});

app.post('/api/leagues', requireAuth, async (req, res) => {
  let settings;
  try { settings = validateLeagueSettings(req.body || {}); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  const userId = currentUserId(req);
  try {
    let created;
    for (let i = 0; i < 5; i += 1) {
      const code = makeCode();
      try {
        const result = await pool.query(`
          INSERT INTO leagues (name, code, created_by, topic, scoring_mode, limit_value)
          VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, code
        `, [settings.name, code, userId, settings.topic, settings.scoringMode, settings.limitValue]);
        created = result.rows[0];
        break;
      } catch (error) { if (error.code !== '23505') throw error; }
    }
    if (!created) throw new Error('No se pudo generar un código de liga único.');
    await pool.query('INSERT INTO league_members (league_id, user_id) VALUES ($1,$2)', [created.id, userId]);
    await pool.query('INSERT INTO league_standings (league_id, user_id) VALUES ($1,$2)', [created.id, userId]);
    const data = await leaguePayload(created.code, userId);
    res.status(201).json(data);
  } catch (error) {
    console.error('Error creando liga:', error);
    res.status(500).json({ error: 'No se pudo crear la liga.' });
  }
});

app.post('/api/leagues/join', requireAuth, async (req, res) => {
  const code = cleanCode(req.body?.code);
  if (!code) return res.status(400).json({ error: 'Introduce el código de la liga.' });
  try {
    const { rows } = await pool.query('SELECT id FROM leagues WHERE code=$1', [code]);
    if (!rows.length) return res.status(404).json({ error: 'No hay ninguna liga con ese código.' });
    await pool.query('INSERT INTO league_members (league_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [rows[0].id, currentUserId(req)]);
    await pool.query('INSERT INTO league_standings (league_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [rows[0].id, currentUserId(req)]);
    res.json(await leaguePayload(code, currentUserId(req)));
  } catch (error) {
    console.error('Error al unirse a liga:', error);
    res.status(500).json({ error: 'No se pudo entrar en la liga.' });
  }
});

app.get('/api/leagues/:code', requireAuth, async (req, res) => {
  const code = cleanCode(req.params.code);
  try {
    const data = await leaguePayload(code, currentUserId(req));
    if (!data) return res.status(404).json({ error: 'No se ha encontrado esa liga.' });
    if (data.notMember) return res.status(403).json({ error: 'Primero debes unirte a esta liga con su código.' });
    res.json(data);
  } catch (error) {
    console.error('Error cargando liga:', error);
    res.status(500).json({ error: 'No se pudo cargar la liga.' });
  }
});

app.get('/', (_req, res) => res.sendFile(path.join(rootDir, 'index.html')));
app.get('/styles.css', (_req, res) => res.sendFile(path.join(rootDir, 'styles.css')));
app.get('/app.js', (_req, res) => res.sendFile(path.join(rootDir, 'app.js')));
app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));
app.use((error, _req, res, _next) => {
  console.error('Error de servidor:', error);
  res.status(500).json({ error: 'Ha ocurrido un error inesperado.' });
});

const httpServer = http.createServer(app);
const io = new SocketServer(httpServer, {
  cors: { origin: false },
  pingInterval: 25_000,
  pingTimeout: 20_000,
  maxHttpBufferSize: 1e6,
});
io.engine.use(sessionMiddleware);
io.use((socket, next) => {
  const sessionData = socket.request.session;
  if (!sessionData?.userId) return next(new Error('Inicia sesión para jugar online.'));
  socket.data.userId = String(sessionData.userId);
  socket.data.username = sessionData.username;
  next();
});

const rooms = new Map();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const allPlayers = (room) => room.players;
const findPlayer = (room, userId) => room.players.find((player) => player.id === String(userId));
function shuffled(items) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function rotateIds(order, startId) {
  const idx = order.indexOf(startId);
  if (idx < 0) return [...order];
  return [...order.slice(idx), ...order.slice(0, idx)];
}
function publicRoom(room) {
  const playerById = new Map(room.players.map((p) => [p.id, p]));
  return {
    code: room.code,
    mode: room.mode,
    leagueId: room.leagueId,
    leagueName: room.leagueName,
    hostId: room.hostId,
    phase: room.phase,
    settings: room.settings,
    players: room.players.map((p) => ({
      id: p.id, username: p.username, score: p.score,
      correctAnswers: p.correctAnswers, reboundPoints: p.reboundPoints,
    })).sort((a, b) => room.turnOrder.indexOf(a.id) - room.turnOrder.indexOf(b.id)),
    turnOrder: room.turnOrder,
    currentQuestion: room.question ? {
      question: room.question.question,
      topic: room.question.topic || room.topic,
      number: room.tieBreaker ? room.completedQuestions : room.completedQuestions + 1,
      tieBreaker: room.tieBreaker,
      tieBreakRound: room.tieBreakRound,
    } : null,
    currentTurnUserId: room.currentTurnUserId,
    currentTurnUsername: playerById.get(room.currentTurnUserId)?.username || null,
    attemptNumber: room.attemptIndex + 1,
    attemptsInQuestion: room.attemptOrder.length,
    processing: room.processing,
    completedQuestions: room.completedQuestions,
    tieScores: room.tieBreaker ? room.tieScores : null,
    lastResult: room.lastResult,
    winnerId: room.winnerId,
    winnerUsername: playerById.get(room.winnerId)?.username || null,
    aiEnabled: isAiEnabled,
  };
}
function publishRoom(room) {
  io.to(room.code).emit('room-state', publicRoom(room));
}
function ackError(ack, error) {
  if (typeof ack === 'function') ack({ ok: false, error });
}
async function assertLeagueMember(leagueId, userId) {
  const { rows } = await pool.query(`
    SELECT l.id, l.name, l.topic, l.scoring_mode, l.limit_value
    FROM leagues l JOIN league_members lm ON lm.league_id=l.id
    WHERE l.id=$1 AND lm.user_id=$2
  `, [leagueId, userId]);
  return rows[0] || null;
}

async function createRoomForUser(socket, payload) {
  const userId = socket.data.userId;
  const mode = payload?.mode === 'league' ? 'league' : 'quick';
  let settings;
  let leagueId = null;
  let leagueName = null;
  if (mode === 'league') {
    leagueId = String(payload.leagueId || '');
    const league = await assertLeagueMember(leagueId, userId);
    if (!league) throw new Error('Debes pertenecer a esa liga para crear un duelo.');
    leagueName = league.name;
    settings = {
      topic: league.topic,
      scoringMode: league.scoring_mode,
      limitValue: Number(league.limit_value),
    };
  } else {
    const scoringMode = payload?.scoringMode === 'questions' ? 'questions' : 'target';
    settings = {
      topic: typeof payload?.topic === 'string' ? payload.topic.trim().slice(0, 100) || 'Cultura general' : 'Cultura general',
      scoringMode,
      limitValue: scoringMode === 'questions'
        ? clampInt(payload?.limitValue, 3, 100, 15)
        : clampInt(payload?.limitValue, 1, 50, 5),
    };
  }
  const { rows: userRows } = await pool.query('SELECT id, username FROM users WHERE id=$1', [userId]);
  if (!userRows.length) throw new Error('Tu perfil no existe. Cierra sesión y vuelve a entrar.');
  const matchId = crypto.randomUUID();
  let code = makeCode();
  for (let i = 0; i < 5 && rooms.has(code); i += 1) code = makeCode();
  const room = {
    id: matchId, code, mode, leagueId, leagueName, hostId: userId,
    settings, topic: settings.topic, phase: 'lobby',
    players: [{ id: userId, username: userRows[0].username, score: 0, correctAnswers: 0, reboundPoints: 0, sockets: new Set([socket.id]) }],
    turnOrder: [userId], nextStarterIndex: 0, tieNextStarterIndex: 0,
    question: null, questionHistory: [], completedQuestions: 0,
    currentTurnUserId: null, attemptOrder: [], attemptIndex: 0,
    failedQuestionIds: new Set(), processing: false, lastResult: null,
    tieBreaker: false, tieScores: {}, tieBreakRound: 0,
    winnerId: null,
  };
  await pool.query(`INSERT INTO matches (id, mode, topic, scoring_mode, limit_value, league_id, status)
    VALUES ($1,$2,$3,$4,$5,$6,'lobby')`, [matchId, mode, settings.topic, settings.scoringMode, settings.limitValue, leagueId]);
  await pool.query('INSERT INTO match_players (match_id, user_id) VALUES ($1,$2)', [matchId, userId]);
  rooms.set(code, room);
  socket.join(code);
  socket.data.roomCode = code;
  return room;
}

async function addPlayerToRoom(socket, room) {
  const userId = socket.data.userId;
  const existing = findPlayer(room, userId);
  if (existing) {
    existing.sockets.add(socket.id);
    socket.join(room.code);
    socket.data.roomCode = room.code;
    return;
  }
  if (room.phase !== 'lobby') throw new Error('La partida ya ha empezado. Solo pueden reconectarse jugadores que ya estaban dentro.');
  if (room.mode === 'league') {
    if (room.players.length >= 2) throw new Error('Los duelos de liga son exclusivamente 1 contra 1.');
    const member = await assertLeagueMember(room.leagueId, userId);
    if (!member) throw new Error('Debes unirte a la liga antes de entrar en un duelo.');
  }
  const { rows } = await pool.query('SELECT id, username FROM users WHERE id=$1', [userId]);
  if (!rows.length) throw new Error('No se encuentra tu perfil.');
  await pool.query('INSERT INTO match_players (match_id,user_id) VALUES ($1,$2)', [room.id, userId]);
  room.players.push({ id: userId, username: rows[0].username, score: 0, correctAnswers: 0, reboundPoints: 0, sockets: new Set([socket.id]) });
  if (!room.turnOrder.includes(userId)) room.turnOrder.push(userId);
  socket.join(room.code);
  socket.data.roomCode = room.code;
}

async function addOnePoint(room, player, isRebound) {
  if (room.tieBreaker) {
    room.tieScores[player.id] = (room.tieScores[player.id] || 0) + 1;
  } else {
    player.score += 1;
    player.correctAnswers += 1;
    if (isRebound) player.reboundPoints += 1;
    await pool.query('UPDATE match_players SET score=$3, correct_answers=$4, rebound_points=$5 WHERE match_id=$1 AND user_id=$2',
      [room.id, player.id, player.score, player.correctAnswers, player.reboundPoints]);
  }
}

function highestScorers(room) {
  const max = Math.max(...room.players.map((player) => player.score));
  return room.players.filter((player) => player.score === max);
}
function hasTieBreakWinner(room) {
  const values = Object.entries(room.tieScores);
  if (values.length <= 1) return values[0]?.[0] || null;
  const max = Math.max(...values.map(([, score]) => score));
  const leaders = values.filter(([, score]) => score === max);
  if (leaders.length !== 1) return null;
  const second = Math.max(...values.filter(([id]) => id !== leaders[0][0]).map(([, score]) => score));
  return max - second >= 2 ? leaders[0][0] : null;
}

async function finishMatch(room, winnerId) {
  if (room.phase === 'finished') return;
  room.phase = 'finished';
  room.processing = false;
  room.winnerId = winnerId || null;
  room.currentTurnUserId = null;
  room.lastResult = {
    type: 'finished',
    winnerId: room.winnerId,
    winnerUsername: room.players.find((p) => p.id === room.winnerId)?.username || null,
    tieBreaker: room.tieBreaker,
  };
  try {
    await pool.query(`UPDATE matches SET status='finished', winner_id=$2, finished_at=NOW() WHERE id=$1`, [room.id, room.winnerId]);
    for (const player of room.players) {
      await pool.query('UPDATE match_players SET score=$3, correct_answers=$4, rebound_points=$5 WHERE match_id=$1 AND user_id=$2',
        [room.id, player.id, player.score, player.correctAnswers, player.reboundPoints]);
    }
    if (room.mode === 'league' && room.leagueId && room.winnerId) {
      for (const player of room.players) {
        const won = player.id === room.winnerId;
        await pool.query(`
          INSERT INTO league_standings (league_id,user_id,played,wins,losses,points)
          VALUES ($1,$2,1,$3,$4,$5)
          ON CONFLICT (league_id,user_id) DO UPDATE SET
            played=league_standings.played+1,
            wins=league_standings.wins+EXCLUDED.wins,
            losses=league_standings.losses+EXCLUDED.losses,
            points=league_standings.points+EXCLUDED.points
        `, [room.leagueId, player.id, won ? 1 : 0, won ? 0 : 1, won ? 3 : 0]);
      }
    }
  } catch (error) {
    console.error('Error guardando el resultado de la partida:', error);
  }
  publishRoom(room);
}

async function startRound(room, isTieBreaker = false) {
  if (room.phase === 'finished') return;
  room.processing = false;
  room.lastResult = null;
  room.question = null;
  room.phase = 'loading-question';
  room.tieBreaker = isTieBreaker;
  if (isTieBreaker) {
    room.tieBreakRound += 1;
    const eligible = room.turnOrder.filter((id) => Object.hasOwn(room.tieScores, id));
    if (!eligible.length) return finishMatch(room, null);
    const idx = room.tieNextStarterIndex % eligible.length;
    const starterId = eligible[idx];
    room.tieNextStarterIndex = (idx + 1) % eligible.length;
    room.attemptOrder = rotateIds(eligible, starterId);
  } else {
    if (room.completedQuestions === 0 && room.turnOrder.length !== room.players.length) {
      room.turnOrder = room.players.map((p) => p.id);
    }
    const starterIdx = room.nextStarterIndex % room.turnOrder.length;
    const starterId = room.turnOrder[starterIdx];
    room.nextStarterIndex = (starterIdx + 1) % room.turnOrder.length;
    room.attemptOrder = rotateIds(room.turnOrder, starterId);
  }
  room.attemptIndex = 0;
  room.failedQuestionIds = new Set();
  room.currentTurnUserId = room.attemptOrder[0];
  publishRoom(room);
  try {
    const q = await generateQuestion(room.topic, room.questionHistory);
    room.question = q;
    room.questionHistory.push(q.question);
    if (room.questionHistory.length > 25) room.questionHistory.shift();
    room.phase = isTieBreaker ? 'tiebreak' : 'playing';
    room.currentTurnUserId = room.attemptOrder[0];
    publishRoom(room);
  } catch (error) {
    console.error('No se pudo preparar una pregunta:', error);
    room.phase = 'playing';
    room.question = { question: 'No se pudo generar la pregunta. Intenta responder con una idea válida.', answer: '', acceptedAnswers: [], explanation: '', topic: room.topic };
    publishRoom(room);
  }
}

async function finishQuestionRound(room, scorerId = null) {
  if (room.tieBreaker) {
    const tieWinner = hasTieBreakWinner(room);
    if (tieWinner) return finishMatch(room, tieWinner);
    await sleep(1100);
    return startRound(room, true);
  }
  room.completedQuestions += 1;
  if (room.settings.scoringMode === 'target' && scorerId) {
    const scorer = findPlayer(room, scorerId);
    if (scorer && scorer.score >= room.settings.limitValue) return finishMatch(room, scorer.id);
  }
  if (room.settings.scoringMode === 'questions' && room.completedQuestions >= room.settings.limitValue) {
    const top = highestScorers(room);
    if (top.length === 1) return finishMatch(room, top[0].id);
    room.tieBreaker = true;
    room.tieScores = Object.fromEntries(top.map((p) => [p.id, 0]));
    room.tieBreakRound = 0;
    room.tieNextStarterIndex = 0;
    await sleep(1200);
    return startRound(room, true);
  }
  await sleep(1200);
  return startRound(room, false);
}

io.on('connection', (socket) => {
  socket.on('create-room', (payload, ack) => {
    (async () => {
      try {
        const room = await createRoomForUser(socket, payload || {});
        if (typeof ack === 'function') ack({ ok: true, code: room.code });
        publishRoom(room);
      } catch (error) {
        ackError(ack, error.message || 'No se pudo crear la sala.');
      }
    })();
  });

  socket.on('join-room', (payload, ack) => {
    (async () => {
      try {
        const code = cleanCode(payload?.code);
        const room = rooms.get(code);
        if (!room) throw new Error('No hay una partida activa con ese código. Comprueba que el anfitrión la haya creado y no haya reiniciado el servidor.');
        await addPlayerToRoom(socket, room);
        if (typeof ack === 'function') ack({ ok: true, code: room.code });
        publishRoom(room);
      } catch (error) {
        ackError(ack, error.message || 'No se pudo entrar en la partida.');
      }
    })();
  });

  socket.on('rejoin-room', (payload, ack) => {
    const code = cleanCode(payload?.code);
    const room = rooms.get(code);
    if (!room || !findPlayer(room, socket.data.userId)) return ackError(ack, 'Esa partida ya no está disponible en este servidor.');
    const player = findPlayer(room, socket.data.userId);
    player.sockets.add(socket.id);
    socket.join(room.code);
    socket.data.roomCode = room.code;
    if (typeof ack === 'function') ack({ ok: true, code: room.code });
    publishRoom(room);
  });

  socket.on('start-room', (_payload, ack) => {
    (async () => {
      try {
        const room = rooms.get(socket.data.roomCode);
        if (!room) throw new Error('No se encuentra la sala.');
        if (room.hostId !== socket.data.userId) throw new Error('Solo el anfitrión puede empezar la partida.');
        if (room.phase !== 'lobby') throw new Error('La partida ya ha comenzado.');
        if (room.players.length < 2) throw new Error('Necesitáis al menos 2 jugadores.');
        if (room.mode === 'league' && room.players.length !== 2) throw new Error('Una partida de liga debe tener exactamente 2 jugadores.');
        room.turnOrder = shuffled(room.players.map((player) => player.id));
        room.nextStarterIndex = 0;
        room.completedQuestions = 0;
        room.tieBreaker = false;
        room.tieScores = {};
        room.phase = 'playing';
        await pool.query("UPDATE matches SET status='active', started_at=NOW() WHERE id=$1", [room.id]);
        if (typeof ack === 'function') ack({ ok: true });
        await startRound(room, false);
      } catch (error) { ackError(ack, error.message || 'No se pudo iniciar la partida.'); }
    })();
  });

  socket.on('submit-answer', (payload, ack) => {
    (async () => {
      const room = rooms.get(socket.data.roomCode);
      if (!room) return ackError(ack, 'La sala ya no está disponible.');
      if (!['playing', 'tiebreak'].includes(room.phase) || room.phase === 'loading-question') return ackError(ack, 'Ahora mismo no se puede responder.');
      if (room.processing) return ackError(ack, 'Estamos valorando una respuesta. Espera un momento.');
      if (room.currentTurnUserId !== socket.data.userId) return ackError(ack, 'Todavía no es tu turno.');
      const answer = typeof payload?.answer === 'string' ? payload.answer.trim().slice(0, 500) : '';
      if (!answer) return ackError(ack, 'Escribe una respuesta antes de enviarla.');
      if (!room.question) return ackError(ack, 'Todavía no hay una pregunta disponible.');
      room.processing = true;
      publishRoom(room);
      if (typeof ack === 'function') ack({ ok: true });
      const player = findPlayer(room, socket.data.userId);
      try {
        const judged = await gradeAnswer(room.question, answer);
        room.processing = false;
        if (judged.correct) {
          const wasRebound = room.attemptIndex > 0;
          await addOnePoint(room, player, wasRebound);
          room.lastResult = {
            type: 'answer', correct: true, username: player.username,
            submittedAnswer: answer, feedback: judged.feedback,
            wasRebound, awardedPoints: 1,
            answer: room.question.answer,
            explanation: room.question.explanation || '',
            questionResolved: true,
            tieBreaker: room.tieBreaker,
          };
          publishRoom(room);
          return finishQuestionRound(room, player.id);
        }

        room.failedQuestionIds.add(player.id);
        const nextAttemptIndex = room.attemptIndex + 1;
        if (nextAttemptIndex < room.attemptOrder.length) {
          room.lastResult = {
            type: 'answer', correct: false, username: player.username,
            submittedAnswer: answer, feedback: 'No es correcta. ¡Hay rebote!',
            wasRebound: room.attemptIndex > 0,
            questionResolved: false,
            nextUsername: findPlayer(room, room.attemptOrder[nextAttemptIndex])?.username || null,
          };
          room.attemptIndex = nextAttemptIndex;
          room.currentTurnUserId = room.attemptOrder[room.attemptIndex];
          publishRoom(room);
          return;
        }
        room.lastResult = {
          type: 'answer', correct: false, username: player.username,
          submittedAnswer: answer, feedback: 'Nadie ha acertado esta pregunta.',
          wasRebound: room.attemptIndex > 0,
          questionResolved: true,
          allFailed: true,
          answer: room.question.answer,
          explanation: room.question.explanation || '',
          tieBreaker: room.tieBreaker,
        };
        publishRoom(room);
        return finishQuestionRound(room, null);
      } catch (error) {
        room.processing = false;
        console.error('Error procesando respuesta:', error);
        room.lastResult = { type: 'answer', correct: false, username: player?.username, feedback: 'No se pudo valorar la respuesta. Prueba otra vez.', questionResolved: false };
        publishRoom(room);
      }
    })();
  });

  socket.on('leave-room', (_payload, ack) => {
    (async () => {
      const room = rooms.get(socket.data.roomCode);
      if (!room) return ackError(ack, 'No estás en una sala activa.');
      if (room.phase !== 'lobby' && room.phase !== 'finished') return ackError(ack, 'No puedes abandonar una partida en curso desde aquí. Puedes cerrar la pestaña y volver a conectarte con el mismo perfil.');
      const player = findPlayer(room, socket.data.userId);
      if (room.phase === 'finished') {
        socket.leave(room.code);
        socket.data.roomCode = null;
        if (typeof ack === 'function') ack({ ok: true });
        return;
      }
      if (player) {
        room.players = room.players.filter((p) => p.id !== player.id);
        room.turnOrder = room.turnOrder.filter((id) => id !== player.id);
        await pool.query('DELETE FROM match_players WHERE match_id=$1 AND user_id=$2', [room.id, player.id]).catch(() => {});
      }
      if (room.phase === 'lobby' && room.hostId === socket.data.userId) {
        room.phase = 'closed';
        rooms.delete(room.code);
        await pool.query("UPDATE matches SET status='abandoned' WHERE id=$1", [room.id]).catch(() => {});
        io.to(room.code).emit('room-closed', { message: 'El anfitrión ha cerrado la sala.' });
      } else if (room.phase === 'lobby') {
        publishRoom(room);
      }
      socket.leave(room.code);
      socket.data.roomCode = null;
      if (typeof ack === 'function') ack({ ok: true });
    })();
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    const player = findPlayer(room, socket.data.userId);
    if (player) player.sockets.delete(socket.id);
    // Conservamos al jugador para que pueda reconectarse y no alterar la puntuación/orden.
  });
});

async function boot() {
  await initDatabase();
  httpServer.listen(PORT, () => {
    console.log(`Trivia Arena escuchando en el puerto ${PORT}`);
    console.log(`Árbitro IA: ${isAiEnabled ? 'activo' : 'desactivado (banco local)'}`);
  });
}

boot().catch((error) => {
  console.error('No se pudo iniciar Trivia Arena:', error);
  process.exit(1);
});
