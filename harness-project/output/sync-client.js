/**
 * 꿈-드림 페스티벌 — 서버 동기화 클라이언트
 *
 * 모든 HTML 페이지에서 공유하는 동기화 모듈.
 * 서버가 없으면 localStorage만 사용 (기존 오프라인 모드 유지).
 * 서버가 있으면 REST API + WebSocket으로 실시간 동기화.
 */
(function(window) {
  'use strict';

  var SERVER_URL = '';  // 같은 origin 사용 (Express가 서빙)
  var WS_RECONNECT_DELAY = 3000;
  var WS_MAX_RECONNECT = 10;

  var DreamSync = {
    ws: null,
    connected: false,
    serverAvailable: false,
    reconnectCount: 0,
    listeners: {},
    adminToken: null,
    _syncing: false,

    // ── 초기화 ──────────────────────────────────
    init: function() {
      var self = this;
      // 세션 복원
      this.restoreSession();
      // 온라인/오프라인 이벤트 감지
      window.addEventListener('online', function() {
        console.log('[Sync] Browser online');
        self.checkServer(function(available) {
          self.serverAvailable = available;
          if (available) {
            self.connectWs();
            self.updateStatusIndicator(true);
            self.flushOfflineQueue();
          }
        });
      });
      window.addEventListener('offline', function() {
        console.log('[Sync] Browser offline');
        self.serverAvailable = false;
        self.connected = false;
        self.updateStatusIndicator(false);
        self.emit('offline');
      });
      // 서버 가용성 확인
      this.checkServer(function(available) {
        self.serverAvailable = available;
        if (available) {
          console.log('[Sync] Server available, connecting WebSocket...');
          self.connectWs();
          self.updateStatusIndicator(true);
          // Flush any queued offline actions
          self.flushOfflineQueue();
        } else {
          console.log('[Sync] Server not available, using localStorage only');
          self.updateStatusIndicator(false);
        }
      });
    },

    // ── 서버 가용성 확인 ────────────────────────
    checkServer: function(callback) {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', '/api/stats', true);
      xhr.timeout = 3000;
      xhr.onload = function() {
        callback(xhr.status === 200);
      };
      xhr.onerror = function() { callback(false); };
      xhr.ontimeout = function() { callback(false); };
      xhr.send();
    },

    // ── WebSocket 연결 ──────────────────────────
    connectWs: function() {
      var self = this;
      if (self.ws && self.ws.readyState <= 1) return;

      var protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      var wsUrl = protocol + '//' + location.host + '/ws';

      try {
        self.ws = new WebSocket(wsUrl);
      } catch (e) {
        console.error('[Sync] WebSocket creation failed:', e);
        return;
      }

      self.ws.onopen = function() {
        console.log('[Sync] WebSocket connected');
        self.connected = true;
        self.serverAvailable = true;
        self.reconnectCount = 0;
        self.updateStatusIndicator(true);
        self.emit('connected');
        // Flush any queued offline actions
        self.flushOfflineQueue();
      };

      self.ws.onmessage = function(event) {
        try {
          var msg = JSON.parse(event.data);
          self.handleMessage(msg);
        } catch (e) {
          console.error('[Sync] Parse error:', e);
        }
      };

      self.ws.onclose = function() {
        self.connected = false;
        self.updateStatusIndicator(false);
        self.emit('disconnected');

        if (self.reconnectCount < WS_MAX_RECONNECT) {
          self.reconnectCount++;
          console.log('[Sync] Reconnecting... (' + self.reconnectCount + '/' + WS_MAX_RECONNECT + ')');
          setTimeout(function() { self.connectWs(); }, WS_RECONNECT_DELAY);
        }
      };

      self.ws.onerror = function() {
        // onclose will fire after this
      };
    },

    // ── WebSocket 메시지 처리 ───────────────────
    handleMessage: function(msg) {
      switch (msg.type) {
        case 'connected':
          console.log('[Sync] Server clients:', msg.data.clientCount);
          break;

        case 'checkin:new':
          this.mergeCheckin(msg.data);
          this.emit('checkin:new', msg.data);
          break;

        case 'participant:new':
          this.mergeParticipant(msg.data);
          this.emit('participant:new', msg.data);
          break;

        case 'stamp:new':
          this.mergeStamp(msg.data.participantId, msg.data.progId);
          this.emit('stamp:new', msg.data);
          break;

        case 'leaderboard:update':
          this.emit('leaderboard:update', msg.data);
          break;

        case 'booth:status':
          this.emit('booth:status', msg.data);
          break;

        case 'mentoring:reserved':
          this.emit('mentoring:reserved', msg.data);
          break;

        case 'sync:data':
          this.applyFullSync(msg.data);
          this.emit('sync:complete', msg.data);
          break;

        case 'sync:reset':
          this.clearLocalData();
          this.emit('sync:reset');
          break;

        case 'pong':
          break;

        default:
          this.emit(msg.type, msg.data);
      }
    },

    // ── 오프라인 큐 ──────────────────────────────

    getOfflineQueue: function() {
      return this.getLocal('dreamfest_offline_queue') || [];
    },

    saveOfflineQueue: function(queue) {
      this.saveLocal('dreamfest_offline_queue', queue);
    },

    enqueueOffline: function(method, path, data) {
      var queue = this.getOfflineQueue();
      queue.push({
        id: Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        method: method,
        path: path,
        data: data,
        timestamp: new Date().toISOString(),
        retries: 0
      });
      this.saveOfflineQueue(queue);
      console.log('[Sync] Queued offline action:', method, path, '(queue size:', queue.length, ')');
      this.emit('queue:updated', { size: queue.length });
    },

    flushOfflineQueue: function() {
      var self = this;
      if (self._syncing) return;
      var queue = self.getOfflineQueue();
      if (queue.length === 0) return;

      self._syncing = true;
      console.log('[Sync] Flushing offline queue:', queue.length, 'items');
      self.emit('queue:flushing', { size: queue.length });

      var processed = 0;
      var failed = [];

      function processNext() {
        if (processed >= queue.length) {
          // Save any failed items back
          self.saveOfflineQueue(failed);
          self._syncing = false;
          var successCount = queue.length - failed.length;
          console.log('[Sync] Queue flush complete:', successCount, 'synced,', failed.length, 'remaining');
          self.emit('queue:flushed', { synced: successCount, remaining: failed.length });
          return;
        }

        var item = queue[processed];
        processed++;

        self._apiDirect(item.method, item.path, item.data, function(result, error) {
          if (error) {
            item.retries++;
            if (item.retries < 5) {
              failed.push(item);
            } else {
              console.warn('[Sync] Dropping queued item after 5 retries:', item.path);
            }
          }
          // Small delay between requests to avoid flooding
          setTimeout(processNext, 100);
        });
      }

      processNext();
    },

    // ── REST API 호출 ───────────────────────────

    _apiDirect: function(method, path, data, callback) {
      var self = this;
      var xhr = new XMLHttpRequest();
      xhr.open(method, '/api' + path, true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      if (self.adminToken) {
        xhr.setRequestHeader('Authorization', 'Bearer ' + self.adminToken);
      }
      xhr.timeout = 10000;

      xhr.onload = function() {
        try {
          var result = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300) {
            if (callback) callback(result, null);
          } else {
            if (callback) callback(null, result.error || 'API error');
          }
        } catch (e) {
          if (callback) callback(null, 'Parse error');
        }
      };

      xhr.onerror = function() { if (callback) callback(null, 'Network error'); };
      xhr.ontimeout = function() { if (callback) callback(null, 'Timeout'); };
      xhr.send(data ? JSON.stringify(data) : null);
    },

    api: function(method, path, data, callback) {
      var self = this;
      if (!this.serverAvailable) {
        // Queue POST/PUT requests for later sync
        if (method === 'POST' || method === 'PUT') {
          this.enqueueOffline(method, path, data);
        }
        if (callback) callback(null, 'Server not available (queued)');
        return;
      }

      this._apiDirect(method, path, data, function(result, error) {
        if (error && (error === 'Network error' || error === 'Timeout') && (method === 'POST' || method === 'PUT')) {
          // Network failed — queue for retry
          self.enqueueOffline(method, path, data);
          self.serverAvailable = false;
          self.updateStatusIndicator(false);
        }
        if (callback) callback(result, error);
      });
    },

    // ── 참가자 ──────────────────────────────────

    registerParticipant: function(participant, callback) {
      // localStorage에 저장
      this.saveLocal('dreamfest_participant', participant);

      // 서버에 전송
      this.api('POST', '/participants', participant, function(result, error) {
        if (callback) callback(result, error);
      });
    },

    // ── 체크인 ──────────────────────────────────

    recordCheckin: function(checkin, callback) {
      // localStorage에 저장
      var checkins = this.getLocal('dreamfest_checkins') || [];
      checkins.push(checkin);
      this.saveLocal('dreamfest_checkins', checkins);

      // 서버에 전송
      this.api('POST', '/checkins', checkin, function(result, error) {
        if (callback) callback(result, error);
      });
    },

    // ── 스탬프 ──────────────────────────────────

    addStamp: function(participantId, progId, callback) {
      // localStorage에 저장
      var stamps = this.getLocal('dreamfest_stamps') || [];
      if (stamps.indexOf(progId) === -1) {
        stamps.push(progId);
        this.saveLocal('dreamfest_stamps', stamps);
      }

      // 서버에 전송
      this.api('POST', '/stamps', { participantId: participantId, progId: progId }, function(result, error) {
        if (callback) callback(result, error);
      });
    },

    // ── 체험 결과 ───────────────────────────────

    saveResult: function(participantId, progId, resultData, callback) {
      // localStorage에 저장
      var results = this.getLocal('dreamfest_results') || {};
      results[String(progId)] = resultData;
      this.saveLocal('dreamfest_results', results);

      // 서버에 전송
      this.api('POST', '/results', {
        participantId: participantId,
        progId: progId,
        score: resultData.score,
        data: resultData.data
      }, function(result, error) {
        if (callback) callback(result, error);
      });
    },

    // ── 리더보드 ────────────────────────────────

    submitScore: function(category, entry, callback) {
      // localStorage에 저장
      var leaderboard = this.getLocal('dreamfest_leaderboard') || {};
      if (!leaderboard[category]) leaderboard[category] = [];
      leaderboard[category].push(entry);
      leaderboard[category].sort(function(a, b) { return b.score - a.score; });
      leaderboard[category] = leaderboard[category].slice(0, 50);
      this.saveLocal('dreamfest_leaderboard', leaderboard);

      // 서버에 전송
      this.api('POST', '/leaderboard/' + category, entry, function(result, error) {
        if (callback) callback(result, error);
      });
    },

    getLeaderboard: function(category, callback) {
      // 서버에서 가져오기 시도
      var self = this;
      this.api('GET', '/leaderboard/' + category + '?limit=10', null, function(result, error) {
        if (result) {
          callback(result.entries, null);
        } else {
          // 서버 실패 시 localStorage에서
          var lb = self.getLocal('dreamfest_leaderboard') || {};
          callback((lb[category] || []).slice(0, 10), error);
        }
      });
    },

    // ── 멘토링 예약 ────────────────────────────

    reserveMentoring: function(reservation, callback) {
      this.api('POST', '/mentoring/reservations', reservation, function(result, error) {
        if (callback) callback(result, error);
      });
    },

    // ── 관리자 인증 ──────────────────────────────

    login: function(password, callback) {
      var self = this;
      this.api('POST', '/auth/login', { password: password }, function(result, error) {
        if (result && result.token) {
          self.adminToken = result.token;
          try { sessionStorage.setItem('dreamfest_admin_token', result.token); } catch(e) {}
          self.emit('auth:login', { success: true });
        }
        if (callback) callback(result, error);
      });
    },

    logout: function(callback) {
      var self = this;
      this.api('POST', '/auth/logout', {}, function() {
        self.adminToken = null;
        try { sessionStorage.removeItem('dreamfest_admin_token'); } catch(e) {}
        self.emit('auth:logout');
        if (callback) callback();
      });
    },

    checkAuth: function(callback) {
      this.api('GET', '/auth/check', null, callback);
    },

    isAdmin: function() {
      return !!this.adminToken;
    },

    restoreSession: function() {
      try {
        var token = sessionStorage.getItem('dreamfest_admin_token');
        if (token) {
          this.adminToken = token;
          var self = this;
          this.checkAuth(function(result) {
            if (!result || !result.authenticated) {
              self.adminToken = null;
              sessionStorage.removeItem('dreamfest_admin_token');
            }
          });
        }
      } catch(e) {}
    },

    // ── 통계 ────────────────────────────────────

    getStats: function(callback) {
      this.api('GET', '/stats', null, callback);
    },

    // ── Bulk 동기화 ─────────────────────────────

    uploadAll: function(callback) {
      var data = {
        participants: {},
        checkins: this.getLocal('dreamfest_checkins') || [],
        stamps: {},
        results: {}
      };

      var participant = this.getLocal('dreamfest_participant');
      if (participant && participant.id) {
        data.participants[participant.id] = participant;
        data.stamps[participant.id] = this.getLocal('dreamfest_stamps') || [];
        data.results[participant.id] = this.getLocal('dreamfest_results') || {};
      }

      this.api('POST', '/sync/upload', data, callback);
    },

    downloadAll: function(callback) {
      var self = this;
      this.api('GET', '/sync/download', null, function(result, error) {
        if (result) {
          self.applyFullSync(result);
        }
        if (callback) callback(result, error);
      });
    },

    requestSync: function() {
      if (this.ws && this.connected) {
        this.ws.send(JSON.stringify({ type: 'sync:request' }));
      }
    },

    // ── localStorage 헬퍼 ───────────────────────

    getLocal: function(key) {
      try {
        var raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch (e) { return null; }
    },

    saveLocal: function(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (e) {
        console.error('[Sync] localStorage save error:', e);
      }
    },

    mergeCheckin: function(checkin) {
      var checkins = this.getLocal('dreamfest_checkins') || [];
      var exists = checkins.some(function(c) { return c.id === checkin.id; });
      if (!exists) {
        checkins.push(checkin);
        this.saveLocal('dreamfest_checkins', checkins);
      }
    },

    mergeParticipant: function(participant) {
      // 다른 기기의 참가자 정보는 별도 키에 저장
      var all = this.getLocal('dreamfest_all_participants') || {};
      all[participant.id] = participant;
      this.saveLocal('dreamfest_all_participants', all);
    },

    mergeStamp: function(participantId, progId) {
      var myParticipant = this.getLocal('dreamfest_participant');
      if (myParticipant && myParticipant.id === participantId) {
        var stamps = this.getLocal('dreamfest_stamps') || [];
        if (stamps.indexOf(progId) === -1) {
          stamps.push(progId);
          this.saveLocal('dreamfest_stamps', stamps);
        }
      }
    },

    applyFullSync: function(data) {
      // 서버 데이터를 localStorage에 반영
      if (data.checkins) {
        var local = this.getLocal('dreamfest_checkins') || [];
        var localIds = new Set(local.map(function(c) { return c.id; }));
        data.checkins.forEach(function(c) {
          if (c.id && !localIds.has(c.id)) local.push(c);
        });
        this.saveLocal('dreamfest_checkins', local);
      }
      if (data.leaderboard) {
        this.saveLocal('dreamfest_leaderboard', data.leaderboard);
      }
    },

    clearLocalData: function() {
      ['dreamfest_participant', 'dreamfest_stamps', 'dreamfest_results',
       'dreamfest_checkins', 'dreamfest_leaderboard', 'dreamfest_all_participants',
       'dreamfest_offline_queue'
      ].forEach(function(key) {
        localStorage.removeItem(key);
      });
    },

    // ── 이벤트 시스템 ───────────────────────────

    on: function(event, callback) {
      if (!this.listeners[event]) this.listeners[event] = [];
      this.listeners[event].push(callback);
    },

    off: function(event, callback) {
      if (!this.listeners[event]) return;
      this.listeners[event] = this.listeners[event].filter(function(cb) { return cb !== callback; });
    },

    emit: function(event, data) {
      var cbs = this.listeners[event] || [];
      cbs.forEach(function(cb) {
        try { cb(data); } catch (e) { console.error('[Sync] Listener error:', e); }
      });
    },

    // ── UI 상태 표시 ────────────────────────────

    updateStatusIndicator: function(online) {
      var el = document.getElementById('sync-status');
      if (!el) {
        // 상태 표시 엘리먼트 생성
        el = document.createElement('div');
        el.id = 'sync-status';
        el.style.cssText = 'position:fixed;bottom:12px;right:12px;padding:6px 14px;border-radius:20px;font-size:12px;font-family:sans-serif;z-index:99999;cursor:pointer;transition:all .3s;box-shadow:0 2px 8px rgba(0,0,0,.15);';
        el.onclick = function() {
          el.style.display = 'none';
          setTimeout(function() { el.style.display = ''; }, 30000);
        };
        document.body.appendChild(el);
      }

      var queueSize = this.getOfflineQueue().length;
      if (online) {
        el.style.background = '#2D7A4F';
        el.style.color = '#fff';
        el.textContent = '\u25CF Server Connected';
        if (queueSize > 0) {
          el.textContent += ' (syncing ' + queueSize + ')';
        }
      } else {
        el.style.background = '#f5f5f5';
        el.style.color = '#999';
        el.textContent = '\u25CB Offline Mode';
        if (queueSize > 0) {
          el.textContent += ' (' + queueSize + ' queued)';
        }
      }
    },

    // ── 하트비트 (키오스크용) ────────────────────

    startHeartbeat: function(boothId) {
      var self = this;
      setInterval(function() {
        if (self.ws && self.connected) {
          self.ws.send(JSON.stringify({
            type: 'booth:heartbeat',
            data: { boothId: boothId }
          }));
        }
      }, 30000);
    }
  };

  // 글로벌 노출
  window.DreamSync = DreamSync;

  // DOM 준비 시 자동 초기화
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { DreamSync.init(); });
  } else {
    DreamSync.init();
  }

})(window);
