# 고도화 TODO 검수

2026-08-28 기준. 과거 작업 기록의 AI 제안 목록을 현재 코드와 대조한
검수표이며, 제안 전체가 확정된 제품 요구사항이라는 의미는 아닙니다.
npm 최초 발행은 이번 검수 범위에서 제외합니다.

**판정: 큰 작업 축 6개 중 5개는 부분 구현, Studio는 미구현입니다.**
기본 delivery CLI가 동작하는 것과 전체 고도화 계획을 완료한 것은 다릅니다.
작업 크기가 다른 항목을 동일 가중치로 세어 완료율을 만들지 않습니다.

| 작업 축 | 구현된 범위 | 남은 범위 |
|---|---|---|
| Android | 5개 density, legacy/round/adaptive PNG, v26/v33 XML, 별도 monochrome, manifest 패치 | Play Store 512px 별도 출력, 프레임워크별 실제 프로젝트 빌드 검증 |
| Apple | iOS/macOS legacy catalog, RGB 출력, `.icon` 감지·읽기 전용 구조 검사, 명시적 delivery mode | Dark/Tinted artwork 생성, watchOS 등 추가 타깃, Composer 복사·Xcode 자동 연결, marketing export |
| PWA/favicon | any/maskable/monochrome 역할, public/www manifest 탐색·패치, ICO/SVG favicon | Apple touch, pinned tab, tiles, splash, light/dark, HTML/meta 연결, 프레임워크 adapter, 실제 페이지 검사 |
| Local Studio | 정적 contact sheet만 있음 | 드래그앤드롭, crop/padding/background 편집, 마스크·안전 영역 preview, 적용 전 diff, ZIP |
| Check/doctor | 읽기 전용 `--check --strict`, 파일/PNG/SVG/container/슬롯/지원 wiring 검사 | doctor, HTML 검사, 원본/config 대비 최신성 검사, 플랫폼 도구를 이용한 추가 빌드 검증 |
| 결정론·안전성 | 경로 containment, 원본 충돌 방지, 렌더 후 일괄 쓰기, 실패 롤백, 동일 바이트 재쓰기 방지 | provenance/hash manifest, stale/drift, 전체 managed asset 소유권, 적용 전 diff, crash recovery |

## 이번 검수에서 수정한 결함

- 손상된 SVG/PNG 원본을 data URL로 감싸면서 빈 아이콘으로 조용히 렌더링할 수 있던 문제.
- SVG 시작 태그만으로 유효성을 판정하던 `--check`.
- `null` 등 비객체 JSON manifest를 건너뛰거나 TypeError로 종료하던 검사 경로.
- Apple 파일명만 비교하여 잘못된 idiom/platform/size/scale/appearance 슬롯을 놓치던 검사.
- 올바른 PWA wiring도 JSON 서식이 다르면 오류로 보고 파일을 다시 쓰던 문제.
- `--out-dir` 검사에서 최종 프로젝트 경로를 읽어 staged optional role 손상을 놓치던 문제.
- 완전히 투명한 adaptive/monochrome foreground를 정상으로 인정하던 문제.
- 외부 electron-builder 설정이 있는데 `package.json.build`를 새로 만들어 설정 선택을 바꿀 수 있던 문제.
- Icon Composer layer의 존재만 확인하여 손상된 PNG/SVG를 통과시키던 문제.
- brief JSON에 선택적 maskable/round/monochrome 역할이 빠져 있던 계약 누락.
- maintenance CI를 실패시키던 개발용 transitive `brace-expansion` 취약점.
- Windows에서 읽기 전용 staging 핸들을 fsync해 모든 쓰기가 실패하던 문제.
  exclusive 쓰기 핸들을 생성부터 flush까지 유지하도록 수정했습니다.

각 동작 결함은 기존 테스트 파일에 회귀 사례를 추가하거나 확장해 검증합니다.
외부 builder 설정 선택은 [electron-builder의 config loader](https://github.com/electron-userland/electron-builder/blob/master/packages/app-builder-lib/src/util/config/load.ts)를 확인했습니다.

## 검증 범위와 한계

- lint 및 전체 테스트 191개 통과, packed-install CLI/API smoke 통과.
- Apple legacy 출력은 Xcode `actool`의 iphoneos/macOS 컴파일 통과.
- 9개 타깃의 실제 CLI 생성·preview·지원 patch·`--check --strict` 통과.
  총 64개 산출물의 검사 오류·경고는 0이며, 재실행 시 산출물·preview·patch
  재쓰기가 없음을 확인했습니다. 이 검증은 격리된 테스트 프로젝트 기준입니다.
- npm audit 취약점 0건.
- Android APK 빌드/실기기 launcher, Electron 앱 패키징, 브라우저/PWA 설치까지는 미검증입니다.
- Icon Composer의 구조·참조 검사와 Apple 네이티브 Composer 컴파일은 다릅니다.
  공식 도구의 전체 schema/appearance 렌더링 검증을 대체하지 않습니다.
- rollback은 포착한 쓰기 실패에 대한 복구입니다. 전원 차단·강제 종료 복구와
  동시 독자에 대한 다중 파일 원자성은 보장하지 않습니다.
- `--check`는 구조상 유효한 오래된 아이콘을 찾아내지 못합니다. 원본/config
  변경과 산출물의 관계를 증명할 provenance·drift 검사가 아직 없습니다.

## 별도 제안: 접근성 검토

자동 판정과 사람의 시각 검토를 구분하는 결과 계약, 실제 16~48px·배경·회색조·
플랫폼 마스크·안전 영역 preview, 의미 이름 누락 검사, 검토 증거 파일은
아직 구현되지 않았습니다. foreground의 빈 alpha 검사는 구현했지만 이것만으로
작은 크기에서의 식별성이나 앱의 접근성을 증명할 수 없습니다.
