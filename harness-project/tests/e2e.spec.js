const { test, expect } = require('@playwright/test');

// ═══════════════════════════════════════
// 1. 대시보드 기본 로드
// ═══════════════════════════════════════
test.describe('대시보드', () => {
  test('메인 페이지 로드 및 관제 맵 표시', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/꿈-드림 페스티벌/);
    await expect(page.locator('#view-floormap')).toBeVisible();
    await expect(page.locator('.floormap-svg')).toBeVisible();
  });

  test('관리자 네비게이션 탭 전환', async ({ page }) => {
    await page.goto('/');
    // 타임테이블
    await page.click('[data-view="timetable"]');
    await expect(page.locator('#view-timetable')).toBeVisible();
    // 스태프 배치
    await page.click('[data-view="staff"]');
    await expect(page.locator('#view-staff')).toBeVisible();
    // 통계 분석
    await page.click('[data-view="stats"]');
    await expect(page.locator('#view-stats')).toBeVisible();
    // 콘텐츠 관리
    await page.click('[data-view="content"]');
    await expect(page.locator('#view-content')).toBeVisible();
  });

  test('참가자 모드 전환', async ({ page }) => {
    await page.goto('/');
    await page.click('button:has-text("참가자")');
    await expect(page.locator('#navParticipant')).toBeVisible();
    await expect(page.locator('#view-stamp')).toBeVisible();
  });

  test('참가자 모드 탭 전환', async ({ page }) => {
    await page.goto('/');
    await page.click('button:has-text("참가자")');
    // 랭킹
    await page.click('[data-view="leaderboard"]');
    await expect(page.locator('#view-leaderboard')).toBeVisible();
    // 혼잡도 맵
    await page.click('[data-view="congestion"]');
    await expect(page.locator('#view-congestion')).toBeVisible();
    // 마이페이지
    await page.click('[data-view="profile"]');
    await expect(page.locator('#view-profile')).toBeVisible();
    // AI 동선 추천
    await page.click('[data-view="route"]');
    await expect(page.locator('#view-route')).toBeVisible();
  });
});

// ═══════════════════════════════════════
// 2. 관리자 인증
// ═══════════════════════════════════════
test.describe('관리자 인증', () => {
  test('관리자 로그인 모달 표시', async ({ page }) => {
    await page.goto('/');
    await page.click('button:has-text("참가자")');
    await page.click('button:has-text("관리자")');
    await expect(page.locator('#adminLoginModal')).toHaveClass(/open/);
  });

  test('잘못된 비밀번호 오류', async ({ page }) => {
    await page.goto('/');
    await page.click('button:has-text("참가자")');
    await page.click('button:has-text("관리자")');
    await page.fill('#adminPasswordInput', 'wrong');
    await page.click('#adminLoginModal button:has-text("로그인")');
    await expect(page.locator('#adminLoginError')).toBeVisible();
  });

  test('올바른 비밀번호로 로그인 성공', async ({ page }) => {
    await page.goto('/');
    await page.click('button:has-text("참가자")');
    await page.click('button:has-text("관리자")');
    await page.fill('#adminPasswordInput', 'dreamfest2026');
    await page.click('#adminLoginModal button:has-text("로그인")');
    await expect(page.locator('#adminLogoutBtn')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#navAdmin')).toBeVisible();
  });

  test('로그아웃', async ({ page }) => {
    await page.goto('/');
    await page.click('button:has-text("참가자")');
    await page.click('button:has-text("관리자")');
    await page.fill('#adminPasswordInput', 'dreamfest2026');
    await page.click('#adminLoginModal button:has-text("로그인")');
    await expect(page.locator('#adminLogoutBtn')).toBeVisible({ timeout: 5000 });
    await page.click('#adminLogoutBtn');
    await expect(page.locator('#adminLogoutBtn')).toBeHidden();
    await expect(page.locator('#navParticipant')).toBeVisible();
  });
});

// ═══════════════════════════════════════
// 3. 서버 API
// ═══════════════════════════════════════
test.describe('서버 API', () => {
  test('통계 API 응답', async ({ request }) => {
    var res = await request.get('/api/stats');
    expect(res.ok()).toBeTruthy();
    var data = await res.json();
    expect(data).toHaveProperty('totalParticipants');
    expect(data).toHaveProperty('todayCheckins');
    expect(data).toHaveProperty('serverTime');
  });

  test('참가자 등록 및 조회', async ({ request }) => {
    var id = 'TEST-' + Date.now();
    var res = await request.post('/api/participants', {
      data: { id: id, nick: 'E2E테스트', school: '테스트학교' }
    });
    expect(res.status()).toBe(201);
    var p = await res.json();
    expect(p.nick).toBe('E2E테스트');

    var get = await request.get('/api/participants/' + id);
    expect(get.ok()).toBeTruthy();
    var found = await get.json();
    expect(found.id).toBe(id);
  });

  test('체크인 기록', async ({ request }) => {
    var pid = 'CHECKIN-' + Date.now();
    await request.post('/api/participants', {
      data: { id: pid, nick: '체크인테스트' }
    });

    var res = await request.post('/api/checkins', {
      data: { participantId: pid, progId: 5, participantName: '체크인테스트' }
    });
    expect(res.status()).toBe(201);
    var checkin = await res.json();
    expect(checkin.progId).toBe(5);
    expect(checkin.id).toMatch(/^CK-/);
  });

  test('스탬프 획득', async ({ request }) => {
    var pid = 'STAMP-' + Date.now();
    await request.post('/api/participants', {
      data: { id: pid, nick: '스탬프테스트' }
    });

    var res = await request.post('/api/stamps', {
      data: { participantId: pid, progId: 7 }
    });
    expect(res.ok()).toBeTruthy();
    var stamps = await res.json();
    expect(stamps.stamps).toContain(7);
  });

  test('리더보드 등록 및 조회', async ({ request }) => {
    var res = await request.post('/api/leaderboard/dance', {
      data: { nick: 'E2E댄서', score: 9999 }
    });
    expect(res.status()).toBe(201);

    var get = await request.get('/api/leaderboard/dance');
    var board = await get.json();
    expect(board.entries.length).toBeGreaterThan(0);
  });

  test('인증 없이 보호 엔드포인트 접근 차단', async ({ request }) => {
    var res = await request.put('/api/booths/1/status', {
      data: { status: 'active' }
    });
    expect(res.status()).toBe(401);
  });

  test('인증 후 보호 엔드포인트 접근 허용', async ({ request }) => {
    var login = await request.post('/api/auth/login', {
      data: { password: 'dreamfest2026' }
    });
    var token = (await login.json()).token;

    var res = await request.put('/api/booths/1/status', {
      headers: { 'Authorization': 'Bearer ' + token },
      data: { status: 'active', currentCount: 5 }
    });
    expect(res.ok()).toBeTruthy();
  });
});

// ═══════════════════════════════════════
// 4. 데이터 내보내기 API
// ═══════════════════════════════════════
test.describe('데이터 내보내기', () => {
  var token;

  test.beforeAll(async ({ request }) => {
    var login = await request.post('/api/auth/login', {
      data: { password: 'dreamfest2026' }
    });
    token = (await login.json()).token;
  });

  test('참가자 CSV 내보내기', async ({ request }) => {
    var res = await request.get('/api/export/participants', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    expect(res.ok()).toBeTruthy();
    var ct = res.headers()['content-type'];
    expect(ct).toContain('text/csv');
    var body = await res.text();
    expect(body).toContain('참가자ID');
    expect(body).toContain('닉네임');
  });

  test('체크인 CSV 내보내기', async ({ request }) => {
    var res = await request.get('/api/export/checkins', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    expect(res.ok()).toBeTruthy();
    var body = await res.text();
    expect(body).toContain('체크인ID');
  });

  test('스탬프 CSV 내보내기', async ({ request }) => {
    var res = await request.get('/api/export/stamps', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    expect(res.ok()).toBeTruthy();
    var body = await res.text();
    expect(body).toContain('스탬프수');
    expect(body).toContain('나의 몸을 읽는 AI');
  });

  test('리더보드 CSV 내보내기', async ({ request }) => {
    var res = await request.get('/api/export/leaderboard', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    expect(res.ok()).toBeTruthy();
    var body = await res.text();
    expect(body).toContain('카테고리');
  });

  test('전체 JSON 백업', async ({ request }) => {
    var res = await request.get('/api/export/all', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    expect(res.ok()).toBeTruthy();
    var data = await res.json();
    expect(data).toHaveProperty('participants');
    expect(data).toHaveProperty('checkins');
    expect(data).toHaveProperty('stamps');
    expect(data).toHaveProperty('exportedAt');
  });

  test('인증 없이 내보내기 차단', async ({ request }) => {
    var res = await request.get('/api/export/participants');
    expect(res.status()).toBe(401);
  });
});

// ═══════════════════════════════════════
// 5. 페이지 로드 테스트
// ═══════════════════════════════════════
test.describe('페이지 로드', () => {
  test('QR 체크인 페이지', async ({ page }) => {
    await page.goto('/qr-checkin.html');
    await expect(page).toHaveTitle(/QR|체크인/);
  });

  test('키오스크 페이지', async ({ page }) => {
    await page.goto('/kiosk.html');
    await expect(page).toHaveTitle(/키오스크|Kiosk/i);
  });

  test('인증서 페이지', async ({ page }) => {
    await page.goto('/certificates.html');
    await expect(page).toHaveTitle(/인증서/);
  });

  test('운영 매뉴얼 페이지', async ({ page }) => {
    await page.goto('/manual.html');
    await expect(page).toHaveTitle(/매뉴얼|운영/);
  });

  var programs = [
    { file: '01-ai-body-scanner.html', name: '나의 몸을 읽는 AI' },
    { file: '02-smart-fitness-trainer.html', name: 'AI 운동 코치' },
    { file: '03-dance-battle-ai.html', name: '댄스 AI 챌린지' },
    { file: '04-ai-vision-explorer.html', name: '물건을 알아보는 AI' },
    { file: '05-ai-safety-guardian.html', name: 'AI 안전 감시관' },
    { file: '06-train-your-own-ai.html', name: 'AI 분류 챌린지' },
    { file: '07-my-ai-avatar.html', name: 'AI 아바타 스튜디오' },
    { file: '08-ai-music-video.html', name: 'AI 뮤직비디오' },
    { file: '09-prompt-art-challenge.html', name: '프롬프트 아트' },
    { file: '10-ai-doctor.html', name: 'AI 의사' },
    { file: '11-smart-farm.html', name: '스마트팜' },
    { file: '12-self-driving-sim.html', name: '자율주행' },
    { file: '13-ai-career-matcher.html', name: 'AI 직업' },
    { file: '14-visual-coding-lab.html', name: '비주얼 코딩' },
    { file: '15-tech-mentor-talk.html', name: '멘토링' },
  ];

  for (var prog of programs) {
    test('프로그램: ' + prog.name, async ({ page }) => {
      var res = await page.goto('/programs/' + prog.file);
      expect(res.status()).toBe(200);
    });
  }
});

// ═══════════════════════════════════════
// 6. 서버 연결 및 WebSocket
// ═══════════════════════════════════════
test.describe('서버 연결', () => {
  test('sync-client 서버 감지 및 상태 표시', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);
    var badge = page.locator('#sync-status');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText(/Server Connected/i);
  });

  test('WebSocket 연결', async ({ page }) => {
    await page.goto('/');
    var wsConnected = await page.evaluate(async () => {
      return new Promise((resolve) => {
        var ws = new WebSocket('ws://localhost:3000/ws');
        ws.onopen = () => { ws.close(); resolve(true); };
        ws.onerror = () => resolve(false);
        setTimeout(() => resolve(false), 5000);
      });
    });
    expect(wsConnected).toBeTruthy();
  });
});

// ═══════════════════════════════════════
// 7. 데이터 내보내기 UI
// ═══════════════════════════════════════
test.describe('내보내기 UI', () => {
  test('통계 뷰에 내보내기 드롭다운 표시', async ({ page }) => {
    await page.goto('/');
    await page.click('[data-view="stats"]');
    var btn = page.locator('#exportBtn');
    await expect(btn).toBeVisible();
    await btn.click();
    var menu = page.locator('#exportMenu');
    await expect(menu).toBeVisible();
    await expect(menu.locator('button')).toHaveCount(7);
  });
});
