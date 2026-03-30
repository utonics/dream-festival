/**
 * 꿈-드림 페스티벌 미래기술존 — 실시간 동기화 서버
 *
 * 기능:
 *  - REST API: 참가자, 체크인, 리더보드, 통계 CRUD
 *  - WebSocket: 실시간 브로드캐스트 (체크인, 리더보드 갱신)
 *  - 정적 파일 서빙: output/ 디렉토리
 *  - JSON 파일 기반 영속 저장 (data/ 디렉토리)
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const crypto = require('crypto');

// ── 설정 ──────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const OUTPUT_DIR = path.join(__dirname, '..', 'output');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'dreamfest2026';

// 데이터 디렉토리 생성
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ── 관리자 인증 ──────────────────────────────────
var adminTokens = new Map(); // token -> { createdAt, ip }

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function requireAdmin(req, res, next) {
  var authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '관리자 인증이 필요합니다' });
  }
  var token = authHeader.slice(7);
  if (!adminTokens.has(token)) {
    return res.status(403).json({ error: '유효하지 않은 인증 토큰입니다' });
  }
  // 24시간 만료 검사
  var session = adminTokens.get(token);
  if (Date.now() - session.createdAt > 24 * 60 * 60 * 1000) {
    adminTokens.delete(token);
    return res.status(403).json({ error: '토큰이 만료되었습니다. 다시 로그인하세요.' });
  }
  req.adminToken = token;
  next();
}

// ── 데이터 저장소 ─────────────────────────────────
class DataStore {
  constructor(filename) {
    this.filepath = path.join(DATA_DIR, filename);
    this.data = this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.filepath)) {
        return JSON.parse(fs.readFileSync(this.filepath, 'utf8'));
      }
    } catch (e) {
      console.error('[DataStore] Load error:', this.filepath, e.message);
    }
    return null;
  }

  save() {
    try {
      fs.writeFileSync(this.filepath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (e) {
      console.error('[DataStore] Save error:', this.filepath, e.message);
    }
  }

  get() { return this.data; }

  set(data) {
    this.data = data;
    this.save();
  }
}

// 저장소 초기화
const stores = {
  participants: new DataStore('participants.json'),
  checkins: new DataStore('checkins.json'),
  stamps: new DataStore('stamps.json'),
  results: new DataStore('results.json'),
  leaderboard: new DataStore('leaderboard.json'),
  boothStatus: new DataStore('booth-status.json'),
  mentoring: new DataStore('mentoring.json')
};

// 기본값 설정
if (!stores.participants.get()) stores.participants.set({});
if (!stores.checkins.get()) stores.checkins.set([]);
if (!stores.stamps.get()) stores.stamps.set({});
if (!stores.results.get()) stores.results.set({});
if (!stores.leaderboard.get()) stores.leaderboard.set({ dance: [], classify: [], prompt: [] });
if (!stores.boothStatus.get()) stores.boothStatus.set({});
if (!stores.mentoring.get()) stores.mentoring.set({ slots: {}, reservations: [] });

// ── Express 앱 ────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// 정적 파일 서빙 (output 디렉토리)
app.use(express.static(OUTPUT_DIR));

// API 라우터
const api = express.Router();

// ── 인증 API ──────────────────────────────────────

// 관리자 로그인
api.post('/auth/login', function(req, res) {
  var password = req.body.password;
  if (!password) {
    return res.status(400).json({ error: '비밀번호를 입력하세요' });
  }
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: '비밀번호가 올바르지 않습니다' });
  }
  var token = generateToken();
  var ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  adminTokens.set(token, { createdAt: Date.now(), ip: ip });
  console.log('[Auth] Admin login from', ip, '| Active sessions:', adminTokens.size);
  res.json({ token: token, expiresIn: '24h' });
});

// 관리자 로그아웃
api.post('/auth/logout', requireAdmin, function(req, res) {
  adminTokens.delete(req.adminToken);
  res.json({ status: 'ok' });
});

// 인증 상태 확인
api.get('/auth/check', function(req, res) {
  var authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.json({ authenticated: false });
  }
  var token = authHeader.slice(7);
  if (!adminTokens.has(token)) {
    return res.json({ authenticated: false });
  }
  var session = adminTokens.get(token);
  if (Date.now() - session.createdAt > 24 * 60 * 60 * 1000) {
    adminTokens.delete(token);
    return res.json({ authenticated: false, reason: 'expired' });
  }
  res.json({ authenticated: true, sessionAge: Date.now() - session.createdAt });
});

// ── 참가자 API ────────────────────────────────────

// 참가자 등록
api.post('/participants', function(req, res) {
  var body = req.body;
  if (!body.id || !body.nick) {
    return res.status(400).json({ error: '참가자 ID와 닉네임이 필요합니다' });
  }

  var participants = stores.participants.get();
  if (participants[body.id]) {
    return res.status(409).json({ error: '이미 등록된 참가자입니다', participant: participants[body.id] });
  }

  var participant = {
    id: body.id,
    nick: body.nick,
    avatar: body.avatar || null,
    school: body.school || null,
    registeredAt: new Date().toISOString()
  };

  participants[body.id] = participant;
  stores.participants.set(participants);

  broadcast({ type: 'participant:new', data: participant });
  res.status(201).json(participant);
});

// 참가자 조회
api.get('/participants/:id', function(req, res) {
  var participants = stores.participants.get();
  var p = participants[req.params.id];
  if (!p) return res.status(404).json({ error: '참가자를 찾을 수 없습니다' });
  res.json(p);
});

// 참가자 목록
api.get('/participants', function(req, res) {
  var participants = stores.participants.get();
  var list = Object.values(participants);
  if (req.query.search) {
    var q = req.query.search.toLowerCase();
    list = list.filter(function(p) {
      return p.id.toLowerCase().includes(q) || p.nick.toLowerCase().includes(q);
    });
  }
  res.json({ count: list.length, participants: list });
});

// ── 체크인 API ────────────────────────────────────

// 체크인 기록
api.post('/checkins', function(req, res) {
  var body = req.body;
  if (!body.participantId || !body.progId) {
    return res.status(400).json({ error: '참가자 ID와 프로그램 ID가 필요합니다' });
  }

  var checkins = stores.checkins.get();

  // 중복 체크 (같은 참가자, 같은 프로그램, 10분 이내)
  var now = Date.now();
  var duplicate = checkins.some(function(c) {
    return c.participantId === body.participantId &&
           c.progId === body.progId &&
           (now - new Date(c.time).getTime()) < 600000;
  });

  if (duplicate) {
    return res.status(409).json({ error: '최근 10분 이내 동일 체크인이 있습니다' });
  }

  var checkin = {
    id: 'CK-' + Date.now().toString(36).toUpperCase(),
    participantId: body.participantId,
    participantName: body.participantName || null,
    progId: Number(body.progId),
    type: body.type || '체크인',
    time: new Date().toISOString(),
    boothName: body.boothName || null
  };

  checkins.push(checkin);
  stores.checkins.set(checkins);

  broadcast({ type: 'checkin:new', data: checkin });
  res.status(201).json(checkin);
});

// 체크인 목록
api.get('/checkins', function(req, res) {
  var checkins = stores.checkins.get();
  var filtered = checkins;

  if (req.query.participantId) {
    filtered = filtered.filter(function(c) { return c.participantId === req.query.participantId; });
  }
  if (req.query.progId) {
    var pid = Number(req.query.progId);
    filtered = filtered.filter(function(c) { return c.progId === pid; });
  }
  if (req.query.today === 'true') {
    var todayStr = new Date().toISOString().slice(0, 10);
    filtered = filtered.filter(function(c) {
      return c.time && c.time.slice(0, 10) === todayStr;
    });
  }

  // 최신순 정렬
  filtered.sort(function(a, b) { return new Date(b.time) - new Date(a.time); });

  var limit = parseInt(req.query.limit) || 100;
  var offset = parseInt(req.query.offset) || 0;

  res.json({
    total: filtered.length,
    checkins: filtered.slice(offset, offset + limit)
  });
});

// ── 스탬프 API ────────────────────────────────────

// 스탬프 획득
api.post('/stamps', function(req, res) {
  var body = req.body;
  if (!body.participantId || !body.progId) {
    return res.status(400).json({ error: '참가자 ID와 프로그램 ID가 필요합니다' });
  }

  var stamps = stores.stamps.get();
  if (!stamps[body.participantId]) stamps[body.participantId] = [];

  var progId = Number(body.progId);
  if (stamps[body.participantId].indexOf(progId) === -1) {
    stamps[body.participantId].push(progId);
    stores.stamps.set(stamps);
    broadcast({ type: 'stamp:new', data: { participantId: body.participantId, progId: progId } });
  }

  res.json({ participantId: body.participantId, stamps: stamps[body.participantId] });
});

// 스탬프 조회
api.get('/stamps/:participantId', function(req, res) {
  var stamps = stores.stamps.get();
  var s = stamps[req.params.participantId] || [];
  res.json({ participantId: req.params.participantId, stamps: s, count: s.length, total: 15 });
});

// ── 체험 결과 API ─────────────────────────────────

// 결과 저장
api.post('/results', function(req, res) {
  var body = req.body;
  if (!body.participantId || !body.progId) {
    return res.status(400).json({ error: '참가자 ID와 프로그램 ID가 필요합니다' });
  }

  var results = stores.results.get();
  var key = body.participantId;
  if (!results[key]) results[key] = {};

  results[key][String(body.progId)] = {
    score: body.score || 0,
    data: body.data || null,
    completedAt: new Date().toISOString()
  };

  stores.results.set(results);
  broadcast({ type: 'result:new', data: { participantId: key, progId: body.progId, score: body.score } });
  res.status(201).json(results[key][String(body.progId)]);
});

// 결과 조회
api.get('/results/:participantId', function(req, res) {
  var results = stores.results.get();
  res.json(results[req.params.participantId] || {});
});

// ── 리더보드 API ──────────────────────────────────

// 리더보드 등록
api.post('/leaderboard/:category', function(req, res) {
  var category = req.params.category;
  var leaderboard = stores.leaderboard.get();

  if (!leaderboard[category]) leaderboard[category] = [];

  var entry = {
    nick: req.body.nick,
    participantId: req.body.participantId || null,
    score: Number(req.body.score),
    time: new Date().toISOString()
  };

  leaderboard[category].push(entry);
  // 점수 내림차순 정렬 후 상위 50개 유지
  leaderboard[category].sort(function(a, b) { return b.score - a.score; });
  leaderboard[category] = leaderboard[category].slice(0, 50);

  stores.leaderboard.set(leaderboard);
  broadcast({ type: 'leaderboard:update', data: { category: category, leaderboard: leaderboard[category] } });
  res.status(201).json({ rank: leaderboard[category].indexOf(entry) + 1, entry: entry });
});

// 리더보드 조회
api.get('/leaderboard/:category', function(req, res) {
  var leaderboard = stores.leaderboard.get();
  var cat = leaderboard[req.params.category] || [];
  var limit = parseInt(req.query.limit) || 10;
  res.json({ category: req.params.category, entries: cat.slice(0, limit) });
});

// 전체 리더보드 조회
api.get('/leaderboard', function(req, res) {
  res.json(stores.leaderboard.get());
});

// ── 부스 상태 API ─────────────────────────────────

// 부스 상태 업데이트
api.put('/booths/:id/status', requireAdmin, function(req, res) {
  var boothId = Number(req.params.id);
  var boothStatus = stores.boothStatus.get();

  boothStatus[boothId] = {
    status: req.body.status || 'active',
    currentCount: req.body.currentCount || 0,
    waitCount: req.body.waitCount || 0,
    message: req.body.message || '',
    updatedAt: new Date().toISOString()
  };

  stores.boothStatus.set(boothStatus);
  broadcast({ type: 'booth:status', data: { boothId: boothId, status: boothStatus[boothId] } });
  res.json(boothStatus[boothId]);
});

// 부스 상태 조회
api.get('/booths/status', function(req, res) {
  res.json(stores.boothStatus.get());
});

// ── 멘토링 예약 API ──────────────────────────────

// 예약 등록
api.post('/mentoring/reservations', function(req, res) {
  var body = req.body;
  if (!body.mentorId || !body.slot || !body.participantId) {
    return res.status(400).json({ error: '멘토 ID, 시간 슬롯, 참가자 ID가 필요합니다' });
  }

  var mentoring = stores.mentoring.get();
  var slotKey = body.mentorId + ':' + body.slot;

  if (mentoring.slots[slotKey]) {
    return res.status(409).json({ error: '이미 예약된 슬롯입니다' });
  }

  var reservation = {
    id: 'MR-' + Date.now().toString(36).toUpperCase(),
    mentorId: body.mentorId,
    slot: body.slot,
    participantId: body.participantId,
    participantName: body.participantName || null,
    topic: body.topic || null,
    createdAt: new Date().toISOString()
  };

  mentoring.slots[slotKey] = reservation.id;
  mentoring.reservations.push(reservation);
  stores.mentoring.set(mentoring);

  broadcast({ type: 'mentoring:reserved', data: reservation });
  res.status(201).json(reservation);
});

// 멘토 예약 현황 조회
api.get('/mentoring/reservations', function(req, res) {
  var mentoring = stores.mentoring.get();
  var filtered = mentoring.reservations;

  if (req.query.mentorId) {
    filtered = filtered.filter(function(r) { return r.mentorId === req.query.mentorId; });
  }
  if (req.query.participantId) {
    filtered = filtered.filter(function(r) { return r.participantId === req.query.participantId; });
  }

  res.json({ count: filtered.length, reservations: filtered });
});

// ── 통계 API ──────────────────────────────────────

api.get('/stats', function(req, res) {
  var participants = stores.participants.get();
  var checkins = stores.checkins.get();
  var stamps = stores.stamps.get();
  var leaderboard = stores.leaderboard.get();
  var mentoring = stores.mentoring.get();

  var todayStr = new Date().toISOString().slice(0, 10);
  var todayCheckins = checkins.filter(function(c) {
    return c.time && c.time.slice(0, 10) === todayStr;
  });

  // 부스별 체크인 수
  var boothCounts = {};
  todayCheckins.forEach(function(c) {
    boothCounts[c.progId] = (boothCounts[c.progId] || 0) + 1;
  });

  // 존별 체크인 수
  var zoneCounts = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  var zoneMap = { A: [1,2,3], B: [4,5,6], C: [7,8,9], D: [10,11,12], E: [13,14,15] };
  Object.keys(zoneMap).forEach(function(zone) {
    zoneMap[zone].forEach(function(pid) {
      zoneCounts[zone] += boothCounts[pid] || 0;
    });
  });

  // 스탬프 완료자 수
  var completedCount = 0;
  Object.values(stamps).forEach(function(s) {
    if (s.length >= 15) completedCount++;
  });

  // 시간대별 체크인 수
  var hourly = {};
  todayCheckins.forEach(function(c) {
    var hour = new Date(c.time).getHours();
    hourly[hour] = (hourly[hour] || 0) + 1;
  });

  res.json({
    totalParticipants: Object.keys(participants).length,
    todayCheckins: todayCheckins.length,
    totalCheckins: checkins.length,
    boothCounts: boothCounts,
    zoneCounts: zoneCounts,
    stampCompleted: completedCount,
    hourlyCheckins: hourly,
    leaderboardCounts: {
      dance: (leaderboard.dance || []).length,
      classify: (leaderboard.classify || []).length,
      prompt: (leaderboard.prompt || []).length
    },
    mentoringReservations: mentoring.reservations.length,
    serverTime: new Date().toISOString()
  });
});

// ── 데이터 동기화 (Bulk) API ─────────────────────

// 클라이언트 → 서버 전체 동기화 (초기 업로드)
api.post('/sync/upload', requireAdmin, function(req, res) {
  var body = req.body;

  if (body.participants) {
    var existing = stores.participants.get();
    Object.assign(existing, body.participants);
    stores.participants.set(existing);
  }
  if (body.checkins && Array.isArray(body.checkins)) {
    var existingCheckins = stores.checkins.get();
    var existingIds = new Set(existingCheckins.map(function(c) { return c.id; }));
    body.checkins.forEach(function(c) {
      if (!c.id) c.id = 'CK-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5);
      if (!existingIds.has(c.id)) existingCheckins.push(c);
    });
    stores.checkins.set(existingCheckins);
  }
  if (body.stamps) {
    var existingStamps = stores.stamps.get();
    Object.keys(body.stamps).forEach(function(pid) {
      if (!existingStamps[pid]) existingStamps[pid] = [];
      body.stamps[pid].forEach(function(s) {
        if (existingStamps[pid].indexOf(s) === -1) existingStamps[pid].push(s);
      });
    });
    stores.stamps.set(existingStamps);
  }
  if (body.results) {
    var existingResults = stores.results.get();
    Object.keys(body.results).forEach(function(pid) {
      if (!existingResults[pid]) existingResults[pid] = {};
      Object.assign(existingResults[pid], body.results[pid]);
    });
    stores.results.set(existingResults);
  }

  broadcast({ type: 'sync:updated', data: { source: 'upload' } });
  res.json({ status: 'ok', message: 'Data synced successfully' });
});

// 서버 → 클라이언트 전체 데이터 다운로드
api.get('/sync/download', function(req, res) {
  res.json({
    participants: stores.participants.get(),
    checkins: stores.checkins.get(),
    stamps: stores.stamps.get(),
    results: stores.results.get(),
    leaderboard: stores.leaderboard.get(),
    boothStatus: stores.boothStatus.get(),
    mentoring: stores.mentoring.get(),
    serverTime: new Date().toISOString()
  });
});

// 데이터 초기화 (관리자용)
api.post('/sync/reset', requireAdmin, function(req, res) {
  var confirm = req.body.confirm;
  if (confirm !== 'RESET_ALL_DATA') {
    return res.status(400).json({ error: 'confirm 필드에 "RESET_ALL_DATA"를 전달해야 합니다' });
  }

  stores.participants.set({});
  stores.checkins.set([]);
  stores.stamps.set({});
  stores.results.set({});
  stores.leaderboard.set({ dance: [], classify: [], prompt: [] });
  stores.boothStatus.set({});
  stores.mentoring.set({ slots: {}, reservations: [] });

  broadcast({ type: 'sync:reset', data: {} });
  res.json({ status: 'ok', message: 'All data has been reset' });
});

// ── 데이터 내보내기 (CSV) API ────────────────────

function escapeCSV(val) {
  if (val === null || val === undefined) return '';
  var str = String(val);
  if (str.indexOf(',') !== -1 || str.indexOf('"') !== -1 || str.indexOf('\n') !== -1) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function arrayToCSV(headers, rows) {
  var bom = '\uFEFF'; // UTF-8 BOM for Excel 한글 지원
  var lines = [headers.map(escapeCSV).join(',')];
  rows.forEach(function(row) {
    lines.push(row.map(escapeCSV).join(','));
  });
  return bom + lines.join('\r\n');
}

// 프로그램 이름 매핑
var PROG_NAMES = {
  1:'나의 몸을 읽는 AI',2:'AI 운동 코치',3:'댄스 AI 챌린지',
  4:'물건을 알아보는 AI',5:'AI 안전 감시관',6:'AI 분류 챌린지',
  7:'AI 아바타 스튜디오',8:'AI 뮤직비디오 제작',9:'프롬프트 아트 챌린지',
  10:'AI 의사 체험',11:'스마트팜 관제',12:'자율주행 시뮬레이터',
  13:'AI 직업 매칭',14:'비주얼 코딩 체험',15:'IT 전문가 멘토링'
};

var ZONE_MAP = {1:'A',2:'A',3:'A',4:'B',5:'B',6:'B',7:'C',8:'C',9:'C',10:'D',11:'D',12:'D',13:'E',14:'E',15:'E'};

// 참가자 CSV 내보내기
api.get('/export/participants', requireAdmin, function(req, res) {
  var participants = stores.participants.get();
  var stamps = stores.stamps.get();
  var list = Object.values(participants);

  var headers = ['참가자ID', '닉네임', '학교', '아바타', '등록일시', '스탬프수', '완료여부'];
  var rows = list.map(function(p) {
    var s = stamps[p.id] || [];
    return [p.id, p.nick, p.school || '', p.avatar || '', p.registeredAt, s.length, s.length >= 15 ? '완료' : '미완료'];
  });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="participants_' + new Date().toISOString().slice(0,10) + '.csv"');
  res.send(arrayToCSV(headers, rows));
});

// 체크인 CSV 내보내기
api.get('/export/checkins', requireAdmin, function(req, res) {
  var checkins = stores.checkins.get();

  if (req.query.today === 'true') {
    var todayStr = new Date().toISOString().slice(0, 10);
    checkins = checkins.filter(function(c) { return c.time && c.time.slice(0, 10) === todayStr; });
  }

  var headers = ['체크인ID', '참가자ID', '참가자명', '프로그램번호', '프로그램명', '존', '유형', '시간'];
  var rows = checkins.map(function(c) {
    return [c.id, c.participantId, c.participantName || '', c.progId, PROG_NAMES[c.progId] || '', ZONE_MAP[c.progId] || '', c.type || '', c.time];
  });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="checkins_' + new Date().toISOString().slice(0,10) + '.csv"');
  res.send(arrayToCSV(headers, rows));
});

// 스탬프 현황 CSV 내보내기
api.get('/export/stamps', requireAdmin, function(req, res) {
  var participants = stores.participants.get();
  var stamps = stores.stamps.get();

  var headers = ['참가자ID', '닉네임', '학교', '스탬프수'];
  for (var i = 1; i <= 15; i++) headers.push(PROG_NAMES[i]);

  var rows = Object.values(participants).map(function(p) {
    var s = stamps[p.id] || [];
    var row = [p.id, p.nick, p.school || '', s.length];
    for (var i = 1; i <= 15; i++) {
      row.push(s.indexOf(i) !== -1 ? 'O' : '');
    }
    return row;
  });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="stamps_' + new Date().toISOString().slice(0,10) + '.csv"');
  res.send(arrayToCSV(headers, rows));
});

// 리더보드 CSV 내보내기
api.get('/export/leaderboard', requireAdmin, function(req, res) {
  var leaderboard = stores.leaderboard.get();
  var headers = ['카테고리', '순위', '닉네임', '참가자ID', '점수', '등록시간'];
  var rows = [];

  Object.keys(leaderboard).forEach(function(cat) {
    (leaderboard[cat] || []).forEach(function(entry, idx) {
      rows.push([cat, idx + 1, entry.nick, entry.participantId || '', entry.score, entry.time || '']);
    });
  });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="leaderboard_' + new Date().toISOString().slice(0,10) + '.csv"');
  res.send(arrayToCSV(headers, rows));
});

// 멘토링 예약 CSV 내보내기
api.get('/export/mentoring', requireAdmin, function(req, res) {
  var mentoring = stores.mentoring.get();
  var headers = ['예약ID', '멘토ID', '시간슬롯', '참가자ID', '참가자명', '상담주제', '예약시간'];
  var rows = mentoring.reservations.map(function(r) {
    return [r.id, r.mentorId, r.slot, r.participantId, r.participantName || '', r.topic || '', r.createdAt];
  });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="mentoring_' + new Date().toISOString().slice(0,10) + '.csv"');
  res.send(arrayToCSV(headers, rows));
});

// 전체 데이터 ZIP (JSON 형태)
api.get('/export/all', requireAdmin, function(req, res) {
  var data = {
    exportedAt: new Date().toISOString(),
    participants: stores.participants.get(),
    checkins: stores.checkins.get(),
    stamps: stores.stamps.get(),
    results: stores.results.get(),
    leaderboard: stores.leaderboard.get(),
    boothStatus: stores.boothStatus.get(),
    mentoring: stores.mentoring.get()
  };

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="dreamfest_data_' + new Date().toISOString().slice(0,10) + '.json"');
  res.json(data);
});

// API 마운트
app.use('/api', api);

// API 404
app.use('/api/*', function(req, res) {
  res.status(404).json({ error: 'API endpoint not found' });
});

// SPA 폴백: HTML 요청은 index.html 반환
app.get('*', function(req, res) {
  var reqPath = req.path;
  // .html 파일 직접 요청
  if (reqPath.endsWith('.html')) {
    var filePath = path.join(OUTPUT_DIR, reqPath);
    if (fs.existsSync(filePath)) return res.sendFile(filePath);
  }
  res.sendFile(path.join(OUTPUT_DIR, 'index.html'));
});

// ── HTTP + WebSocket 서버 ─────────────────────────
var server = http.createServer(app);
var wss = new WebSocket.Server({ server: server, path: '/ws' });

var clients = new Set();

wss.on('connection', function(ws, req) {
  clients.add(ws);
  var ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  console.log('[WS] Client connected from', ip, '| Total:', clients.size);

  // 연결 시 현재 통계 전송
  ws.send(JSON.stringify({
    type: 'connected',
    data: {
      clientCount: clients.size,
      serverTime: new Date().toISOString()
    }
  }));

  ws.on('message', function(raw) {
    try {
      var msg = JSON.parse(raw);
      handleWsMessage(ws, msg);
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', data: { message: 'Invalid JSON' } }));
    }
  });

  ws.on('close', function() {
    clients.delete(ws);
    console.log('[WS] Client disconnected | Total:', clients.size);
  });

  ws.on('error', function(err) {
    console.error('[WS] Error:', err.message);
    clients.delete(ws);
  });
});

function handleWsMessage(sender, msg) {
  switch (msg.type) {
    case 'ping':
      sender.send(JSON.stringify({ type: 'pong', data: { serverTime: new Date().toISOString() } }));
      break;

    case 'booth:heartbeat':
      // 키오스크 하트비트 — 부스 상태 업데이트
      if (msg.data && msg.data.boothId) {
        var boothStatus = stores.boothStatus.get();
        boothStatus[msg.data.boothId] = Object.assign(boothStatus[msg.data.boothId] || {}, {
          online: true,
          lastHeartbeat: new Date().toISOString()
        });
        stores.boothStatus.set(boothStatus);
      }
      break;

    case 'sync:request':
      // 클라이언트가 전체 데이터 요청
      sender.send(JSON.stringify({
        type: 'sync:data',
        data: {
          participants: stores.participants.get(),
          checkins: stores.checkins.get(),
          stamps: stores.stamps.get(),
          results: stores.results.get(),
          leaderboard: stores.leaderboard.get(),
          boothStatus: stores.boothStatus.get(),
          serverTime: new Date().toISOString()
        }
      }));
      break;

    default:
      // 알 수 없는 메시지 타입은 다른 클라이언트에 브로드캐스트
      broadcastExcept(sender, msg);
  }
}

function broadcast(msg) {
  var payload = JSON.stringify(msg);
  clients.forEach(function(client) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

function broadcastExcept(sender, msg) {
  var payload = JSON.stringify(msg);
  clients.forEach(function(client) {
    if (client !== sender && client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

// ── 서버 시작 ─────────────────────────────────────
server.listen(PORT, function() {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════════╗');
  console.log('  ║  꿈-드림 페스티벌 미래기술존 서버                  ║');
  console.log('  ╠══════════════════════════════════════════════════╣');
  console.log('  ║                                                  ║');
  console.log('  ║  🌐 웹:  http://localhost:' + PORT + '                  ║');
  console.log('  ║  📡 API: http://localhost:' + PORT + '/api              ║');
  console.log('  ║  🔌 WS:  ws://localhost:' + PORT + '/ws                ║');
  console.log('  ║                                                  ║');
  console.log('  ║  정적 파일: ' + OUTPUT_DIR);
  console.log('  ║  데이터:    ' + DATA_DIR);
  console.log('  ║                                                  ║');
  console.log('  ║  🔐 관리자 비밀번호: ' + ADMIN_PASSWORD);
  console.log('  ║                                                  ║');
  console.log('  ╚══════════════════════════════════════════════════╝');
  console.log('');
});

// 종료 시 정리
process.on('SIGINT', function() {
  console.log('\n[Server] Shutting down...');
  wss.close();
  server.close();
  process.exit(0);
});

process.on('SIGTERM', function() {
  wss.close();
  server.close();
  process.exit(0);
});
