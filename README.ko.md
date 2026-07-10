<div align="center">

# Icon Maker

**하나의 디자인을 배포용 아이콘과 프로젝트 연결 정보로 컴파일합니다.**

Xcode Asset Catalog · 앱 아이콘 · 확장 manifest · package 아이콘 · PWA 아이콘. 하나의 컴파일러.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node >= 22](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](.nvmrc)

[English](README.md) | **한국어**

</div>

---

> **[Starter Series](https://github.com/starter-series)**의 launch tooling입니다. `icon-maker`는 `shotkit`과 짝을 이루는 identity asset 도구입니다. 아이콘 세트를 먼저 만들고, 그 다음 빌드된 제품에서 store/social asset을 캡처합니다.

---

## 상태와 범위

- **Pre-release** — 패키지는 구현되어 있고 `npm pack --dry-run`까지
  통과하며 public source repo로도 열려 있습니다. 다만 아직
  `iconkit`은 npm에 publish되지 않았습니다. 아래 명령은
  로컬 개발 경로와 npm 릴리즈 이후 설치 경로를 분리합니다.
- **현재 구현됨** — 특정 디자인 공급자에 종속되지 않는 배포용 아이콘
  컴파일러입니다. 구조화된 이미지 생성/source 요청, 명시적 승인 단계,
  SVG/PNG 직접 전달, Xcode용 Apple AppIcon catalog, `apple`,
  `browser-extension`, `expo`, `electron`,
  `vscode`, `pwa`, `mcp-connector`, `generic` target, ICO/ICNS, preview,
  target 자동 감지, JSON 출력, 선택적 manifest/package patch를 지원합니다.
- **설계 의도** — 아이콘 의도는 프로젝트별 결정이므로 `icon-maker.config.js` 또는 데이터 전용 `icon-maker.config.json`에 둡니다. 플랫폼별 파일명과 manifest 연결은 도구가 기계적으로 처리합니다.
- **하지 않기로 한 것** — 오프라인 CLI는 AI 로고 생성, 브랜딩 전략,
  맞춤 일러스트를 직접 소유하지 않습니다. 에이전트는 상류에서 사용 가능한
  이미지 모델을 호출할 수 있지만, 승인된 프로젝트 로컬 SVG/PNG만
  컴파일러에 전달합니다.

## 로컬 사용

```bash
npm install
node bin/icon-maker.js --brief --target apple,browser-extension,pwa
node bin/icon-maker.js --placeholder --target auto --dry-run --json
node bin/icon-maker.js --placeholder --target generic --out-dir .tmp-icon-preview --preview --json
rm -rf .tmp-icon-preview
```

brief 명령은 파일을 쓰지 않고 상류 이미지 생성/source 요청을 출력합니다.
나머지 명령은 임시 artwork임을 `--placeholder`로 명시한 뒤 target detection,
preview, JSON contract를 검증합니다.

## npm 릴리즈 이후

```bash
npm i -D iconkit
npx iconkit --source ./brand/icon.png --target auto --json
```

## 설정

### 이미지 생성 모델에서 source 받기

먼저 상류 이미지 모델이나 디자인 공급자에 전달할 구조화된 요청을 생성합니다.

```bash
node bin/icon-maker.js --brief --target apple,browser-extension,pwa
```

에이전트 환경에서는 create-icons skill이 사용 가능한 이미지 생성 도구에 이
요청을 전달하고, 후보 이미지를 보여준 뒤 명시적 승인을 기다립니다. CLI 자체는
오프라인이며 모델을 호출하지 않습니다. 승인된 PNG를 프로젝트 안에서 바로
컴파일합니다.

```bash
node bin/icon-maker.js --source ./brand/icon.png \
  --target apple,browser-extension,pwa \
  --preview --json
```

`icon-preview.html`을 확인한 뒤 manifest/package 연결을 별도 실행합니다.

```bash
node bin/icon-maker.js --source ./brand/icon.png \
  --target apple,browser-extension,pwa \
  --patch --json
```

npm 공개 이후에는 `node bin/icon-maker.js` 대신 `npx iconkit`을 사용합니다.

`--source`는 대상 프로젝트를 기준으로 해석되며 그 디렉터리 밖의 파일은
거부합니다. 이미지 생성 결과는 정사각형 1024×1024 이상 PNG를 권장하고,
디자인 도구가 만든 native vector SVG도 허용합니다. 더 작거나 정사각형이 아닌
PNG에는 구조화된 경고가 반환됩니다. `--out-dir`도 대상 프로젝트 안에서만
사용할 수 있습니다.

승인된 source 없이 컴파일하면 오류로 중단합니다. 결정론적 임시 artwork가
필요할 때만 `--placeholder`를 명시하며, 결과에도 경고가 포함됩니다.

Expo 기본 원본이 불투명하다면 투명 adaptive foreground를 별도로 지정합니다.

```bash
node bin/icon-maker.js --source ./brand/icon.png \
  --adaptive-source ./brand/icon-adaptive.png \
  --target expo --preview --json
```

### 프로젝트에 의도를 유지하는 설정

`icon-maker.config.js`:

```js
module.exports = {
  project: {
    name: 'My App',
    slug: 'my-app',
    description: '제품이 누구를 위해 어떤 일을 하는지',
  },
  placeholder: false,
  mark: {
    source: {
      default: './brand/icon.png',
      adaptiveForeground: './brand/icon-adaptive.png',
    },
    // 투명 원본을 Apple용으로 flatten할 때 사용:
    background: '#111827',
  },
  // Xcode 경로가 모호하거나 새 set이 필요할 때만 명시:
  // apple: {
  //   assetCatalog: './MyApp/Assets.xcassets',
  //   appIconSet: 'AppIcon',
  // },
  targets: ['auto'],
};
```

starter용 임시 artwork는 `placeholder: true`를 명시한 뒤 `mark.glyph`,
`shape`, 색상을 설정합니다. `mark.source`가 없다는 이유만으로 placeholder
mode가 자동 선택되지는 않습니다.

신뢰하지 않는 target checkout에서는 `icon-maker.config.json`을 권장합니다.
자동 탐지는 JSON 설정을 먼저 읽고, target repo의 `icon-maker.config.js`는
`--config`로 명시하지 않는 한 자동 실행하지 않습니다.

## Target

| Target | Outputs |
|---|---|
| `apple` | 감지한 Xcode App Icon set: RGB iOS 1024 원본, macOS 전체 크기, `Contents.json` |
| `browser-extension` | `assets/icons/icon16.png`, `icon32.png`, `icon48.png`, `icon128.png`, `icon.svg` |
| `expo` | `assets/icon.png`, 투명 foreground `assets/adaptive-icon.png`, `assets/icon.svg` |
| `electron` | `assets/icon.png`, `assets/icon.ico`, `assets/icon.icns`, `assets/icon.svg` |
| `vscode` | `assets/icon.png` (256), `assets/icon.svg` |
| `pwa` | `public/icon-192.png`, `public/icon-512.png`, `public/favicon.ico`, `public/favicon.svg` |
| `mcp-connector` | `assets/icon.png` (1024), `assets/icon-512.png`, `assets/icon.svg` |
| `generic` | `assets/icon.png`, `assets/icon.svg` |

`--patch`를 주면 존재하는 manifest/config를 찾아 icon 경로를 갱신합니다.
대상 파일이 없으면 JSON 결과에 `patch-target-missing` 경고가 포함됩니다.
먼저 `--preview`로 생성물을 검토한 뒤 별도 명령에서 patch하는 흐름을 권장합니다.

일회성 전달에는 `--source`, 프로젝트 설정에 경로를 유지하려면
`mark.source`를 사용합니다. SVG 출력은 SVG 원본을 유지하고, PNG 입력은
SVG wrapper에 포함합니다. PNG/ICO/ICNS 및 Apple 출력은
`@resvg/resvg-js`로 정사각형 캔버스에 contain 방식으로 rasterize합니다.
원본은 대상 디렉터리 안에 있어야 합니다.
`--preview`는 `icon-preview.html` contact sheet를 만들어 작은 사이즈와 투명
배경을 빠르게 확인하게 해줍니다.

SVG 출력은 정확한 Markdown fence가 있으면 이를 제거한 뒤 원본을 유지합니다.
별도 sanitize를 하지 않으므로 script나 event handler가 포함된 SVG도 브라우저에서
활성화될 수 있습니다. 직접 작성했거나 신뢰하는 SVG만 입력해야 합니다.

정확히 하나의 Markdown fenced SVG code block은 자동으로 fence를 제거합니다.
fence 바깥에 설명문이 섞인 응답은 거부합니다. 원본 경로는 생성 출력과
preview 출력에 겹칠 수 없고, 출력 경로나 symlink는 대상 프로젝트 밖으로 나갈
수 없습니다. 여러 target이 같은 경로에 서로 다른 파일을 요구하면 `--out-dir`로
target 출력을 분리해야 합니다.

## Apple과 Xcode

`apple` target은 iOS와 macOS에서 Xcode가 컴파일할 수 있는 하나의 App Icon
set을 생성합니다. `project.pbxproj`의 `ASSETCATALOG_COMPILER_APPICON_NAME`이
하나로 명확하면 그 이름을 사용하고 Preview 전용 catalog는 제외합니다.
production Asset Catalog가 정확히 하나면 그 위치에 기록합니다. 하나도 없으면
루트에 `Assets.xcassets`를 만들고 Xcode에 추가해야 할 수 있다는 경고를
냅니다. catalog나 App Icon 이름이 여러 개면 추측하지 않고 중단합니다.

```js
module.exports = {
  apple: {
    assetCatalog: './MyApp/Assets.xcassets',
    appIconSet: 'AppIcon',
  },
  targets: ['apple'],
};
```

명시한 catalog는 이미 존재해야 합니다. 기존 App Icon set이 icon-maker가
소유하지 않은 파일을 참조하면 덮어쓰지 않고 새 `apple.appIconSet` 이름을
요구합니다. 빈 appearance slot과 metadata는 보존합니다. 외부 Apple 원본은
`mark.background` 위에 flatten하고, Apple PNG는 alpha channel이 없는 RGB로
인코딩합니다. 레이어 기반 Icon Composer 편집은 상류 디자인 단계입니다.

## Agent Surfaces

- 현재 source checkout: `node /path/to/icon-maker/bin/icon-maker.js <path> --source ./brand/icon.png --target auto --json`
- 상류 source 요청: `node /path/to/icon-maker/bin/icon-maker.js <path> --brief --target apple,pwa --json`
- npm 릴리즈 이후 공개 CLI: `npx iconkit <path> --source ./brand/icon.png --target auto --json`
- Skill: [`skills/create-icons/SKILL.md`](skills/create-icons/SKILL.md)
- Source plugin metadata: [`.claude-plugin/plugin.json`](.claude-plugin/plugin.json)

v1에는 MCP 서버를 넣지 않았습니다. 오프라인 JSON CLI와, 사용 가능한 이미지
공급자에서 후보를 받은 뒤 승인 이후에만 컴파일러를 호출하는 skill 조합을
사용합니다.

## 개발

```bash
npm install
npm run lint
npm test
npm run pack:install-smoke
npm run xcode:smoke # macOS/Xcode 전용
```
