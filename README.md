# Google Calendar Widget

구글 캘린더를 작은 상시 표시 창처럼 띄우는 Electron 앱이다.
허세 말고 실용으로 만들었다.

## 기능
- 작은 창
- 항상 위(always on top)
- 구글 캘린더의 **비공개 ICS URL**로 일정 표시
- 새로고침 주기 조절
- 표시할 일정 수 조절

## 준비물
- Node.js LTS 설치
- Google Calendar의 비공개 iCal 주소

## 실행 방법

### 1) 압축 해제 후 폴더 열기
터미널 또는 PowerShell에서 폴더로 이동

### 2) 의존성 설치
```bash
npm install
```

### 3) 앱 실행
```bash
npm start
```

## Google Calendar 비공개 ICS URL 찾기
Google Calendar 웹:
설정 → 내 캘린더 선택 → **캘린더 통합** → **비공개 주소의 iCal 형식**

그 URL을 앱 설정에 넣으면 됨.

## 주의
- 비공개 ICS URL은 말 그대로 비공개다. 남한테 주지 마.
- 이 앱은 CORS 우회를 위해 `allorigins`를 사용한다. 아주 엄밀한 프로덕션 구조는 아니다.
- 필요하면 나중에 로컬 프록시 방식으로 바꿀 수 있다.

## 다음 개선 포인트
- 트레이 아이콘
- 투명 배경
- 클릭 시 Google Calendar 웹 열기
- 윈도우 시작 시 자동 실행
- 더 예쁜 UI
