const app = document.getElementById('app');
const topStatus = document.getElementById('top-status');
const toastEl = document.getElementById('toast');

const state = {
  view: 'loading', authMode: 'login', authError: '',
  me: null, profile: null, config: { aiEnabled: false },
  myLeagues: [], activeLeague: null,
  room: null, roomCode: localStorage.getItem('trivia-room-code') || '',
  answerDraft: '', lastQuestionText: '', finishedFor: null,
  roomPending: false,
};
let socket = null;
let toastTimer = null;

function esc(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
function userAvatarMarkup(user, className = 'user-avatar') {
  const username = String(user?.username || '?');
  if (user?.avatarData) return `<img class="${className}" src="${esc(user.avatarData)}" alt="Foto de perfil de ${esc(username)}">`;
  return `<span class="${className} avatar-fallback" aria-label="Avatar de ${esc(username)}">${esc(username.slice(0, 1).toUpperCase())}</span>`;
}
function number(value) { return Number(value || 0).toLocaleString('es-ES'); }
function fmtDate(value) {
  if (!value) return 'Fecha no disponible';
  try { return new Date(value).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return 'Fecha no disponible'; }
}
function topicEmoji(topic) {
  const value = String(topic || '').toLowerCase();
  if (value.includes('cien')) return '⚛';
  if (value.includes('mate')) return '∑';
  if (value.includes('hist')) return '⌛';
  if (value.includes('geograf')) return '🌍';
  if (value.includes('astronom')) return '🪐';
  if (value.includes('tecnolog') || value.includes('inform')) return '💻';
  if (value.includes('naturaleza') || value.includes('animal')) return '🐾';
  if (value.includes('arte') || value.includes('literatura')) return '🎨';
  if (value.includes('cine') || value.includes('serie')) return '🎬';
  if (value.includes('música') || value.includes('musica')) return '🎵';
  if (value.includes('deporte')) return '🏆';
  if (value.includes('lengua')) return '🔤';
  if (value.includes('mitolog')) return '⚡';
  if (value.includes('videojuego')) return '🎮';
  if (value.includes('gastronom')) return '🍲';
  if (value.includes('filosof')) return '💭';
  if (value.includes('aleat') || value.includes('cualquier')) return '✳';
  if (value.includes('cultura')) return '✦';
  return '◎';
}
function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3200);
}
async function api(url, options = {}) {
  const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
  const response = await fetch(url, { credentials: 'same-origin', ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Error ${response.status}`);
  return data;
}
function authHeader() {
  topStatus.innerHTML = state.me
    ? `${userAvatarMarkup(state.me, 'top-user-avatar')}<span>${esc(state.me.username)}</span>${state.view === 'dashboard' ? '<button class="btn btn-ghost btn-small" data-action="profile">Mi perfil</button>' : ''}<button class="btn btn-ghost btn-small" data-action="logout">Salir</button>`
    : `<span>Preguntas · Rebote · Competición</span>`;
}
function aiNotice(extra = '') {
  if (state.config.aiEnabled) return `<div class="notice success"><strong>Árbitro IA habilitado.</strong> Las preguntas se generan sobre la marcha y las respuestas se valoran por significado. ${extra}</div>`;
  return `<div class="notice warning"><strong>Modo de prueba sin IA.</strong> Se usará un banco de preguntas precargadas y una comparación local de respuestas. Los temas libres necesitan una clave de API para funcionar bien. ${extra}</div>`;
}
function authTemplate() {
  const isRegister = state.authMode === 'register';
  return `
    <div class="auth-wrap">
      <section class="auth-story">
        <div class="eyebrow">Una arena de conocimiento</div>
        <h1>Tu cabeza.<br><span style="color:var(--lime)">La pregunta.</span><br>Que empiece el juego.</h1>
        <p>Partidas online con amigos, respuestas escritas sin opciones y un sistema de rebote en el que fallar no siempre significa perder el punto. Crea tu perfil y deja que las estadísticas cuenten la historia.</p>
        <div class="hero-art"><div class="hero-orbit"><div class="hero-cube">T<span style="font-size:22px">+</span></div><span class="orbit-dot"></span><span class="orbit-dot two"></span></div></div>
        <div class="space-between" style="max-width:440px;gap:20px;margin-top:23px">
          <div><div class="callout-number">01 / RETA</div><div class="small muted" style="margin-top:6px">Juega por puntos o por preguntas.</div></div>
          <div><div class="callout-number">02 / REBOTA</div><div class="small muted" style="margin-top:6px">La pregunta sigue viva si fallas.</div></div>
        </div>
      </section>
      <section class="auth-card">
        <div class="eyebrow">Tu siguiente partida empieza aquí</div>
        <h2>${isRegister ? 'Crea tu perfil' : 'Vuelve a la arena'}</h2>
        <p class="muted small">${isRegister ? 'Tu usuario guardará tus resultados, puntos y partidas.' : 'Entra con el mismo usuario para recuperar tus estadísticas.'}</p>
        <div class="tab-row"><button class="tab-button ${!isRegister ? 'active' : ''}" data-action="auth-login">Iniciar sesión</button><button class="tab-button ${isRegister ? 'active' : ''}" data-action="auth-register">Crear cuenta</button></div>
        <form id="auth-form">
          <div class="field-block"><label class="field-label" for="username">Nombre de usuario</label><input class="field" id="username" name="username" autocomplete="username" minlength="3" maxlength="20" placeholder="Ej. Morta_01" required></div>
          <div class="field-block"><label class="field-label" for="password">Contraseña</label><input class="field" id="password" name="password" type="password" autocomplete="${isRegister ? 'new-password' : 'current-password'}" minlength="8" maxlength="128" placeholder="Mínimo 8 caracteres" required></div>
          ${isRegister ? '<p class="muted small">Puedes usar letras, números, guion y guion bajo en el nombre de usuario.</p>' : ''}
          <div class="form-error ${state.authError ? 'visible' : ''}" id="auth-error">${esc(state.authError)}</div>
          <button class="btn btn-primary btn-block" type="submit">${isRegister ? 'Crear mi perfil' : 'Entrar en Trivia Arena'} <span>↗</span></button>
        </form>
        <p class="muted small" style="margin:15px 0 0">Tus estadísticas se guardan en la base de datos de la aplicación. No reutilices una contraseña importante.</p>
      </section>
    </div>`;
}
function statCard(label, value, sub) {
  return `<div class="stat-card"><div class="stat-label">${esc(label)}</div><div class="stat-value">${esc(value)}</div><div class="stat-sub">${esc(sub)}</div></div>`;
}
function historyTemplate() {
  const items = state.profile?.history || [];
  if (!items.length) return `<div class="empty-state">Todavía no hay partidas terminadas.<br>La primera ya puede ser la tuya.</div>`;
  return `<div class="history-list">${items.map((item) => `
    <div class="history-item">
      <div><div class="history-title">${esc(item.mode === 'league' ? 'Duelo de liga' : 'Partida rápida')} · ${esc(item.topic)}</div><div class="history-sub">${fmtDate(item.finished_at)} · ${item.scoring_mode === 'questions' ? `${item.limit_value} preguntas` : `${item.limit_value} puntos para ganar`}</div></div>
      <div style="text-align:right"><span class="result-pill ${item.result === 'win' ? 'win' : 'loss'}">${item.result === 'win' ? 'VICTORIA' : 'DERROTA'}</span><div class="history-sub" style="margin-top:6px">${number(item.score)} pts</div></div>
    </div>`).join('')}</div>`;
}
function dashboardTemplate() {
  const profile = state.profile || { stats: {}, history: [] };
  const stats = profile.stats || {};
  const winRate = Number(stats.played) ? Math.round(Number(stats.wins) * 100 / Number(stats.played)) : 0;
  const leagueItems = state.myLeagues.slice(0, 3);
  return `
    <div class="dashboard-hello">
      <div><div class="eyebrow">Panel de jugador</div><h1>Qué pasa, ${esc(state.me?.username || 'jugador')}<span style="color:var(--lime)">.</span></h1><p>Hoy puede cambiar tu clasificación. ¿Una partida rápida?</p></div>
      <div class="dashboard-actions"><button class="btn btn-ghost" data-action="profile">Mi perfil ↗</button><button class="btn btn-secondary" data-action="quick">＋ Crear partida</button></div>
    </div>
    <div class="stat-grid">
      ${statCard('PARTIDAS JUGADAS', number(stats.played), 'Historial completo')}
      ${statCard('VICTORIAS', number(stats.wins), `${winRate}% de victorias`)}
      ${statCard('RESPUESTAS CORRECTAS', number(stats.correct_answers), 'Aciertos registrados')}
      ${statCard('PUNTOS POR REBOTE', number(stats.rebound_points), 'Robados tras un fallo')}
    </div>
    <div class="section-head"><div><div class="eyebrow">Elige tu formato</div><h2>¿Cómo jugamos?</h2><p>Compite una vez o vuelve a por la clasificación de una liga.</p></div></div>
    <div class="mode-grid">
      <article class="mode-card"><div class="mode-icon">↗</div><div class="eyebrow">01 / Partida rápida</div><h2>Una partida. A todo o nada.</h2><p>Crea una sala con código, invita a cuantos amigos quieras, elige tema y formato. El orden se sortea al empezar y el rebote puede cambiarlo todo.</p><button class="btn btn-primary" data-action="quick">Crear o buscar partida <span>→</span></button></article>
      <article class="mode-card league"><div class="mode-icon">♜</div><div class="eyebrow">02 / Modo liga</div><h2>La rivalidad continúa.</h2><p>Crea una liga privada o entra con un código. Los duelos son 1 contra 1 y cada victoria suma 3 puntos a la clasificación compartida.</p><button class="btn btn-secondary" data-action="leagues">Entrar en las ligas <span>→</span></button></article>
    </div>
    <div class="lower-grid">
      <section class="panel"><div class="panel-head"><div><div class="eyebrow">Tu recorrido</div><h3>Últimas partidas</h3></div><span class="tag">${itemsCount(profile.history)} recientes</span></div>${historyTemplate()}</section>
      <section class="panel"><div class="panel-head"><div><div class="eyebrow">Competición persistente</div><h3>Tus ligas</h3></div><button class="btn btn-ghost btn-small" data-action="leagues">Ver todas ↗</button></div>
        ${leagueItems.length ? `<div class="league-list">${leagueItems.map((league) => `<div class="league-row"><div><div class="league-name">${esc(league.name)}</div><div class="league-meta">Código ${esc(league.code)} · ${number(league.member_count)} jugadores</div></div><div class="league-score"><strong>${number(league.points)}</strong><span>puntos</span><button class="btn btn-ghost btn-small" style="margin-top:7px" data-action="open-league" data-code="${esc(league.code)}">Ver ↗</button></div></div>`).join('')}</div>` : `<div class="empty-state">Todavía no estás en ninguna liga.<br>Crea una para empezar una clasificación con tus amigos.</div><button class="btn btn-secondary btn-block" data-action="leagues" style="margin-top:12px">Crear o unirme a una liga</button>`}
      </section>
    </div>
    <p class="footer-note">TRIVIA ARENA · El conocimiento compite · Las respuestas se valoran por su significado cuando la IA está activada.</p>`;
}
function accountTemplate() {
  const user = state.me || {};
  return `
    <button class="back-link" data-action="dashboard-back">← Volver al menú principal</button>
    <div class="section-head"><div><div class="eyebrow">Tu cuenta</div><h1>Mi perfil<span style="color:var(--lime)">.</span></h1><p>Personaliza cómo apareces en Trivia Arena y gestiona la seguridad de tu cuenta.</p></div></div>
    <div class="account-layout">
      <section class="panel account-panel">
        <div class="account-summary">
          <div class="account-avatar-wrap" id="profile-avatar-preview">${userAvatarMarkup(user, 'account-avatar')}</div>
          <div><div class="eyebrow">Perfil de jugador</div><h2>${esc(user.username || 'Jugador')}</h2><p class="muted small">Miembro desde ${fmtDate(user.createdAt)}</p></div>
        </div>
        <form id="profile-form">
          <div class="field-block"><label class="field-label" for="profile-username">Nombre de usuario</label><input class="field" id="profile-username" name="username" value="${esc(user.username || '')}" minlength="3" maxlength="20" autocomplete="username" required><p class="muted small" style="margin:7px 0 0">Entre 3 y 20 caracteres: letras, números, guion o guion bajo. Debe ser único.</p></div>
          <div class="field-block"><label class="field-label" for="avatar-file">Foto de perfil</label><input class="field" style="padding:10px" id="avatar-file" name="avatarFile" type="file" accept="image/jpeg,image/png,image/webp"><p class="muted small" style="margin:7px 0 0">Puedes elegir una imagen JPG, PNG o WebP. Se recortará/ajustará automáticamente a un avatar pequeño.</p></div>
          <div class="form-error" id="profile-error"></div>
          <div class="account-actions"><button class="btn btn-primary" type="submit">Guardar perfil</button>${user.avatarData ? '<button class="btn btn-ghost" type="button" data-action="remove-avatar">Quitar foto</button>' : ''}</div>
        </form>
      </section>
      <section class="panel account-panel">
        <div class="eyebrow">Seguridad</div><h2>Cambiar contraseña</h2><p class="muted small">No es posible consultar tu contraseña actual. Por seguridad, se guarda como un hash no reversible; puedes reemplazarla verificando la actual.</p>
        <form id="password-form">
          <div class="field-block"><label class="field-label" for="current-password">Contraseña actual</label><input class="field" id="current-password" name="currentPassword" type="password" autocomplete="current-password" minlength="8" maxlength="128" required></div>
          <div class="field-block"><label class="field-label" for="new-password">Nueva contraseña</label><input class="field" id="new-password" name="newPassword" type="password" autocomplete="new-password" minlength="8" maxlength="128" required><p class="muted small" style="margin:7px 0 0">Utiliza al menos 8 caracteres.</p></div>
          <div class="field-block"><label class="field-label" for="confirm-password">Repite la nueva contraseña</label><input class="field" id="confirm-password" name="confirmPassword" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></div>
          <div class="form-error" id="password-error"></div>
          <button class="btn btn-secondary btn-block" type="submit">Actualizar contraseña</button>
        </form>
      </section>
    </div>
    <section class="panel account-logout-panel"><div><h3>¿Quieres entrar con otra cuenta?</h3><p class="muted small" style="margin-bottom:0">Cierra esta sesión para volver a la pantalla de inicio y acceder con otro usuario.</p></div><button class="btn btn-ghost" data-action="logout">Cerrar sesión</button></section>`;
}

function itemsCount(items) { return (items || []).length; }
function topicOptions(selected = 'Cultura general') {
  const options = [
    ['Cultura general', '✦'], ['Ciencia', '⚛'], ['Matemáticas', '∑'], ['Historia', '⌛'],
    ['Geografía', '🌍'], ['Astronomía', '🪐'], ['Tecnología e informática', '💻'],
    ['Naturaleza y animales', '🐾'], ['Arte y literatura', '🎨'], ['Cine y series', '🎬'],
    ['Música', '🎵'], ['Deportes', '🏆'], ['Lengua', '🔤'], ['Mitología', '⚡'],
    ['Videojuegos', '🎮'], ['Gastronomía', '🍲'], ['Filosofía', '💭'],
    ['Aleatorio', '✳'], ['Cualquier tema', '◎'], ['Tema personalizado', '✎'],
  ];
  return options.map(([value, emoji]) => `<label class="topic-option"><input type="radio" name="topicChoice" value="${esc(value)}" ${value === selected ? 'checked' : ''}><span><i>${emoji}</i>${esc(value)}</span></label>`).join('');
}
function quickTemplate() {
  return `
    <button class="back-link" data-action="home">← Volver al panel</button>
    <div class="section-head"><div><div class="eyebrow">Partida rápida / Configuración</div><h1>La mesa está abierta<span style="color:var(--lime)">.</span></h1><p>Configura las reglas o únete a una sala con su código.</p></div></div>
    <div class="form-layout">
      <section class="panel">
        <div class="panel-head"><div><div class="eyebrow">Crear una sala</div><h2>Configura la partida</h2></div><span class="tag lime">Online</span></div>
        <form id="quick-form">
          <div class="field-block"><label class="field-label">Temática de preguntas</label><div class="topic-grid">${topicOptions()}</div></div>
          <div id="custom-topic-wrap" class="field-block hidden"><label class="field-label" for="custom-topic">¿Sobre qué tema?</label><input class="field" id="custom-topic" name="customTopic" maxlength="100" placeholder="Ej. astronomía, fútbol, cine clásico…"></div>
          <div class="subsection"><label class="field-label">Condición de victoria</label>
            <div class="choice-row">
              <label class="choice-card"><input type="radio" name="scoringMode" value="target" checked><span><b class="choice-title">Llegar a puntos</b><small class="choice-desc">Gana quien alcance primero la puntuación elegida.</small></span></label>
              <label class="choice-card"><input type="radio" name="scoringMode" value="questions"><span><b class="choice-title">Número de preguntas</b><small class="choice-desc">Gana quien tenga más puntos al terminar el total.</small></span></label>
            </div>
            <div class="field-block"><label class="field-label" for="limit-value" id="limit-label">Puntos necesarios para ganar</label><input class="field" type="number" id="limit-value" name="limitValue" min="1" max="50" value="5" required></div>
          </div>
          <div class="notice" style="margin:17px 0">El orden se sortea al iniciar y se mantiene. Si alguien falla, la misma pregunta rebota por el resto de jugadores.</div>
          <div class="form-error" id="quick-error"></div>
          <button class="btn btn-primary btn-block" type="submit">Crear partida y recibir código ↗</button>
        </form>
      </section>
      <aside class="panel-stack">
        <section class="panel"><div class="eyebrow">¿Ya hay sala?</div><h2>Únete a tus amigos</h2><p class="muted small">Pide el código de la partida y entra con tu perfil. Todos los jugadores deben tener una cuenta.</p>
          <form id="join-quick-form"><div class="field-block"><label class="field-label" for="quick-code">Código de partida</label><input class="field code-input" id="quick-code" name="code" minlength="4" maxlength="8" placeholder="ABC123" required></div><div class="form-error" id="join-error"></div><button class="btn btn-secondary btn-block" type="submit">Buscar partida →</button></form>
        </section>
        ${aiNotice('Con la IA activa puedes indicar cualquier tema. Sin ella, usa preferentemente las categorías incluidas en el banco local.')}
      </aside>
    </div>`;
}
function leagueTemplate() {
  return `
    <button class="back-link" data-action="home">← Volver al panel</button>
    <div class="section-head"><div><div class="eyebrow">Modo liga / Comunidad privada</div><h1>Que hable la clasificación<span style="color:var(--lime)">.</span></h1><p>Crea una liga para tus amigos o entra en una que ya exista.</p></div></div>
    <div class="two-panels" style="margin-bottom:20px">
      <section class="panel"><div class="eyebrow">Nueva competición</div><h2>Crea una liga</h2><p class="muted small">La liga tendrá un código propio, una tabla persistente y duelos 1 contra 1. Cada victoria suma 3 puntos.</p>
        <form id="create-league-form">
          <div class="field-block"><label class="field-label" for="league-name">Nombre de la liga</label><input class="field" id="league-name" name="name" maxlength="50" minlength="3" placeholder="Ej. La Liga del Viernes" required></div>
          <div class="notice" style="margin:16px 0">La liga guarda la clasificación y el historial. Elegirás la temática y las reglas cada vez que crees un nuevo duelo, así podréis variar de partida en partida.</div>
          <div class="form-error" id="create-league-error"></div><button class="btn btn-primary btn-block" type="submit">Crear liga ↗</button>
        </form>
      </section>
      <section class="panel"><div class="eyebrow">Una liga ya creada</div><h2>Únete con un código</h2><p class="muted small">El código lo comparte quien creó la liga. Al entrar, tu perfil queda vinculado a esa clasificación.</p>
        <form id="join-league-form"><div class="field-block"><label class="field-label" for="league-code">Código de liga</label><input class="field code-input" id="league-code" name="code" maxlength="8" placeholder="ABC123" required></div><div class="form-error" id="join-league-error"></div><button class="btn btn-secondary btn-block" type="submit">Unirme a la liga →</button></form>
        <div class="separator"></div><div class="panel-head"><h3>Mis ligas</h3><span class="tag">${state.myLeagues.length}</span></div>
        ${state.myLeagues.length ? `<div class="league-list">${state.myLeagues.map((league) => `<div class="league-row"><div><div class="league-name">${esc(league.name)}</div><div class="league-meta">${number(league.member_count)} jugadores · código ${esc(league.code)}</div></div><button class="btn btn-ghost btn-small" data-action="open-league" data-code="${esc(league.code)}">Abrir ↗</button></div>`).join('')}</div>` : '<div class="empty-state">Las ligas a las que te unas aparecerán aquí.</div>'}
      </section>
    </div>
    ${aiNotice('Las ligas son persistentes; los datos se guardan en PostgreSQL.')}`;
}
function loadingRoomTemplate(title = 'Preparando tu sala…') {
  return `<div class="loading-shell"><div class="loader"></div><p>${esc(title)}</p></div>`;
}
function roomPlayersList(room) {
  if (!room.players.length) return '<div class="empty-state">Aún no hay jugadores en la sala.</div>';
  const isHost = state.me?.id === room.hostId;
  return `<div class="player-list">${room.players.map((player, index) => `<div class="player-row"><div class="player-left">${userAvatarMarkup(player, 'player-avatar')}<div><div class="player-name">${esc(player.username)} ${player.id === room.hostId ? '<span class="tag lime" style="margin-left:5px">Host</span>' : ''}</div><div class="player-meta">${player.id === state.me?.id ? 'Tu perfil' : `Jugador ${index + 1}`}</div></div></div><div style="display:flex;align-items:center;gap:10px"><span class="status-dot" title="Conectado a la sala"></span>${isHost && player.id !== state.me?.id ? `<button class="btn btn-ghost btn-small" data-action="kick-room-player" data-user-id="${esc(player.id)}" data-username="${esc(player.username)}">Expulsar</button>` : ''}</div></div>`).join('')}</div>`;
}
function settingsTemplate(room) {
  const settingTopic = room.settings.topic === 'Cualquier tema' ? 'Cualquier tema (cambia en cada pregunta)' : room.settings.topic;
  return `<div class="setting-line"><span>Modalidad</span><strong>${room.mode === 'league' ? 'Duelo de liga 1 vs 1' : 'Partida rápida'}</strong></div>
    <div class="setting-line"><span>Temática</span><strong>${esc(settingTopic)}</strong></div>
    <div class="setting-line"><span>Condición</span><strong>${room.settings.scoringMode === 'questions' ? `${room.settings.limitValue} preguntas` : `${room.settings.limitValue} puntos`}</strong></div>
    <div class="setting-line"><span>Rebote</span><strong>Activado</strong></div>
    ${room.mode === 'league' ? `<div class="setting-line"><span>Liga</span><strong>${esc(room.leagueName || '')}</strong></div>` : ''}`;
}
function lobbyTemplate() {
  const room = state.room;
  if (!room) return loadingRoomTemplate('Creando sala…');
  const isHost = state.me?.id === room.hostId;
  const canStart = room.players.length >= 2 && (room.mode !== 'league' || room.players.length === 2);
  return `
    <button class="back-link" data-action="leave-room">← Salir al menú</button>
    <div class="room-top"><div><div class="eyebrow">Sala de espera / ${room.mode === 'league' ? 'Duelo de liga' : 'Partida rápida'}</div><h1>${room.mode === 'league' ? esc(room.leagueName || 'Duelo privado') : 'Reúne a tu equipo'}<span style="color:var(--lime)">.</span></h1><p class="muted small" style="margin:8px 0 0">${isHost ? 'Comparte el código y empieza cuando todos estén dentro.' : 'Has entrado. Espera a que el anfitrión inicie la partida.'}</p></div><div class="room-code">${esc(room.code)}</div></div>
    <div class="lobby-grid">
      <section class="panel"><div class="panel-head"><div><div class="eyebrow">Participantes</div><h2>Jugadores conectados</h2></div><span class="tag lime">${room.players.length} ${room.players.length === 1 ? 'jugador' : 'jugadores'}</span></div>${roomPlayersList(room)}
        <div class="separator"></div><div class="space-between"><div class="small muted">${room.mode === 'league' ? 'Un duelo de liga necesita 2 jugadores.' : 'La partida comienza con 2 o más jugadores.'}</div><button class="btn btn-primary" data-action="start-room" ${!isHost || !canStart ? 'disabled' : ''}>Empezar partida ↗</button></div>
        ${!isHost ? '<p class="muted small" style="margin:13px 0 0">Solo el anfitrión puede iniciar la partida.</p>' : ''}
      </section>
      <aside class="panel"><div class="eyebrow">Reglas confirmadas</div><h3>Así se juega</h3>${settingsTemplate(room)}<div class="separator"></div><button class="btn btn-secondary btn-block" data-action="copy-code">Copiar código de sala</button><p class="muted small" style="margin:12px 0 0">El código sirve para unirse a esta sala. Para participar en una liga, cada jugador también debe haberse unido a esa liga.</p></aside>
    </div>`;
}
function gameFeedback(room) {
  const result = room.lastResult;
  if (!result || result.type !== 'answer') return '';
  if (result.correct) return `<div class="feedback correct"><div class="feedback-title">✓ ${esc(result.username)} ha acertado${result.wasRebound ? ' de rebote' : ''}</div><div>${esc(result.feedback || 'Respuesta correcta.')}</div><div class="feedback-answer">Solución: ${esc(result.answer || '')}</div>${result.explanation ? `<div class="muted small">${esc(result.explanation)}</div>` : ''}</div>`;
  if (result.allFailed) return `<div class="feedback incorrect"><div class="feedback-title">La pregunta se cierra sin puntos</div><div>${esc(result.feedback || 'Nadie ha acertado.')}</div><div class="feedback-answer">Solución: ${esc(result.answer || '')}</div>${result.explanation ? `<div class="muted small">${esc(result.explanation)}</div>` : ''}</div>`;
  return `<div class="feedback incorrect"><div class="feedback-title">✕ ${esc(result.username)} no ha acertado</div><div>${esc(result.feedback || 'La pregunta rebota al siguiente jugador.')}</div><div class="muted small" style="margin-top:7px">Ahora responde: <strong>${esc(result.nextUsername || '')}</strong>. La solución seguirá oculta hasta que termine la ronda.</div></div>`;
}
function scoreList(room) {
  const isHost = state.me?.id === room.hostId;
  const canManage = ['playing', 'tiebreak', 'loading-question', 'lobby'].includes(room.phase);
  return `<div class="score-list">${room.players.map((player, index) => {
    const isActive = player.id === room.currentTurnUserId && ['playing', 'tiebreak'].includes(room.phase);
    const tieEligible = room.tieScores && Object.hasOwn(room.tieScores, player.id);
    const visibleScore = room.phase === 'tiebreak' && tieEligible ? (room.tieScores[player.id] || 0) : player.score;
    const sub = room.phase === 'tiebreak' ? (tieEligible ? `Desempate · ${player.score} pts en partida` : 'Fuera del desempate') : `${player.reboundPoints} puntos de rebote`;
    const kickButton = isHost && canManage && player.id !== state.me?.id ? `<button class="btn btn-ghost btn-small" data-action="kick-room-player" data-user-id="${esc(player.id)}" data-username="${esc(player.username)}" title="Expulsar de la partida">Expulsar</button>` : '';
    return `<div class="score-row ${isActive ? 'active' : ''}" style="${room.phase === 'tiebreak' && !tieEligible ? 'opacity:.45' : ''}"><div class="score-rank">${String(index + 1).padStart(2, '0')}</div><div class="score-player-cell">${userAvatarMarkup(player, 'score-avatar')}<div class="score-player-text"><div class="score-name">${esc(player.username)} ${player.id === state.me?.id ? '<span style="color:var(--lime)">(tú)</span>' : ''}</div><div class="score-state">${isActive ? '● En turno' : esc(sub)}</div></div></div><div style="display:flex;align-items:center;gap:9px;justify-content:flex-end"><div><div class="score-value">${number(visibleScore)}</div><div class="score-label">${room.phase === 'tiebreak' && tieEligible ? 'DESEMPATE' : 'PUNTOS'}</div></div>${kickButton}</div></div>`;
  }).join('')}</div>`;
}
function gameTemplate() {
  const room = state.room;
  if (!room) return loadingRoomTemplate('Conectando con la partida…');
  const activePhase = ['playing', 'tiebreak'].includes(room.phase);
  const isMyTurn = state.me && room.currentTurnUserId === state.me.id;
  const progress = room.settings.scoringMode === 'questions' ? Math.min(100, (room.completedQuestions / room.settings.limitValue) * 100) : 0;
  const question = room.currentQuestion;
  const turnBanner = room.roundTransition
    ? '<div class="turn-banner waiting">Preparando la siguiente pregunta…</div>'
    : activePhase
      ? (isMyTurn ? `<div class="turn-banner">✦ <strong>Es tu turno.</strong> Escribe la respuesta que consideres correcta. ${room.attemptNumber > 1 ? `Esta pregunta ya ha rebotado ${room.attemptNumber - 1} ${room.attemptNumber === 2 ? 'vez' : 'veces'}.` : 'Si fallas, el siguiente jugador tendrá su oportunidad.'}</div>` : `<div class="turn-banner waiting">Turno de <strong>${esc(room.currentTurnUsername || 'otro jugador')}</strong>. ${room.attemptNumber > 1 ? `Intento de rebote nº ${room.attemptNumber}.` : 'Prepara tu respuesta para la siguiente pregunta.'}</div>`)
      : `<div class="turn-banner waiting">${room.phase === 'loading-question' ? 'La IA está preparando la siguiente pregunta…' : 'Conectando con la partida…'}</div>`;
  const questionContent = question ? `<div class="question-meta"><span class="tag ${question.tieBreaker ? 'lime' : ''}">${question.tieBreaker ? `DESEMPATE · RONDA ${room.tieBreakRound}` : `PREGUNTA ${room.completedQuestions + 1}${room.settings.scoringMode === 'questions' ? ` / ${room.settings.limitValue}` : ''}`}</span><span class="tag">${topicEmoji(question.topic)} Tema: ${esc(question.topic || room.settings.topic)}</span></div><div class="question-text">${esc(question.question)}</div>` : `<div class="question-meta"><span class="tag">PREPARANDO PREGUNTA</span></div><div class="question-text" style="font-size:23px">La siguiente pregunta está a punto de aparecer.</div><div class="loader"></div>`;
  const answerForm = activePhase && isMyTurn ? `<form class="answer-form" id="answer-form"><input class="field" id="answer-input" name="answer" maxlength="500" placeholder="Escribe tu respuesta…" value="${esc(state.answerDraft)}" autocomplete="off" required ${room.processing || room.roundTransition || !question ? 'disabled' : ''}><button class="btn btn-primary" type="submit" ${room.processing || room.roundTransition || !question ? 'disabled' : ''}>${room.processing ? 'Valorando…' : room.roundTransition ? 'Preparando…' : 'Enviar respuesta ↗'}</button></form><p class="muted small" style="margin:12px 0 0">No hay opciones: escribe con tus palabras. ${room.processing ? 'La respuesta se está valorando.' : room.roundTransition ? 'Preparando la siguiente pregunta.' : 'Se aceptarán formulaciones equivalentes cuando proceda.'}</p>`
    : activePhase ? `<div class="empty-state">${room.processing ? 'Estamos valorando la respuesta…' : `La pregunta está en manos de ${esc(room.currentTurnUsername || 'otro jugador')}.`}<br>Podrás responder cuando llegue tu turno.</div>` : '';
  const isHost = state.me?.id === room.hostId;
  return `
    <div class="room-top"><div><div class="eyebrow">${room.mode === 'league' ? `Liga / ${esc(room.leagueName || '')}` : 'Partida rápida'} · Sala ${esc(room.code)}</div><h1>${room.phase === 'tiebreak' ? 'Desempate' : 'A pensar'}<span style="color:var(--lime)">.</span></h1><p class="muted small" style="margin:8px 0 0">${room.settings.scoringMode === 'questions' ? `${room.completedQuestions} de ${room.settings.limitValue} preguntas completadas` : `Gana quien llegue a ${room.settings.limitValue} puntos`}</p></div><div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end"><button class="btn btn-ghost btn-small" data-action="leave-room">Salir al menú</button>${isHost ? '<button class="btn btn-ghost btn-small" data-action="end-room">Terminar partida</button>' : ''}<button class="btn btn-ghost btn-small" data-action="copy-code">Código ${esc(room.code)} ⧉</button></div></div>
    ${room.settings.scoringMode === 'questions' && !room.tieBreaker ? `<div class="progress-track"><div class="progress-fill" style="width:${progress}%"></div></div>` : ''}
    <div class="game-layout">
      <section class="question-card">${turnBanner}${questionContent}${room.processing ? '<div class="notice" style="margin-top:15px">La respuesta está siendo valorada. No envíes otra hasta que termine.</div>' : ''}${answerForm}${gameFeedback(room)}
        <div class="space-between" style="margin-top:23px;position:relative;z-index:2"><span class="muted small">${room.players.length} jugadores · orden fijo</span><button class="btn btn-ghost btn-small" data-action="copy-code">Compartir código</button></div>
      </section>
      <aside class="panel"><div class="panel-head"><div><div class="eyebrow">Marcador en directo</div><h3>${room.phase === 'tiebreak' ? 'Puntos de desempate' : 'Clasificación provisional'}</h3></div><span class="tag">${room.players.length} jugadores</span></div>${scoreList(room)}<div class="separator"></div>${settingsTemplate(room)}
      </aside>
    </div>`;
}
function resultTemplate() {
  const room = state.room;
  if (!room) return dashboardTemplate();
  const winner = room.winnerUsername || 'Sin ganador';
  const meWon = room.winnerId && room.winnerId === state.me?.id;
  const playersSorted = [...room.players].sort((a, b) => b.score - a.score);
  return `
    <div class="result-hero"><div class="result-emblem">${meWon ? '♛' : '✦'}</div><div class="eyebrow">Partida finalizada</div><h1>${meWon ? 'Victoria.' : `Gana ${esc(winner)}.`}</h1><p>${meWon ? 'Has conseguido la victoria. Una más para el historial.' : `La victoria se la lleva ${esc(winner)}. La revancha queda abierta.`}</p><div class="result-actions"><button class="btn btn-primary" data-action="rematch">Jugar otra partida ↗</button><button class="btn btn-secondary" data-action="home">Volver al panel</button></div></div>
    <div class="two-panels"><section class="panel"><div class="eyebrow">Marcador final</div><h2>Así ha quedado</h2>${scoreList({ ...room, phase: 'finished', currentTurnUserId: null, tieScores: null })}</section><section class="panel"><div class="eyebrow">Resumen de la partida</div><h2>Datos de la mesa</h2>${settingsTemplate(room)}<div class="setting-line"><span>Preguntas completadas</span><strong>${number(room.completedQuestions)}</strong></div><div class="setting-line"><span>Desempate</span><strong>${room.lastResult?.tieBreaker ? 'Sí' : 'No'}</strong></div>${room.mode === 'league' ? '<div class="notice success" style="margin-top:17px">El resultado se ha guardado en la clasificación de la liga: 3 puntos para el ganador.</div>' : ''}</section></div>`;
}
function leagueDetailTemplate() {
  const data = state.activeLeague;
  if (!data) return loadingRoomTemplate('Cargando clasificación…');
  const league = data.league;
  return `
    <button class="back-link" data-action="leagues">← Volver a mis ligas</button>
    <div class="room-top"><div><div class="eyebrow">Modo liga / Clasificación oficial</div><h1>${esc(league.name)}<span style="color:var(--lime)">.</span></h1><p class="muted small" style="margin:8px 0 0">Cada victoria suma 3 puntos. Los resultados se conservan entre sesiones.</p></div><div class="room-code">${esc(league.code)}</div></div>
    <div class="two-panels">
      <section class="panel"><div class="panel-head"><div><div class="eyebrow">La tabla</div><h2>Clasificación</h2></div><span class="tag lime">${data.standings.length} jugadores</span></div>
        ${data.standings.length ? `<div class="table-wrap"><table class="standings"><thead><tr><th>#</th><th>Jugador</th><th>J</th><th>V</th><th>D</th><th>Pts</th>${String(league.creatorId) === String(state.me?.id) ? '<th>Acción</th>' : ''}</tr></thead><tbody>${data.standings.map((p, index) => `<tr><td><span class="rank-badge ${index === 0 ? 'first' : ''}">${index + 1}</span></td><td><div class="league-player-cell">${userAvatarMarkup({ username: p.username, avatarData: p.avatarData }, 'league-avatar')}<strong>${esc(p.username)}${p.id === state.me?.id ? ' (tú)' : ''}</strong></div></td><td>${number(p.played)}</td><td>${number(p.wins)}</td><td>${number(p.losses)}</td><td style="color:${index === 0 ? 'var(--lime)' : 'var(--text)'};font-weight:800">${number(p.points)}</td>${String(league.creatorId) === String(state.me?.id) ? `<td>${String(p.id) !== String(league.creatorId) ? `<button class="btn btn-ghost btn-small" data-action="kick-league-member" data-user-id="${esc(p.id)}" data-username="${esc(p.username)}" data-league-code="${esc(league.code)}">Expulsar</button>` : '<span class="muted small">Host</span>'}</td>` : ''}</tr>`).join('')}</tbody></table></div>` : '<div class="empty-state">Todavía no hay jugadores en la clasificación.</div>'}
        <div class="separator"></div><div class="space-between"><div><div class="small muted">Código para invitar</div><div class="mono" style="color:var(--lime);margin-top:5px">${esc(league.code)}</div></div><button class="btn btn-ghost btn-small" data-action="copy-league-code">Copiar código ⧉</button></div>
      </section>
      <section class="panel"><div class="eyebrow">Duelo 1 contra 1</div><h2>Desafía a un jugador</h2><p class="muted small">Cada enfrentamiento puede tener una temática y unas reglas diferentes. Configura este duelo y comparte el código con alguien de la liga.</p>
        <form id="create-league-duel-form" data-league-id="${esc(league.id)}">
          <div class="field-block"><label class="field-label">Temática para este duelo</label><div class="topic-grid">${topicOptions()}</div></div>
          <div id="league-duel-custom-topic-wrap" class="field-block hidden"><label class="field-label" for="league-duel-custom-topic">Tema personalizado</label><input class="field" id="league-duel-custom-topic" name="customTopic" maxlength="100" placeholder="Ej. Marvel, astronomía, cine clásico…"></div>
          <div class="subsection"><label class="field-label">Condición de victoria</label><div class="choice-row">
            <label class="choice-card"><input type="radio" name="scoringMode" value="target" checked><span><b class="choice-title">Llegar a puntos</b><small class="choice-desc">Gana quien alcance primero la puntuación elegida.</small></span></label>
            <label class="choice-card"><input type="radio" name="scoringMode" value="questions"><span><b class="choice-title">Número de preguntas</b><small class="choice-desc">Gana quien tenga más puntos al terminar el total.</small></span></label>
          </div>
          <div class="field-block"><label class="field-label" for="league-duel-limit" id="league-duel-limit-label">Puntos necesarios para ganar</label><input class="field" type="number" id="league-duel-limit" name="limitValue" min="1" max="50" value="5" required></div></div>
          <div class="notice" style="margin:16px 0">Cada victoria suma 3 puntos a la clasificación de esta liga. La configuración solo se aplica a este duelo.</div>
          <div class="form-error" id="create-league-duel-error"></div><button class="btn btn-primary btn-block" type="submit">Crear duelo y recibir código ↗</button>
        </form>
        <div class="subsection"><label class="field-label" for="duel-code">¿Te han pasado un código de duelo?</label><form id="join-duel-form"><div class="inline-form"><input class="field code-input" id="duel-code" name="code" maxlength="8" placeholder="CÓDIGO" required><button class="btn btn-secondary" type="submit">Entrar</button></div><div class="form-error" id="join-duel-error"></div></form></div>
      </section>
    </div>
    <section class="panel" style="margin-top:18px"><div class="panel-head"><div><div class="eyebrow">Registro de enfrentamientos</div><h3>Últimos duelos</h3></div><span class="tag">${data.recentMatches.length}</span></div>
      ${data.recentMatches.length ? `<div class="history-list">${data.recentMatches.map((match) => `<div class="history-item"><div><div class="history-title">${esc(match.players || 'Duelo')} </div><div class="history-sub">${esc(match.topic)} · ${fmtDate(match.finished_at)}</div></div><div class="right"><span class="result-pill win">${esc(match.winner_username || 'Finalizado')}</span></div></div>`).join('')}</div>` : '<div class="empty-state">Todavía no se ha registrado ningún duelo. ¡Inaugura la tabla!</div>'}
    </section>`;
}
function render() {
  authHeader();
  if (state.view === 'auth') app.innerHTML = authTemplate();
  else if (state.view === 'dashboard') app.innerHTML = dashboardTemplate();
  else if (state.view === 'account') app.innerHTML = accountTemplate();
  else if (state.view === 'quick') app.innerHTML = quickTemplate();
  else if (state.view === 'leagues') app.innerHTML = leagueTemplate();
  else if (state.view === 'league-detail') app.innerHTML = leagueDetailTemplate();
  else if (state.view === 'lobby') app.innerHTML = lobbyTemplate();
  else if (state.view === 'game') app.innerHTML = gameTemplate();
  else if (state.view === 'result') app.innerHTML = resultTemplate();
  else app.innerHTML = loadingRoomTemplate();
  if (state.view === 'quick') updateQuickTopicVisibility();
  if (state.view === 'league-detail') updateLeagueDuelSettings();
}
function showFormError(id, message) {
  const element = document.getElementById(id);
  if (!element) { toast(message); return; }
  element.textContent = message;
  element.classList.add('visible');
}
function hideFormError(id) {
  const element = document.getElementById(id);
  if (element) { element.textContent = ''; element.classList.remove('visible'); }
}
function updateQuickTopicVisibility() {
  const chosen = app.querySelector('input[name="topicChoice"]:checked')?.value;
  document.getElementById('custom-topic-wrap')?.classList.toggle('hidden', chosen !== 'Tema personalizado');
  const scoringMode = app.querySelector('input[name="scoringMode"]:checked')?.value || 'target';
  const label = document.getElementById('limit-label');
  const input = document.getElementById('limit-value');
  if (label && input) {
    label.textContent = scoringMode === 'questions' ? 'Número total de preguntas' : 'Puntos necesarios para ganar';
    input.min = scoringMode === 'questions' ? '3' : '1';
    input.max = scoringMode === 'questions' ? '100' : '50';
    const desired = scoringMode === 'questions' ? 15 : 5;
    if ((scoringMode === 'questions' && Number(input.value) < 3) || (scoringMode === 'target' && Number(input.value) > 50)) input.value = desired;
  }
}
function updateLeagueDuelSettings() {
  const chosen = app.querySelector('#create-league-duel-form input[name="topicChoice"]:checked')?.value;
  document.getElementById('league-duel-custom-topic-wrap')?.classList.toggle('hidden', chosen !== 'Tema personalizado');
  const scoringMode = app.querySelector('#create-league-duel-form input[name="scoringMode"]:checked')?.value || 'target';
  const label = document.getElementById('league-duel-limit-label');
  const input = document.getElementById('league-duel-limit');
  if (label && input) {
    label.textContent = scoringMode === 'questions' ? 'Número total de preguntas' : 'Puntos necesarios para ganar';
    input.min = scoringMode === 'questions' ? '3' : '1';
    input.max = scoringMode === 'questions' ? '100' : '50';
    const desired = scoringMode === 'questions' ? 15 : 5;
    if ((scoringMode === 'questions' && Number(input.value) < 3) || (scoringMode === 'target' && Number(input.value) > 50)) input.value = desired;
  }
}
function connectSocket() {
  if (socket) return;
  socket = io();
  socket.on('connect', () => {
    if (state.roomCode) {
      socket.emit('rejoin-room', { code: state.roomCode }, (result) => {
        if (!result?.ok) {
          localStorage.removeItem('trivia-room-code');
          state.roomCode = '';
          state.room = null;
          if (!['league-detail', 'leagues'].includes(state.view)) state.view = 'dashboard';
          render();
        }
      });
    }
  });
  socket.on('connect_error', (error) => {
    if (state.me) toast(error?.message || 'No se ha podido conectar a la partida online.');
  });
  socket.on('room-state', (room) => {
    const previousQuestion = state.room?.currentQuestion?.question || '';
    state.room = room;
    state.roomCode = room.code;
    localStorage.setItem('trivia-room-code', room.code);
    if (room.currentQuestion?.question && room.currentQuestion.question !== previousQuestion) state.answerDraft = '';
    if (room.phase === 'lobby') state.view = 'lobby';
    else if (room.phase === 'finished') state.view = 'result';
    else state.view = 'game';
    if (room.phase === 'finished' && state.finishedFor !== room.code) {
      state.finishedFor = room.code;
      api('/api/me').then((data) => { state.profile = data; state.me = data.user; render(); }).catch(() => {});
      if (room.mode === 'league' && state.activeLeague) {
        api(`/api/leagues/${encodeURIComponent(state.activeLeague.league.code)}`).then((data) => { state.activeLeague = data; }).catch(() => {});
      }
    }
    render();
  });
  socket.on('room-closed', (data) => {
    toast(data?.message || 'La sala se ha cerrado.');
    state.room = null; state.roomCode = ''; state.answerDraft = '';
    localStorage.removeItem('trivia-room-code'); state.view = 'dashboard';
    Promise.all([refreshProfile(), refreshMyLeagues()]).catch(() => {}).finally(render);
  });
  socket.on('room-kicked', (data) => {
    toast(data?.message || 'El anfitrión te ha expulsado de la partida.');
    state.room = null; state.roomCode = ''; state.answerDraft = '';
    localStorage.removeItem('trivia-room-code'); state.view = 'dashboard';
    Promise.all([refreshProfile(), refreshMyLeagues()]).catch(() => {}).finally(render);
  });
  socket.on('league-kicked', (data) => {
    toast(data?.message || 'Te han expulsado de la liga.');
    state.room = null; state.roomCode = ''; state.answerDraft = '';
    localStorage.removeItem('trivia-room-code');
    if (state.activeLeague && String(state.activeLeague.league?.code) === String(data?.leagueCode)) {
      state.activeLeague = null;
      state.view = 'leagues';
    }
    Promise.all([refreshProfile(), refreshMyLeagues()]).catch(() => {}).finally(render);
  });
}
async function refreshProfile() {
  const data = await api('/api/me');
  state.profile = data;
  state.me = data.user;
  state.config.aiEnabled = Boolean(data.aiEnabled);
  return data;
}
async function refreshMyLeagues() {
  const data = await api('/api/leagues/my');
  state.myLeagues = data.leagues || [];
}
async function afterAuth() {
  await refreshProfile();
  await refreshMyLeagues();
  connectSocket();
  state.authError = '';
  state.view = 'dashboard';
  render();
}
async function loadLeague(code) {
  try {
    const data = await api(`/api/leagues/${encodeURIComponent(code)}`);
    state.activeLeague = data;
    state.view = 'league-detail';
    render();
  } catch (error) { toast(error.message); }
}
function emitCreateRoom(payload) {
  if (!socket?.connected) { toast('Conectando al servidor. Inténtalo de nuevo en un momento.'); return; }
  state.roomPending = true;
  render();
  socket.emit('create-room', payload, (result) => {
    state.roomPending = false;
    if (!result?.ok) { state.view = payload.mode === 'league' ? 'league-detail' : 'quick'; render(); toast(result?.error || 'No se pudo crear la sala.'); return; }
    state.roomCode = result.code;
    localStorage.setItem('trivia-room-code', result.code);
    state.finishedFor = null;
    state.view = 'lobby';
    render();
  });
}
function emitJoinRoom(code, errorId, fallbackView) {
  if (!socket?.connected) { showFormError(errorId, 'No hay conexión con el servidor. Espera un momento y vuelve a intentarlo.'); return; }
  hideFormError(errorId);
  state.roomPending = true;
  socket.emit('join-room', { code }, (result) => {
    state.roomPending = false;
    if (!result?.ok) {
      if (fallbackView) state.view = fallbackView;
      render();
      showFormError(errorId, result?.error || 'No se pudo entrar en la sala.');
      return;
    }
    state.roomCode = result.code;
    localStorage.setItem('trivia-room-code', result.code);
    state.finishedFor = null;
    state.view = 'lobby';
    render();
  });
}
async function backHome() {
  const hasRoom = Boolean(state.room || state.roomCode);
  const activeGame = state.room && ['playing', 'tiebreak', 'loading-question'].includes(state.room.phase);
  if (activeGame) {
    const warning = state.room.mode === 'league'
      ? 'Si sales ahora, tu rival ganará el duelo por retirada y sumará 3 puntos a la liga. ¿Quieres salir?'
      : '¿Salir al menú? La partida continuará para los demás jugadores.';
    if (!window.confirm(warning)) return;
  }
  if (hasRoom && socket?.connected) {
    const result = await new Promise((resolve) => {
      let settled = false;
      let timeoutId;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        if (timeoutId) clearTimeout(timeoutId);
        resolve(value);
      };
      socket.emit('leave-room', {}, (response) => finish(response || { ok: false, error: 'El servidor no ha confirmado la salida.' }));
      timeoutId = setTimeout(() => finish({ ok: false, error: 'No se ha recibido confirmación del servidor. Comprueba tu conexión y vuelve a intentarlo.' }), 1800);
    });
    if (!result?.ok) {
      toast(result?.error || 'No se ha podido salir de la partida.');
      return;
    }
  }
  state.room = null;
  state.roomCode = '';
  state.answerDraft = '';
  localStorage.removeItem('trivia-room-code');
  state.view = 'dashboard';
  try { await refreshProfile(); await refreshMyLeagues(); } catch {}
  render();
}

document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  if (action === 'auth-login') { state.authMode = 'login'; state.authError = ''; render(); }
  else if (action === 'auth-register') { state.authMode = 'register'; state.authError = ''; render(); }
  else if (action === 'home') await backHome();
  else if (action === 'profile') { state.view = 'account'; render(); }
  else if (action === 'dashboard-back') { state.view = 'dashboard'; render(); }
  else if (action === 'remove-avatar') {
    if (!window.confirm('¿Quitar tu foto de perfil?')) return;
    try {
      await api('/api/account/profile', { method: 'PATCH', body: JSON.stringify({ username: state.me.username, avatarData: null }) });
      await refreshProfile();
      render();
      toast('Foto de perfil eliminada.');
    } catch (error) { toast(error.message || 'No se pudo quitar la foto.'); }
  }
  else if (action === 'quick') { state.room = null; state.view = 'quick'; render(); }
  else if (action === 'leagues') { try { await refreshMyLeagues(); } catch {} state.view = 'leagues'; render(); }
  else if (action === 'open-league') await loadLeague(button.dataset.code);
  else if (action === 'logout') {
    if (state.room && ['playing', 'tiebreak', 'loading-question'].includes(state.room.phase)) {
      toast('Termina la partida o vuelve a conectarte antes de cerrar sesión.'); return;
    }
    try { await api('/api/logout', { method: 'POST' }); } catch {}
    if (socket) { socket.disconnect(); socket = null; }
    state.me = null; state.profile = null; state.room = null; state.roomCode = '';
    localStorage.removeItem('trivia-room-code'); state.view = 'auth'; state.authMode = 'login'; render();
  }
  else if (action === 'copy-code') {
    const code = state.room?.code || state.roomCode;
    if (code) { try { await navigator.clipboard.writeText(code); toast(`Código ${code} copiado.`); } catch { toast(`Código de sala: ${code}`); } }
  }
  else if (action === 'copy-league-code') {
    const code = state.activeLeague?.league?.code;
    if (code) { try { await navigator.clipboard.writeText(code); toast(`Código de liga ${code} copiado.`); } catch { toast(`Código de liga: ${code}`); } }
  }
  else if (action === 'start-room') {
    socket?.emit('start-room', {}, (result) => { if (!result?.ok) toast(result?.error || 'No se pudo iniciar la partida.'); });
  }
  else if (action === 'leave-room') await backHome();
  else if (action === 'end-room') {
    if (!socket?.connected) { toast('No hay conexión con el servidor. Espera a reconectarte para terminar la partida.'); return; }
    if (!window.confirm('¿Terminar la partida para todos? No habrá ganador y el duelo no sumará puntos a la liga.')) return;
    socket.emit('end-room', {}, (result) => {
      if (!result?.ok) toast(result?.error || 'No se pudo terminar la partida.');
      // El servidor enviará room-closed a todos si la operación se completa.
    });
  }
  else if (action === 'kick-room-player') {
    const userId = button.dataset.userId;
    const username = button.dataset.username || 'este jugador';
    if (!window.confirm(`¿Expulsar a ${username} de esta partida?`)) return;
    socket?.emit('kick-room-player', { userId }, (result) => {
      if (!result?.ok) toast(result?.error || 'No se pudo expulsar al jugador.');
      else toast(`${username} ha sido expulsado de la partida.`);
    });
  }
  else if (action === 'kick-league-member') {
    const userId = button.dataset.userId;
    const username = button.dataset.username || 'este jugador';
    const code = button.dataset.leagueCode;
    if (!window.confirm(`¿Expulsar a ${username} de esta liga? Se eliminará de la clasificación de la liga, pero no se borrará su perfil ni el historial de partidas ya terminadas.`)) return;
    try {
      await api(`/api/leagues/${encodeURIComponent(code)}/members/${encodeURIComponent(userId)}`, { method: 'DELETE' });
      await refreshMyLeagues();
      await loadLeague(code);
      toast(`${username} ha sido expulsado de la liga.`);
    } catch (error) { toast(error.message || 'No se pudo expulsar al usuario de la liga.'); }
  }
  else if (action === 'rematch') {
    const room = state.room;
    if (!room) { state.view = 'quick'; render(); return; }
    const mode = room.mode;
    const leagueId = room.leagueId;
    const settings = { ...room.settings };
    await backHome();
    if (mode === 'league') {
      const leagueData = state.myLeagues.find((l) => String(l.id) === String(leagueId));
      if (leagueData) await loadLeague(leagueData.code);
      else state.view = 'leagues';
      render();
      toast('Crea un nuevo duelo y comparte el nuevo código.');
    } else {
      state.view = 'quick'; render();
      const topicRadio = app.querySelector(`input[name="topicChoice"][value="${CSS.escape(settings.topic)}"]`);
      if (topicRadio) topicRadio.checked = true;
    }
  }
});

app.addEventListener('change', (event) => {
  if (event.target.id === 'avatar-file') {
    const file = event.target.files?.[0];
    const preview = document.getElementById('profile-avatar-preview');
    if (file && preview) {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        event.target.value = '';
        toast('Elige una imagen JPG, PNG o WebP.');
      } else if (file.size > 8 * 1024 * 1024) {
        event.target.value = '';
        toast('La imagen original debe pesar menos de 8 MB.');
      } else {
        const img = document.createElement('img');
        img.className = 'account-avatar';
        img.alt = 'Vista previa de la foto de perfil';
        img.src = URL.createObjectURL(file);
        preview.replaceChildren(img);
      }
    }
  }
  if (state.view === 'quick' && (event.target.name === 'topicChoice' || event.target.name === 'scoringMode')) updateQuickTopicVisibility();
  if (state.view === 'league-detail' && (event.target.name === 'topicChoice' || event.target.name === 'scoringMode')) updateLeagueDuelSettings();
});
app.addEventListener('input', (event) => {
  if (event.target.id === 'answer-input') state.answerDraft = event.target.value;
  if (event.target.classList.contains('code-input')) event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
});

async function compressAvatarFile(file) {
  if (!file) return null;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Elige una imagen JPG, PNG o WebP.');
  if (file.size > 8 * 1024 * 1024) throw new Error('La imagen original debe pesar menos de 8 MB.');
  let bitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new Error('No se ha podido abrir la imagen. Prueba con otro archivo JPG, PNG o WebP.'); }
  const scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) { bitmap.close?.(); throw new Error('El navegador no ha podido procesar la imagen.'); }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  for (const quality of [0.82, 0.72, 0.62, 0.52, 0.42]) {
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    if (dataUrl.length <= 180000) return dataUrl;
  }
  throw new Error('La imagen no se puede comprimir lo suficiente. Prueba con otra foto.');
}

app.addEventListener('submit', async (event) => {
  const form = event.target;
  event.preventDefault();
  if (form.id === 'auth-form') {
    state.authError = '';
    const values = new FormData(form);
    const username = String(values.get('username') || '').trim();
    const password = String(values.get('password') || '');
    try {
      await api(state.authMode === 'register' ? '/api/register' : '/api/login', {
        method: 'POST', body: JSON.stringify({ username, password }),
      });
      await afterAuth();
      toast(`Bienvenido${state.authMode === 'register' ? ' a Trivia Arena' : ' de nuevo'}, ${username}.`);
    } catch (error) {
      state.authError = error.message;
      const box = document.getElementById('auth-error');
      if (box) { box.textContent = error.message; box.classList.add('visible'); }
    }
  }
  else if (form.id === 'profile-form') {
    hideFormError('profile-error');
    const values = new FormData(form);
    const username = String(values.get('username') || '').trim();
    if (!/^[\p{L}\p{N}_-]{3,20}$/u.test(username)) {
      showFormError('profile-error', 'El usuario debe tener entre 3 y 20 caracteres y solo puede incluir letras, números, guion o guion bajo.');
      return;
    }
    const file = document.getElementById('avatar-file')?.files?.[0];
    try {
      const body = { username };
      if (file) body.avatarData = await compressAvatarFile(file);
      await api('/api/account/profile', { method: 'PATCH', body: JSON.stringify(body) });
      await refreshProfile();
      await refreshMyLeagues();
      render();
      toast('Perfil actualizado correctamente.');
    } catch (error) { showFormError('profile-error', error.message || 'No se pudo guardar el perfil.'); }
  }
  else if (form.id === 'password-form') {
    hideFormError('password-error');
    const values = new FormData(form);
    const currentPassword = String(values.get('currentPassword') || '');
    const newPassword = String(values.get('newPassword') || '');
    const confirmPassword = String(values.get('confirmPassword') || '');
    if (newPassword.length < 8 || newPassword.length > 128) {
      showFormError('password-error', 'La nueva contraseña debe tener entre 8 y 128 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      showFormError('password-error', 'Las nuevas contraseñas no coinciden.');
      return;
    }
    try {
      const data = await api('/api/account/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
      form.reset();
      toast(data.message || 'Contraseña actualizada.');
    } catch (error) { showFormError('password-error', error.message || 'No se pudo cambiar la contraseña.'); }
  }
  else if (form.id === 'quick-form') {
    const values = new FormData(form);
    const selectedTopic = String(values.get('topicChoice') || 'Cultura general');
    const topic = selectedTopic === 'Tema personalizado' ? String(values.get('customTopic') || '').trim() : selectedTopic;
    if (!topic) { showFormError('quick-error', 'Escribe el tema personalizado.'); return; }
    const scoringMode = String(values.get('scoringMode') || 'target');
    const limitValue = Number(values.get('limitValue'));
    if (!Number.isInteger(limitValue) || limitValue < (scoringMode === 'questions' ? 3 : 1) || limitValue > (scoringMode === 'questions' ? 100 : 50)) {
      showFormError('quick-error', scoringMode === 'questions' ? 'Elige entre 3 y 100 preguntas.' : 'Elige entre 1 y 50 puntos.'); return;
    }
    if (!state.config.aiEnabled && selectedTopic === 'Tema personalizado') toast('Sin IA, el tema personalizado usará preguntas de respaldo cuando sea posible.');
    emitCreateRoom({ mode: 'quick', topic, scoringMode, limitValue });
  }
  else if (form.id === 'join-quick-form') {
    const values = new FormData(form);
    emitJoinRoom(String(values.get('code') || ''), 'join-error', 'quick');
  }
  else if (form.id === 'create-league-form') {
    const values = new FormData(form);
    try {
      const data = await api('/api/leagues', { method: 'POST', body: JSON.stringify({ name: values.get('name') }) });
      state.activeLeague = data;
      await refreshMyLeagues();
      state.view = 'league-detail'; render();
      toast(`Liga creada. Comparte el código ${data.league.code}.`);
    } catch (error) { showFormError('create-league-error', error.message); }
  }
  else if (form.id === 'create-league-duel-form') {
    const values = new FormData(form);
    const selectedTopic = String(values.get('topicChoice') || 'Cultura general');
    const topic = selectedTopic === 'Tema personalizado' ? String(values.get('customTopic') || '').trim() : selectedTopic;
    const scoringMode = String(values.get('scoringMode') || 'target');
    const limitValue = Number(values.get('limitValue'));
    if (!topic) { showFormError('create-league-duel-error', 'Escribe el tema personalizado para este duelo.'); return; }
    if (!Number.isInteger(limitValue) || limitValue < (scoringMode === 'questions' ? 3 : 1) || limitValue > (scoringMode === 'questions' ? 100 : 50)) {
      showFormError('create-league-duel-error', scoringMode === 'questions' ? 'Elige entre 3 y 100 preguntas.' : 'Elige entre 1 y 50 puntos.'); return;
    }
    if (!state.config.aiEnabled && selectedTopic === 'Tema personalizado') toast('Sin IA, el tema personalizado usará preguntas de respaldo cuando sea posible.');
    emitCreateRoom({ mode: 'league', leagueId: form.dataset.leagueId, topic, scoringMode, limitValue });
  }
  else if (form.id === 'join-league-form') {
    const values = new FormData(form);
    try {
      const data = await api('/api/leagues/join', { method: 'POST', body: JSON.stringify({ code: values.get('code') }) });
      state.activeLeague = data;
      await refreshMyLeagues();
      state.view = 'league-detail'; render();
      toast(`Te has unido a ${data.league.name}.`);
    } catch (error) { showFormError('join-league-error', error.message); }
  }
  else if (form.id === 'join-duel-form') {
    const values = new FormData(form);
    emitJoinRoom(String(values.get('code') || ''), 'join-duel-error', 'league-detail');
  }
  else if (form.id === 'answer-form') {
    const input = document.getElementById('answer-input');
    const answer = String(new FormData(form).get('answer') || '').trim();
    if (!answer) return;
    if (!socket?.connected) { toast('Se ha perdido la conexión. Espera a que se reconecte.'); return; }
    state.answerDraft = '';
    if (input) input.value = '';
    socket.emit('submit-answer', { answer }, (result) => {
      if (!result?.ok) { state.answerDraft = answer; toast(result?.error || 'No se pudo enviar la respuesta.'); render(); }
    });
  }
});

async function boot() {
  try {
    const config = await api('/api/config');
    state.config = config;
    try {
      await refreshProfile();
      await refreshMyLeagues();
      state.view = 'dashboard';
      connectSocket();
    } catch {
      state.me = null;
      state.profile = null;
      state.view = 'auth';
      state.roomCode = '';
      localStorage.removeItem('trivia-room-code');
    }
  } catch (error) {
    state.view = 'auth';
    state.authError = `No se puede conectar con el servidor: ${error.message}`;
  }
  render();
}

boot();
