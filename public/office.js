// Claude Company : rendu pixel art du bureau et des agents.
(() => {
  const T = 16, W = 31, H = 19;
  const canvas = document.getElementById('office');
  const ctx = canvas.getContext('2d');
  const S = 3; // rendu interne ×3 : pixel art identique, texte net
  canvas.width = W * T * S; canvas.height = H * T * S;
  const FONT = '"Pixelify Sans", monospace';

  const STATE_LABEL = { working: 'au travail', thinking: 'réfléchit', waiting: 't\'attend', blocked: 'bloqué ?', idle: 'en pause' };
  const STATE_COLOR = { working: '#6fd08c', thinking: '#7fb5ff', waiting: '#ffd166', blocked: '#ff6b6b', idle: '#8a8198' };

  // ---------- Plan du bureau ----------
  const ROOMS = {
    code:    { x0: 1,  x1: 9,  y0: 1,  y1: 7,  door: 5,  label: 'Atelier code',   floor: 'wood' },
    library: { x0: 11, x1: 19, y0: 1,  y1: 7,  door: 15, label: 'Bibliothèque',   floor: 'carpetRed' },
    servers: { x0: 21, x1: 29, y0: 1,  y1: 7,  door: 25, label: 'Salle serveurs', floor: 'metal' },
    web:     { x0: 1,  x1: 9,  y0: 12, y1: 17, door: 5,  label: 'Veille web',     floor: 'carpetBlue' },
    meeting: { x0: 11, x1: 19, y0: 12, y1: 17, door: 15, label: 'Réunion',        floor: 'parquet' },
    cafe:    { x0: 21, x1: 29, y0: 12, y1: 17, door: 25, label: 'Cafétéria',      floor: 'checker' },
  };
  const ZONE_INFO = {
    code: 'écrit du code', library: 'lit et cherche', servers: 'lance des commandes',
    web: 'web et outils externes', meeting: 'planifie et délègue', cafe: 'attente ou pause',
  };
  const ENTRY = { x: 0, y: 10 };

  const walk = Array.from({ length: H }, () => Array(W).fill(false));
  const floorOf = Array.from({ length: H }, () => Array(W).fill(null));
  for (const [z, r] of Object.entries(ROOMS))
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) { walk[y][x] = true; floorOf[y][x] = r.floor; }
  for (let y = 9; y <= 10; y++) for (let x = 1; x <= 29; x++) { walk[y][x] = true; floorOf[y][x] = 'corridor'; }
  for (const r of Object.values(ROOMS)) { const dy = r.y0 === 1 ? 8 : 11; walk[dy][r.door] = true; floorOf[dy][r.door] = 'door'; }
  walk[9][0] = walk[10][0] = true; floorOf[9][0] = floorOf[10][0] = 'entry';

  const furniture = [];
  const seats = [];
  const block = (x, y, w = 1, h = 1) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) walk[y + j][x + i] = false; };
  const add = (type, x, y, w = 1, h = 1, extra = {}) => { const f = { type, x, y, w, h, ...extra }; furniture.push(f); block(x, y, w, h); return f; };
  const seat = (zone, x, y, facing, sit, desk = null) => seats.push({ zone, x, y, facing, sit, desk, taken: null });

  for (const y of [2, 5]) for (const x of [2, 4, 6, 8]) seat('code', x, y + 1, 'up', true, add('desk', x, y, 1, 1, { screen: 'code' }));
  add('plant', 1, 1); add('plant', 9, 7);
  for (let x = 11; x <= 19; x++) add('shelf', x, 1);
  for (const [x, y] of [[12, 3], [16, 3], [12, 5], [16, 5]]) { add('table', x, y, 2, 1); seat('library', x, y + 1, 'up', true); seat('library', x + 1, y + 1, 'up', true); }
  for (const x of [22, 23, 25, 26, 28]) add('rack', x, 1, 1, 2);
  for (const x of [22, 24, 26, 28]) seat('servers', x, 6, 'up', true, add('desk', x, 5, 1, 1, { screen: 'term' }));
  for (const x of [22, 25, 28]) seat('servers', x, 3, 'up', false);
  for (const y of [13, 16]) for (const x of [2, 4, 6, 8]) seat('web', x, y + 1, 'up', true, add('desk', x, y, 1, 1, { screen: 'web' }));
  add('plant', 1, 12); add('plant', 9, 12);
  add('meetingTable', 13, 14, 5, 2);
  for (let x = 13; x <= 17; x++) { seat('meeting', x, 13, 'down', true); seat('meeting', x, 16, 'up', true); }
  add('plant', 11, 12); add('plant', 19, 17);
  add('counter', 22, 12, 3, 1);
  for (const x of [22, 23, 24]) seat('cafe', x, 13, 'up', false);
  add('vending', 28, 12); add('vending', 29, 12, 1, 1, { variant: 1 });
  add('sofa', 25, 15, 4, 1);
  for (let x = 25; x <= 28; x++) seat('cafe', x, 16, 'down', true);
  add('coffeeTable', 26, 17, 2, 1);
  add('plant', 21, 17);

  const seatAt = new Set(seats.map(s => `${s.x},${s.y}`));
  const standSpots = {};
  for (const [z, r] of Object.entries(ROOMS)) {
    standSpots[z] = [];
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
      const nearDoor = x === r.door && (y === r.y0 || y === r.y1);
      if (walk[y][x] && !seatAt.has(`${x},${y}`) && !nearDoor) standSpots[z].push({ zone: z, x, y, facing: 'down', sit: false, taken: null, stand: true });
    }
  }

  // ---------- Utilitaires ----------
  const hash = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
  const SHIRTS = ['#e07a5f', '#3d85c6', '#81b29a', '#f2cc8f', '#c77dff', '#ef476f', '#06d6a0', '#118ab2', '#e9c46a', '#8d99ae'];
  const HAIRS = ['#2b1d14', '#5a3825', '#a0522d', '#e6c27a', '#1c1c1c', '#8b8b8b', '#b5651d'];
  const SKINS = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'];
  const R = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), w, h); };

  function findPath(sx, sy, tx, ty) {
    if (sx === tx && sy === ty) return [];
    const prev = new Map([[`${sx},${sy}`, null]]);
    const q = [[sx, sy]];
    while (q.length) {
      const [x, y] = q.shift();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, k = `${nx},${ny}`;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || prev.has(k) || !walk[ny][nx]) continue;
        prev.set(k, `${x},${y}`);
        if (nx === tx && ny === ty) {
          const path = []; let c = k;
          while (c && c !== `${sx},${sy}`) { const [px, py] = c.split(',').map(Number); path.unshift({ x: px, y: py }); c = prev.get(c); }
          return path;
        }
        q.push([nx, ny]);
      }
    }
    return [{ x: tx, y: ty }]; // à défaut, téléportation douce
  }

  // ---------- Décor ----------
  function drawFloor(x, y, kind, t) {
    const X = x * T, Y = y * T;
    switch (kind) {
      case 'wood':
        R(X, Y, T, T, '#8a5a3b');
        for (let i = 0; i < 4; i++) { R(X, Y + i * 4 + 3, T, 1, '#74492f'); R(X + ((i + y) % 2 ? 4 : 11), Y + i * 4, 1, 3, '#74492f'); }
        break;
      case 'carpetRed':
        R(X, Y, T, T, '#6e2f3a');
        for (let i = 0; i < T; i += 4) for (let j = 0; j < T; j += 4) if ((i + j) % 8 === 0) R(X + i + 1, Y + j + 1, 1, 1, '#83404c');
        break;
      case 'metal':
        R(X, Y, T, T, '#4b5563'); R(X, Y, T, 1, '#5b6573'); R(X, Y + 15, T, 1, '#363d48'); R(X + 15, Y, 1, T, '#363d48');
        R(X + 2, Y + 2, 1, 1, '#7b8594'); R(X + 13, Y + 13, 1, 1, '#7b8594');
        break;
      case 'carpetBlue':
        R(X, Y, T, T, '#2f4a6e');
        for (let i = 0; i < T; i += 4) for (let j = 0; j < T; j += 4) if ((i + j) % 8 === 4) R(X + i + 1, Y + j + 1, 1, 1, '#3b5c86');
        break;
      case 'parquet':
        R(X, Y, T, T, '#a0703f');
        for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
          const bx = X + i * 8, by = Y + j * 8;
          if ((i + j) % 2) { R(bx, by + 3, 8, 1, '#8a5e33'); R(bx, by + 7, 8, 1, '#8a5e33'); } else { R(bx + 3, by, 1, 8, '#8a5e33'); R(bx + 7, by, 1, 8, '#8a5e33'); }
        }
        break;
      case 'checker':
        for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) R(X + i * 8, Y + j * 8, 8, 8, (i + j + x + y) % 2 ? '#d9d2c3' : '#b8ae9c');
        break;
      case 'corridor': case 'door':
        R(X, Y, T, T, '#6b6577'); R(X, Y + 15, T, 1, '#5d576a'); R(X + 15, Y, 1, T, '#5d576a');
        if (kind === 'door') { R(X, Y, 2, T, '#3d3150'); R(X + 14, Y, 2, T, '#3d3150'); }
        break;
      case 'entry':
        R(X, Y, T, T, '#6b6577'); R(X + 2, Y, 2, T, '#9fd3e6'); R(X + 4, Y, 1, T, '#cfeef7');
        break;
    }
    // ombre portée sous les murs
    if (kind && kind !== 'entry' && y > 0 && !walk[y - 1][x] && !floorOf[y - 1][x]) R(X, Y, T, 3, 'rgba(0,0,0,0.25)');
  }

  function drawWall(x, y) {
    const X = x * T, Y = y * T;
    const faceRow = y === 0 || y === 8 || y === 11;
    const vertical = (x === 0 || x === 10 || x === 20 || x === 30) && !faceRow;
    if (faceRow && !(x === 0 || x === 30)) {
      R(X, Y, T, T, '#5b4a75'); R(X, Y, T, 4, '#2b2238'); R(X, Y + 13, T, 3, '#3d3150');
      R(X, Y + 8, T, 1, '#64537f');
    } else {
      R(X, Y, T, T, '#2b2238');
      if (vertical) R(X + 7, Y, 2, T, '#3d3150'); else R(X, Y + 7, T, 2, '#3d3150');
    }
  }

  function drawSign(text, cx, y) {
    ctx.font = `400 8px ${FONT}`;
    const w = Math.ceil(ctx.measureText(text).width) + 8;
    const x = Math.round(cx - w / 2);
    R(x + 1, y + 1, w, 11, '#1a1424');
    R(x, y, w, 11, '#e8d9b5'); R(x, y + 10, w, 1, '#b9a57c');
    ctx.fillStyle = '#2a1d10'; ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 4, y + 5.5);
  }

  const BOOKS = ['#c0392b', '#2980b9', '#27ae60', '#f39c12', '#8e44ad', '#16a085', '#d35400', '#ecf0f1'];

  function drawFurniture(f, t) {
    const X = f.x * T, Y = f.y * T;
    switch (f.type) {
      case 'desk': {
        R(X + 1, Y + 14, 14, 2, 'rgba(0,0,0,0.3)');
        R(X + 1, Y + 5, 14, 8, '#b07d4f'); R(X + 1, Y + 5, 14, 1, '#c99566'); R(X + 1, Y + 12, 14, 3, '#7a5233');
        R(X + 3, Y - 5, 10, 9, '#22202a'); R(X + 7, Y + 4, 2, 2, '#22202a');
        const on = f.active;
        const scr = { code: '#1e2b3c', term: '#0f1f14', web: '#1d2f4a' }[f.screen];
        R(X + 4, Y - 4, 8, 7, on ? scr : '#141219');
        if (on) {
          const k = Math.floor(t / 300) + f.x;
          if (f.screen === 'code') for (let i = 0; i < 3; i++) R(X + 5 + (i % 2), Y - 3 + i * 2, 2 + ((k + i * 3) % 5), 1, ['#d97757', '#7fb5ff', '#6fd08c'][i]);
          if (f.screen === 'term') for (let i = 0; i < 3; i++) R(X + 5, Y - 3 + i * 2, 1 + ((k + i * 2) % 6), 1, '#6fd08c');
          if (f.screen === 'web') { R(X + 6, Y - 3, 4, 5, '#3d85c6'); R(X + 7, Y - 2, 2, 2, '#6fd08c'); R(X + 5 + (k % 6), Y + 1, 1, 1, '#fff'); }
        }
        R(X + 4, Y + 8, 8, 2, '#d8d8d8'); R(X + 12, Y + 8, 2, 2, '#e9e9e9');
        break;
      }
      case 'shelf': {
        R(X, Y - 3, T, 18, '#5a3b24'); R(X, Y - 3, T, 1, '#76502f');
        for (let s = 0; s < 2; s++) {
          const sy = Y - 1 + s * 7;
          R(X + 1, sy, 14, 6, '#3a2616');
          let bx = X + 1, i = 0;
          while (bx < X + 14) {
            const bw = 1 + ((hash(`${f.x}${s}${i}`) % 3) ? 2 : 1);
            const bh = 4 + (hash(`${f.x}${s}${i}h`) % 3);
            R(bx, sy + 6 - bh, Math.min(bw, X + 15 - bx), bh, BOOKS[hash(`${f.x}${s}${i}c`) % BOOKS.length]);
            bx += bw + (i % 4 === 3 ? 1 : 0); i++;
          }
          R(X, sy + 6, T, 1, '#76502f');
        }
        break;
      }
      case 'table': {
        const w = f.w * T;
        R(X + 1, Y + 14, w - 2, 2, 'rgba(0,0,0,0.3)');
        R(X + 1, Y + 4, w - 2, 9, '#9c6b43'); R(X + 1, Y + 4, w - 2, 1, '#b4825a'); R(X + 1, Y + 12, w - 2, 2, '#6d4a2c');
        R(X + 6, Y + 6, 7, 5, '#f4ecd8'); R(X + 9, Y + 6, 1, 5, '#d1c6ad'); R(X + w - 9, Y + 5, 3, 4, '#f1c40f'); R(X + w - 8, Y + 9, 1, 2, '#333');
        break;
      }
      case 'rack': {
        R(X + 1, Y - 3, 14, 34, '#1f2430'); R(X + 1, Y - 3, 14, 1, '#3a4152');
        for (let i = 0; i < 6; i++) {
          const ry = Y - 1 + i * 5;
          R(X + 2, ry, 12, 4, '#2c3342');
          const blink = (hash(`${f.x}-${i}`) + Math.floor(t / (180 + i * 37))) % 3;
          R(X + 3, ry + 1, 1, 1, blink ? '#6fd08c' : '#1d5a2e');
          R(X + 5, ry + 1, 1, 1, blink === 2 ? '#ffd166' : '#5a4a1a');
          R(X + 8, ry + 2, 5, 1, '#1a1e28');
        }
        break;
      }
      case 'meetingTable': {
        const w = f.w * T, h = f.h * T;
        R(X + 2, Y + h - 1, w - 4, 3, 'rgba(0,0,0,0.3)');
        R(X + 1, Y + 1, w - 2, h - 4, '#7a4e2e'); R(X + 2, Y + 2, w - 4, h - 6, '#8d5d38'); R(X + 1, Y + h - 4, w - 2, 3, '#5a3820');
        R(X + 10, Y + 8, 8, 6, '#f4ecd8'); R(X + 30, Y + 12, 6, 8, '#f4ecd8');
        R(X + 50, Y + 7, 12, 8, '#3a3f4b'); R(X + 51, Y + 8, 10, 5, f.active ? '#7fb5ff' : '#2a2f3a');
        R(X + 22, Y + 18, 3, 3, '#ffffff'); R(X + 23, Y + 17, 1, 1, '#d97757');
        break;
      }
      case 'counter': {
        const w = f.w * T;
        R(X, Y + 2, w, 13, '#8f8778'); R(X, Y + 2, w, 3, '#c9c2b5');
        R(X + 2, Y - 6, 10, 12, '#2d2d33'); R(X + 3, Y - 5, 8, 3, '#45454f'); R(X + 9, Y - 1, 1, 1, Math.floor(t / 500) % 2 ? '#ff6b6b' : '#7a2a2a');
        R(X + 5, Y + 2, 4, 3, '#f4f4f4');
        const st = Math.floor(t / 200) % 4;
        R(X + 6 + (st % 2), Y - 8 - st, 1, 1, 'rgba(255,255,255,0.6)');
        R(X + 20, Y - 1, 4, 3, '#f4f4f4'); R(X + 26, Y - 1, 4, 3, '#d97757'); R(X + 36, Y - 2, 6, 4, '#c0392b');
        break;
      }
      case 'vending': {
        R(X + 1, Y - 10, 14, 25, f.variant ? '#2c6e9b' : '#b8352a'); R(X + 1, Y - 10, 14, 1, '#fff3');
        R(X + 3, Y - 8, 8, 15, '#9fd3e6');
        for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) R(X + 4 + j * 4, Y - 7 + i * 4, 2, 2, BOOKS[(i * 2 + j + f.x) % BOOKS.length]);
        R(X + 12, Y - 6, 2, 3, '#222'); R(X + 3, Y + 9, 8, 3, '#1a1a1a');
        break;
      }
      case 'sofa': {
        const w = f.w * T;
        R(X - 3, Y + 6, w + 6, 10, '#5e3a80'); R(X - 2, Y + 7, w + 4, 8, '#7b4fa0'); R(X - 2, Y + 7, w + 4, 1, '#9a6fc0');
        for (let i = 1; i < f.w; i++) R(X + i * T, Y + 8, 1, 7, '#5e3a80');
        R(X - 3, Y + 16, 3, 10, '#5e3a80'); R(X + w, Y + 16, 3, 10, '#5e3a80');
        break;
      }
      case 'coffeeTable': {
        const w = f.w * T;
        R(X + 3, Y + 3, w - 6, 8, '#6b4a2f'); R(X + 3, Y + 3, w - 6, 1, '#86603f'); R(X + 4, Y + 11, 2, 3, '#4a321f'); R(X + w - 6, Y + 11, 2, 3, '#4a321f');
        R(X + 10, Y + 4, 3, 3, '#f4f4f4'); R(X + 18, Y + 5, 6, 4, '#e9c46a');
        break;
      }
      case 'plant': {
        R(X + 5, Y + 9, 6, 6, '#9c5b3a'); R(X + 5, Y + 9, 6, 1, '#b56f4a');
        R(X + 4, Y + 2, 8, 7, '#3f8f4f'); R(X + 6, Y - 1, 4, 4, '#5fb06a'); R(X + 3, Y + 4, 2, 3, '#5fb06a'); R(X + 11, Y + 3, 2, 3, '#2f7040');
        break;
      }
    }
  }

  function drawChairUnder(s) {
    const X = s.x * T, Y = s.y * T;
    if (s.facing === 'up') { R(X + 3, Y + 5, 10, 6, '#3b3f58'); }
    else if (s.sofa) { R(X, Y, 16, 10, '#8e5fb5'); R(X, Y + 9, 16, 1, '#5e3a80'); R(X + 15, Y + 1, 1, 8, '#7b4fa0'); }
    else { R(X + 3, Y - 2, 10, 7, '#2c2f42'); R(X + 3, Y + 4, 10, 4, '#3b3f58'); }
  }
  function drawChairOver(s) {
    const X = s.x * T, Y = s.y * T;
    if (s.facing === 'up') { R(X + 3, Y + 11, 10, 4, '#2c2f42'); R(X + 3, Y + 11, 10, 1, '#4a4f6a'); R(X + 5, Y + 15, 6, 1, '#15151c'); }
  }
  for (const s of seats) if (s.zone === 'cafe' && s.facing === 'down') s.sofa = true;

  function drawWallDecor(t) {
    for (const [z, r] of Object.entries(ROOMS)) drawSign(r.label, (r.x0 + r.x1 + 1) * T / 2, (r.y0 === 1 ? 0 : 11) * T + 2);
    // tableau blanc de la salle de réunion
    let X = 17 * T, Y = 11 * T + 2;
    R(X, Y, 30, 12, '#9a9aa5'); R(X + 1, Y + 1, 28, 9, '#f4f4f4');
    R(X + 3, Y + 3, 10, 1, '#3d85c6'); R(X + 3, Y + 5, 7, 1, '#3d85c6'); R(X + 16, Y + 3, 8, 5, '#d97757'); R(X + 17, Y + 4, 6, 3, '#f4f4f4');
    // horloge murale
    X = 8 * T + 4; Y = 2;
    R(X, Y, 10, 10, '#f4ecd8'); R(X, Y, 10, 1, '#5a3b24'); R(X, Y + 9, 10, 1, '#5a3b24'); R(X, Y, 1, 10, '#5a3b24'); R(X + 9, Y, 1, 10, '#5a3b24');
    const d = new Date(); const a = (d.getMinutes() / 60) * Math.PI * 2;
    R(X + 4, Y + 2, 1, 3, '#222'); R(X + 4 + Math.round(Math.sin(a) * 3), Y + 4 - Math.round(Math.cos(a) * 3), 1, 1, '#c0392b');
    // tableau / affiche
    X = 1 * T + 6; Y = 12 * T - 13;
    R(X, Y, 14, 10, '#22202a'); R(X + 1, Y + 1, 12, 8, '#3d85c6'); R(X + 3, Y + 3, 6, 4, '#6fd08c');
  }

  // ---------- Personnages ----------
  function drawChar(a, t) {
    const px = Math.round(a.x * T + 8);
    const feet = Math.round(a.y * T + 15);
    const sitting = a.arrived && a.spot?.sit;
    const facing = a.arrived ? a.spot?.facing || 'down' : a.dir;
    const moving = !a.arrived;
    const step = moving ? Math.floor(t / 140) % 2 : 0;
    let top = feet - 16 - (moving && step ? 1 : 0);
    if (sitting) top = facing === 'up' ? a.y * T - 2 : a.y * T + 1;
    const ox = px - 5;
    const P = (x, y, w, h, c) => R(ox + x, top + y, w, h, c);
    const { shirt, hair, skin } = a.look;

    if (!sitting) R(px - 4, feet - 1, 8, 2, 'rgba(0,0,0,0.3)');
    if (facing === 'up') {
      P(3, 0, 4, 1, hair); P(2, 1, 6, 4, hair); P(1, 2, 1, 2, skin); P(8, 2, 1, 2, skin);
    } else {
      P(3, 0, 4, 1, hair); P(2, 1, 6, 1, hair); P(2, 2, 6, 3, skin); P(2, 2, 1, 2, hair); P(7, 2, 1, 2, hair);
      P(3, 3, 1, 1, '#222'); P(6, 3, 1, 1, '#222');
      if (a.data.state === 'waiting' || a.data.state === 'idle') P(4, 4, 2, 1, '#b0705a');
    }
    if (a.data.isSub) { P(2, -1, 6, 2, '#d97757'); P(facing === 'up' ? 2 : 6, 0, 3, 1, '#b55d40'); }
    P(4, 5, 2, 1, skin);
    P(2, 6, 6, 1, shirt); P(1, 7, 8, 5, shirt); P(1, 7, 8, 1, 'rgba(255,255,255,0.15)');
    const typing = sitting && a.data.state === 'working' && facing === 'up';
    const handY = typing ? 9 + (Math.floor(t / 120) % 2) : 10;
    P(0, 7, 1, 3, shirt); P(9, 7, 1, 3, shirt);
    P(0, handY, 1, 1, skin); P(9, typing ? 19 - handY : handY, 1, 1, skin);
    if (!sitting) {
      const pants = '#2f3245';
      P(2, 12, 3, 3 - (step ? 1 : 0), pants); P(5, 12, 3, 3 - (step ? 0 : 1), pants);
      P(2, 15 - (step ? 1 : 0), 3, 1, '#151318'); P(5, 15 - (step ? 0 : 1), 3, 1, '#151318');
    } else if (facing === 'down') {
      P(2, 12, 6, 2, '#2f3245');
    }
    a.hit = { x: ox - 1, y: top - 2, w: 12, h: 20 };
    a.headTop = top;
    a.px = px;
  }

  function drawBubble(a, t) {
    const s = a.data.state;
    const x = a.px - 5, y = a.headTop - 12;
    const bg = s === 'waiting' ? '#ffd166' : s === 'blocked' ? '#ff6b6b' : '#f4f4f4';
    R(x, y, 11, 9, '#1a1424'); R(x + 1, y + 1, 9, 7, bg); R(x + 4, y + 9, 3, 1, '#1a1424'); R(x + 5, y + 10, 1, 1, '#1a1424');
    const k = Math.floor(t / 160);
    if (s === 'working') for (let i = 0; i < 3; i++) { const hgt = 1 + ((k + i) % 4); R(x + 2 + i * 3, y + 7 - hgt, 2, hgt, '#2e9c58'); }
    else if (s === 'thinking') for (let i = 0; i < 3; i++) R(x + 2 + i * 3, y + 4 - ((k % 3) === i ? 1 : 0), 1, 1, '#3d6fd0');
    else if (s === 'waiting') { R(x + 5, y + 2, 1, 3, '#1a1424'); R(x + 5, y + 6, 1, 1, '#1a1424'); }
    else if (s === 'blocked') { R(x + 4, y + 2, 3, 1, '#1a1424'); R(x + 6, y + 3, 1, 1, '#1a1424'); R(x + 5, y + 4, 1, 1, '#1a1424'); R(x + 5, y + 6, 1, 1, '#1a1424'); }
    else { R(x + 3, y + 2, 4, 1, '#666'); R(x + 5, y + 3, 1, 1, '#666'); R(x + 4, y + 4, 1, 1, '#666'); R(x + 3, y + 5, 4, 1, '#666');
      const zf = (t / 900) % 1; ctx.globalAlpha = 1 - zf; R(x + 11 + zf * 4, y - zf * 8, 2, 2, '#c8c0d8'); ctx.globalAlpha = 1; }
  }

  function drawTag(a, strong, placed) {
    ctx.font = `400 8px ${FONT}`;
    const name = a.data.name.length > 12 ? a.data.name.slice(0, 11) + '…' : a.data.name;
    const w = Math.ceil(ctx.measureText(name).width) + 4;
    const x = Math.round(a.px - w / 2), y = a.headTop - 24;
    if (placed) {
      if (placed.some(r => x < r.x + r.w && r.x < x + w && y < r.y + 10 && r.y < y + 10)) return;
      placed.push({ x, y, w });
    }
    R(x, y, w, 10, strong ? '#d97757' : 'rgba(14,11,20,0.92)');
    ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(name, x + 2, y + 5);
  }

  // ---------- Simulation ----------
  const sims = new Map();
  let selected = null, hovered = null;

  function lookFor(d, all) {
    const parent = d.isSub && all.find(p => p.id === d.parentId);
    return {
      shirt: SHIRTS[hash(parent ? parent.project : d.project) % SHIRTS.length],
      hair: HAIRS[hash(d.id + 'h') % HAIRS.length],
      skin: SKINS[hash(d.id + 's') % SKINS.length],
    };
  }

  function claimSpot(a) {
    const zone = a.data.zone in ROOMS ? a.data.zone : 'cafe';
    if (a.spot && a.spot.zone === zone) return;
    if (a.spot) a.spot.taken = null;
    const pool = seats.filter(s => s.zone === zone && !s.taken);
    const free = pool.length ? pool : standSpots[zone].filter(s => !s.taken);
    const spot = free.length ? free[hash(a.id) % free.length] : standSpots[zone][hash(a.id) % standSpots[zone].length];
    spot.taken = a.id;
    a.spot = spot;
    goTo(a, spot.x, spot.y);
  }

  function goTo(a, tx, ty) {
    const sx = Math.round(a.x), sy = Math.round(a.y);
    a.path = findPath(sx, sy, tx, ty);
    a.arrived = a.path.length === 0;
  }

  let lastQuota = null;
  function sync(list, quota) {
    lastQuota = quota;
    renderQuota(quota);
    const ids = new Set(list.map(d => d.id));
    for (const d of list) {
      let a = sims.get(d.id);
      if (!a) {
        a = { id: d.id, x: ENTRY.x, y: ENTRY.y, path: [], arrived: true, dir: 'down', spot: null };
        sims.set(d.id, a);
      }
      a.data = d;
      a.look = lookFor(d, list);
      a.leaving = false;
      claimSpot(a);
    }
    for (const a of sims.values()) {
      if (ids.has(a.id) || a.leaving) continue;
      a.leaving = true;
      if (a.spot) { a.spot.taken = null; a.spot = null; }
      goTo(a, ENTRY.x, ENTRY.y);
    }
    renderRoster(list);
    renderStats(list);
    renderWings();
    renderDetail();
  }

  function update(dt) {
    const speed = 4.5; // tuiles / s
    for (const a of sims.values()) {
      if (!a.path.length) {
        a.arrived = true;
        if (a.leaving) { sims.delete(a.id); if (selected === a.id) selected = null; }
        continue;
      }
      a.arrived = false;
      const n = a.path[0];
      const dx = n.x - a.x, dy = n.y - a.y, dist = Math.hypot(dx, dy);
      const stepLen = speed * dt;
      if (Math.abs(dy) > Math.abs(dx)) a.dir = dy < 0 ? 'up' : 'down'; else if (dx) a.dir = 'down';
      if (dist <= stepLen) { a.x = n.x; a.y = n.y; a.path.shift(); }
      else { a.x += (dx / dist) * stepLen; a.y += (dy / dist) * stepLen; }
    }
  }

  // ---------- Rendu ----------
  function frame(t) {
    ctx.setTransform(S, 0, 0, S, 0, 0);
    ctx.imageSmoothingEnabled = false;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (floorOf[y][x]) drawFloor(x, y, floorOf[y][x], t); else drawWall(x, y);
    }
    drawWallDecor(t);

    for (const f of furniture) f.active = false;
    for (const a of sims.values()) {
      if (!a.arrived || !a.spot) continue;
      if (a.spot.desk && (a.data.state === 'working' || a.data.state === 'thinking')) a.spot.desk.active = true;
      if (a.spot.zone === 'meeting' && a.data.state !== 'idle') furniture.find(f => f.type === 'meetingTable').active = true;
    }

    const items = [];
    for (const f of furniture) items.push({ k: (f.y + f.h) * T - 1, d: () => drawFurniture(f, t) });
    for (const s of seats) if (s.sit) {
      items.push({ k: s.y * T + 2, d: () => drawChairUnder(s) });
      items.push({ k: s.y * T + 16.5, d: () => drawChairOver(s) });
    }
    const agents = [...sims.values()];
    for (const a of agents) {
      const sitUp = a.arrived && a.spot?.sit && a.spot.facing === 'up';
      items.push({ k: a.y * T + (sitUp ? 16 : 15), d: () => drawChar(a, t) });
    }
    items.sort((p, q) => p.k - q.k).forEach(i => i.d());

    for (const a of agents) if (a.hit) drawBubble(a, t);
    const placed = [];
    for (const a of agents.sort((p, q) => q.data.lastAt - p.data.lastAt)) if (a.hit && a.id !== selected && a.id !== hovered) drawTag(a, false, placed);
    for (const id of [hovered, selected]) { const a = sims.get(id); if (a?.hit) drawTag(a, id === selected); }

    if (!sims.size) {
      ctx.font = `500 8px ${FONT}`; ctx.textBaseline = 'top';
      const msg = 'Bureau vide : aucun agent actif. Essaie /?demo';
      const w = ctx.measureText(msg).width + 10;
      R(W * T / 2 - w / 2, 9 * T + 4, w, 14, 'rgba(20,16,28,0.85)');
      ctx.fillStyle = '#efe6d8'; ctx.fillText(msg, W * T / 2 - w / 2 + 5, 9 * T + 6);
    }
  }

  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    update(dt);
    frame(now);
    requestAnimationFrame(loop);
  }

  // ---------- Panneau ----------
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ago = ts => {
    if (!ts) return '?';
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return `${s}s`; if (s < 3600) return `${Math.floor(s / 60)} min`; return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)}`;
  };
  const hhmm = ts => new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  let lastList = [];
  function renderStats(list) {
    lastList = list;
    const c = { working: 0, thinking: 0, waiting: 0, blocked: 0, idle: 0 };
    list.forEach(a => c[a.state]++);
    const subs = list.filter(a => a.isSub).length;
    $('stats').innerHTML =
      `<span class="stat"><b>${list.length}</b> agent${list.length > 1 ? 's' : ''}${subs ? ` dont <b>${subs}</b> sous-agent${subs > 1 ? 's' : ''}` : ''}</span>` +
      Object.entries(c).filter(([, n]) => n).map(([s, n]) => `<span class="stat"><i class="dot s-${s}"></i><b>${n}</b> ${STATE_LABEL[s]}</span>`).join('');
  }

  const kTok = n => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1000)}k`;
  const level = pct => pct >= 85 ? 'hi' : pct >= 60 ? 'mid' : 'lo';
  const ctxBar = c => c ? `<div class="ctx ${level(c.pct)}" title="contexte : ${kTok(c.tokens)} / ${kTok(c.size)}${c.exact ? '' : ' (taille estimée)'}"><span class="bar"><i style="width:${Math.min(100, c.pct)}%"></i></span><span>${c.pct}%</span></div>` : '';

  function renderQuota(q) {
    const box = $('quota');
    if (!q) { box.innerHTML = '<span class="stat" title="Voir README : brancher la statusline">quota : non branché</span>'; return; }
    const until = ts => {
      if (!ts) return '';
      const m = Math.max(0, Math.round((ts - Date.now()) / 60000));
      return m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${Math.floor(m / 1440)} j ${Math.floor((m % 1440) / 60)} h`;
    };
    box.innerHTML = [['5 h', q.fiveHour], ['7 j', q.sevenDay]].filter(([, w]) => w).map(([l, w]) =>
      `<div class="gauge ${level(w.pct)}" title="quota ${l}${w.resetsAt ? ` · remise à zéro ${new Date(w.resetsAt).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}">
        <span class="gl">${l}</span><span class="bar"><i style="width:${Math.min(100, w.pct)}%"></i></span><b>${w.pct}%</b>${w.resetsAt ? `<span class="gr">↻ ${until(w.resetsAt)}</span>` : ''}</div>`).join('');
  }

  function renderRoster(list) {
    const parents = list.filter(a => !a.isSub || !list.some(p => p.id === a.parentId));
    const ordered = [];
    for (const p of parents) { ordered.push(p); ordered.push(...list.filter(s => s.isSub && s.parentId === p.id)); }
    $('roster').innerHTML = ordered.length ? ordered.map(a => `
      <li data-id="${esc(a.id)}" class="${a.id === selected ? 'sel' : ''} ${a.isSub && list.some(p => p.id === a.parentId) ? 'sub' : ''}">
        <div class="row"><span class="swatch" style="background:${lookFor(a, list).shirt}"></span><span class="name">${esc(a.name)}${a.isSub ? ' ⤷' : ''}</span><i class="dot s-${a.state}" title="${STATE_LABEL[a.state]}"></i></div>
        ${a.title ? `<div class="act title">${esc(a.title)}</div>` : ''}
        <div class="act">${esc(ROOMS[a.zone]?.label.toLowerCase() || '')} · ${esc(a.activity)}</div>
        ${ctxBar(a.context)}
      </li>`).join('') : '<li class="empty">Personne au bureau pour l\'instant.</li>';
  }

  // chiffres en Press Start 2P : Pixelify Sans confond 5/8 et 2/8
  const num = v => String(v).replace(/\d+/g, d => `<span class="num">${d}</span>`);

  // « Ouvrir la fenêtre » : uniquement depuis le navigateur du Mac (le serveur refuse le reste)
  const onMac = ['127.0.0.1', 'localhost'].includes(location.hostname);
  let focusMsg = null;
  function focusButton(a) {
    if (!onMac || mobile.matches || !a.live?.how) return '';
    const where = a.live.how === 'tab' ? `l'onglet ${esc(a.live.app)}` : esc(a.live.app);
    const msg = focusMsg && focusMsg.id === a.id && Date.now() < focusMsg.until ? `<span class="focus-msg">${esc(focusMsg.text)}</span>` : '';
    return `<div class="focus-row"><button class="focus" data-id="${esc(a.id)}">Ouvrir ${where}</button>${msg}</div>`;
  }
  async function openWindow(id) {
    let text;
    try {
      const r = await fetch('/api/focus', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      const j = await r.json();
      text = j.ok ? (j.how === 'tab' ? 'onglet au premier plan' : `${j.app} au premier plan`) : (j.error || 'impossible d\'ouvrir la fenêtre');
    } catch { text = 'serveur injoignable'; }
    focusMsg = { id, text, until: Date.now() + 4000 };
    renderDetail();
  }

  function renderDetail() {
    const box = $('detail');
    const a = lastList.find(x => x.id === selected);
    $('backdrop').classList.toggle('show', !!a);
    if (!a) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    const done = a.todos ? a.todos.filter(t => t.status === 'completed').length : 0;
    box.innerHTML = `
      <button class="close" aria-label="Fermer">✕</button>
      <h3>${esc(a.name)}</h3>
      <div class="meta">${esc(a.title || 'sans titre')}</div>
      <div class="meta">${a.isSub && a.parentName ? `sous-agent de ${esc(a.parentName)} · ` : ''}${esc(a.project)}${a.branch ? ` · ${esc(a.branch)}` : ''}</div>
      ${focusButton(a)}
      <h4>EN CE MOMENT</h4>
      <div class="row"><i class="dot s-${a.state}"></i> ${STATE_LABEL[a.state]} · ${esc(ROOMS[a.zone]?.label || '')}</div>
      <div class="meta">${esc(a.activity)}${a.tool ? ` (${esc(a.tool)})` : ''}</div>
      <div class="meta">dernière action il y a ${num(ago(a.lastAt))}${a.startedAt ? ` · arrivé à ${num(hhmm(a.startedAt))}` : ''}</div>
      <div class="meta">${num(a.toolCount)} outil${a.toolCount > 1 ? 's' : ''} utilisé${a.toolCount > 1 ? 's' : ''}${a.model ? ` · ${num(esc(a.model))}` : ''}</div>
      ${a.context ? `<h4>CONTEXTE</h4>${ctxBar(a.context)}<div class="meta"><span class="num">${kTok(a.context.tokens)} / ${kTok(a.context.size)}</span> tokens${a.context.exact ? '' : ' (taille de fenêtre estimée)'}${a.context.pct >= 85 ? ' · compaction proche' : ''}</div>` : ''}
      ${a.todos ? `<h4>TODO ${done}/${a.todos.length}</h4><div class="bar"><i style="width:${(done / a.todos.length) * 100}%"></i></div>
        <ul class="todo">${a.todos.map(t => `<li class="${t.status}">${esc(t.text)}</li>`).join('')}</ul>` : ''}
      ${a.log?.length ? `<h4>JOURNAL</h4><ul class="log">${a.log.map(l => `<li><span class="t">${l.ts ? hhmm(l.ts) : ''}</span><span class="k">${esc(l.tool)}</span><span class="l">${esc(l.label)}</span></li>`).join('')}</ul>` : ''}`;
  }

  function select(id) {
    selected = selected === id ? null : id;
    renderRoster(lastList); renderDetail();
    const a = sims.get(selected);
    if (a && mobile.matches) goWing(a.x < 10 ? 0 : a.x < 20 ? 1 : 2);
  }
  $('detail').addEventListener('click', e => {
    if (e.target.closest('.close')) select(selected);
    const f = e.target.closest('.focus');
    if (f) openWindow(f.dataset.id);
  });
  $('backdrop').addEventListener('click', () => select(selected));

  // ---------- Mobile : ailes du bureau ----------
  const mobile = matchMedia('(max-width: 720px)');
  const WINGS = [['Code · Web', ['code', 'web']], ['Biblio · Réunion', ['library', 'meeting']], ['Serveurs · Café', ['servers', 'cafe']]];
  const floor = $('floor');
  const wingWidth = () => $('floor-inner').offsetWidth * 10 / 31;
  const goWing = i => floor.scrollTo({ left: i * wingWidth(), behavior: 'smooth' });
  function renderWings() {
    const cur = Math.round(floor.scrollLeft / (wingWidth() || 1));
    $('wings').innerHTML = WINGS.map(([label, zones], i) => {
      const n = lastList.filter(a => zones.includes(a.zone)).length;
      const alert = lastList.some(a => zones.includes(a.zone) && (a.state === 'waiting' || a.state === 'blocked'));
      return `<button data-w="${i}" class="${i === cur ? 'on' : ''}">${label}<span class="n${alert ? ' alert' : ''}">${n}</span></button>`;
    }).join('');
  }
  $('wings').addEventListener('click', e => { const b = e.target.closest('button[data-w]'); if (b) goWing(+b.dataset.w); });
  floor.addEventListener('scroll', () => requestAnimationFrame(renderWings), { passive: true });
  $('roster').addEventListener('click', e => { const li = e.target.closest('li[data-id]'); if (li) select(li.dataset.id); });

  const toLogical = e => {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * W * T / r.width, y: (e.clientY - r.top) * H * T / r.height };
  };
  const pick = p => {
    let best = null;
    for (const a of sims.values()) if (a.hit && p.x >= a.hit.x && p.x <= a.hit.x + a.hit.w && p.y >= a.hit.y && p.y <= a.hit.y + a.hit.h) best = a;
    return best;
  };
  canvas.addEventListener('mousemove', e => { const a = pick(toLogical(e)); hovered = a?.id || null; canvas.title = a ? `${a.data.name} : ${a.data.activity}` : ''; });
  canvas.addEventListener('mouseleave', () => { hovered = null; });
  canvas.addEventListener('click', e => { const a = pick(toLogical(e)); if (a) select(a.id); });

  $('legend').innerHTML = Object.entries(STATE_LABEL).map(([s, l]) => `<span><i class="dot s-${s}"></i>${l}</span>`).join('') +
    `<span class="zones">· pièce = type de tâche (${Object.entries(ZONE_INFO).map(([z, i]) => `${ROOMS[z].label.toLowerCase()} : ${i}`).join(', ')})</span>`;

  setInterval(() => { $('clock').textContent = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); renderDetail(); renderQuota(lastQuota); }, 1000);

  // ---------- Données ----------
  if (new URLSearchParams(location.search).has('demo')) startDemo();
  else {
    const es = new EventSource('/events');
    es.onmessage = e => { const d = JSON.parse(e.data); sync(d.agents, d.quota); };
  }

  function startDemo() {
    const ACTS = {
      code: [['Edit', 'page.tsx'], ['Write', 'route.ts'], ['Edit', 'schema.sql'], ['MultiEdit', 'Button.tsx']],
      library: [['Read', 'README.md'], ['Grep', '« useSession »'], ['Glob', '« **/*.test.ts »'], ['Skill', 'supabase']],
      servers: [['Bash', 'Lance le build'], ['Bash', 'Exécute les tests'], ['Bash', 'Statut git']],
      web: [['WebSearch', 'Stripe webhooks idempotence'], ['WebFetch', 'supabase.com'], ['mcp', 'Notion · search']],
      meeting: [['Agent', 'Audit sécurité RLS'], ['TodoWrite', 'met à jour sa todo']],
    };
    const base = [
      { id: 'd1', name: 'kardd', project: 'kardd', title: 'Paiement Stripe des cartes' },
      { id: 'd2', name: 'followmyscore', project: 'followmyscore', title: 'Réduction de l\'egress Supabase' },
      { id: 'd3', name: 'koddeur-website', project: 'koddeur-website', title: 'Nouvel article de blog' },
      { id: 'd4', name: 'claude-company', project: 'claude-company', title: 'Bureau pixel des agents' },
      { id: 'd5', name: 'werewolf-assistant', project: 'werewolf-assistant', title: 'Refonte du lobby' },
      { id: 'd6', name: 'security-reviewer', project: 'kardd', title: 'Audit sécurité RLS', isSub: true, parentId: 'd1', parentName: 'kardd' },
      { id: 'd7', name: 'Explore', project: 'kardd', title: 'Recherche des usages', isSub: true, parentId: 'd1', parentName: 'kardd' },
    ];
    const start = Date.now() - 40 * 60_000;
    const agents = base.map(b => ({ ...b, branch: 'main', model: 'claude-opus-5-5', startedAt: start, lastAt: Date.now(), toolCount: 0, log: [], todos: null, isSub: !!b.isSub, parentId: b.parentId || null }));
    agents[0].todos = [
      { text: 'Créer la table orders', status: 'completed' }, { text: 'Brancher le checkout Stripe', status: 'completed' },
      { text: 'Gérer le webhook payment_intent', status: 'in_progress' }, { text: 'Tests e2e paiement', status: 'pending' },
    ];
    const roll = a => {
      const r = Math.random();
      if (r < 0.1 && !a.isSub) { a.state = Math.random() < 0.6 ? 'waiting' : 'idle'; a.zone = 'cafe'; a.activity = a.state === 'idle' ? 'en pause' : 'attend ta réponse'; a.tool = null; return; }
      if (r < 0.15) { a.state = 'blocked'; a.activity = 'bloqué ? permission Bash'; a.zone = 'servers'; a.tool = 'Bash'; return; }
      if (r < 0.3) { a.state = 'thinking'; a.activity = 'réfléchit…'; a.tool = null; return; }
      const zones = a.isSub ? ['library', 'code', 'servers', 'web'] : Object.keys(ACTS);
      a.zone = zones[Math.floor(Math.random() * zones.length)];
      const [tool, label] = ACTS[a.zone][Math.floor(Math.random() * ACTS[a.zone].length)];
      a.state = 'working'; a.tool = tool; a.activity = label; a.toolCount++; a.lastAt = Date.now();
      a.log.unshift({ ts: Date.now(), tool, label }); a.log = a.log.slice(0, 8);
    };
    agents.forEach(roll);
    agents[0].zone = 'meeting'; agents[0].state = 'working'; agents[0].activity = 'Audit sécurité RLS'; agents[0].tool = 'Agent';
    const quota = { fiveHour: { pct: 42, resetsAt: Date.now() + 2.3 * 3600_000 }, sevenDay: { pct: 67, resetsAt: Date.now() + 3.4 * 86400_000 } };
    agents.forEach((a, i) => { a.context = { tokens: [148, 62, 171, 35, 96, 24, 51][i] * 1000, size: 200_000, exact: true }; a.context.pct = Math.round(a.context.tokens / 2000); });
    sync(agents.map(a => ({ ...a })), quota);
    setInterval(() => {
      const n = 1 + Math.floor(Math.random() * 2);
      for (let i = 0; i < n; i++) roll(agents[1 + Math.floor(Math.random() * (agents.length - 1))]);
      quota.fiveHour.pct = Math.min(100, quota.fiveHour.pct + (Math.random() < 0.3 ? 1 : 0));
      for (const a of agents) if (a.state === 'working') { a.context.tokens = Math.min(a.context.size, a.context.tokens + 1500 + Math.floor(Math.random() * 4000)); a.context.pct = Math.round(a.context.tokens / 2000); }
      sync(agents.map(a => ({ ...a })), quota);
    }, 3500);
  }

  requestAnimationFrame(loop);
})();
