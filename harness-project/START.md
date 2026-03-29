# 실행 방법

## 프로젝트 구조

```
harness-project/
├── CLAUDE.md                      ← 오케스트레이터 (Claude Code가 자동으로 읽음)
├── agents/
│   ├── evaluation_criteria.md     ← 공용 평가 기준
│   ├── planner.md                 ← Planner 서브에이전트 지시서
│   ├── generator.md               ← Generator 서브에이전트 지시서
│   └── evaluator.md               ← Evaluator 서브에이전트 지시서
├── output/                        ← 생성 결과물이 저장되는 폴더
├── SPEC.md                        ← Planner가 생성 (실행 후 생김)
├── SELF_CHECK.md                  ← Generator가 생성 (실행 후 생김)
├── QA_REPORT.md                   ← Evaluator가 생성 (실행 후 생김)
└── START.md                       ← 지금 이 파일
```

---

## 실행 방법

### 1단계: 이 폴더에서 Claude Code를 실행합니다

```bash
cd harness-project
claude
```

Claude Code가 CLAUDE.md를 자동으로 읽고 오케스트레이터 역할을 합니다.

### 2단계: 프롬프트 한 줄을 입력합니다

```
AI 교육 전문 회사 사용성연구소의 랜딩페이지를 만들어줘
```

이것만 치면 됩니다.
CLAUDE.md의 지시에 따라 자동으로:

1. Planner 서브에이전트가 SPEC.md를 생성합니다
2. Generator 서브에이전트가 output/index.html을 생성합니다
3. Evaluator 서브에이전트가 QA_REPORT.md를 생성합니다
4. 불합격이면 Generator가 피드백을 반영하여 재작업합니다
5. 합격이면 완료 보고가 나옵니다

### 3단계: 결과를 확인합니다

```bash
open output/index.html
```

---

## 다른 과제에 적용하기

프롬프트만 바꾸면 됩니다:

```
브라우저에서 돌아가는 포모도로 타이머 앱을 만들어줘
```

```
개인 포트폴리오 웹사이트를 만들어줘
```

```
온라인 투표 시스템을 만들어줘
```

agents/ 폴더의 지시서는 수정 없이 그대로 사용 가능합니다.
디자인 기준을 바꾸고 싶으면 agents/evaluation_criteria.md만 수정하세요.

---

## Solo 비교 실험을 하고 싶다면

하네스 없이 Solo로 실행한 결과를 비교하고 싶으면:

```bash
# 다른 폴더에서 Claude Code 실행 (CLAUDE.md가 없는 곳)
mkdir solo-test && cd solo-test
claude

# 같은 프롬프트 입력
> AI 교육 전문 회사 사용성연구소의 랜딩페이지를 만들어줘. HTML/CSS/JS 단일 파일로.
```

Solo 결과와 하네스 결과를 나란히 열어 비교하면 차이가 명확히 보입니다.
