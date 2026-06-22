<div align="center">

# Icon Maker

**하나의 deterministic config에서 출시용 아이콘 세트를 생성합니다.**

앱 아이콘 · 확장 아이콘 · connector 로고 · PWA 아이콘 · SVG 원본. 한 번에 생성.

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
  `@starter-series/icon-maker`는 npm에 publish되지 않았습니다. 아래 명령은
  로컬 개발 경로와 npm 릴리즈 이후 설치 경로를 분리합니다.
- **현재 구현됨** — deterministic icon compiler. 하나의 설정에서 SVG 원본과 PNG 세트를 만들고, `browser-extension`, `expo`, `electron`, `vscode`, `pwa`, `mcp-connector`, `generic` target을 지원합니다. 완성된 custom SVG source도 PNG/ICO/ICNS로 rasterize할 수 있고, preview contact sheet도 생성합니다. CLI(`icon-maker`)는 `--json`, 선택적 `path`, target 자동 감지, `--dry-run`, `--out-dir`, `--preview`, 선택적 manifest patch를 지원합니다. 프로그램 API(`makeIcons()`), Claude Code skill(`skills/create-icons/`), plugin metadata(`icon-maker@starter-series`)도 포함합니다.
- **설계 의도** — 아이콘 의도는 프로젝트별 결정이므로 `icon-maker.config.js`에 둡니다. 플랫폼별 파일명과 manifest 연결은 도구가 기계적으로 처리합니다.
- **하지 않기로 한 것** — AI 로고 생성, 브랜딩 전략, 맞춤 일러스트 polish. v1은 starter-layer compiler입니다.

## 로컬 사용

```bash
npm install
node bin/icon-maker.js --init
node bin/icon-maker.js --target auto --json
node bin/icon-maker.js --target browser-extension --patch
node bin/icon-maker.js --target auto --preview
```

## npm 릴리즈 이후

```bash
npm i -D @starter-series/icon-maker
npx @starter-series/icon-maker --target auto --json
```

## 설정

`icon-maker.config.js`:

```js
module.exports = {
  project: {
    name: 'My App',
    slug: 'my-app',
  },
  mark: {
    glyph: 'braces',       // braces | spark | bolt
    shape: 'squircle',     // squircle | circle | square
    background: '#111827',
    foreground: '#f8fafc',
    accent: '#38bdf8',
    radius: 0.24,
    // 완성된 SVG 원본을 사용할 때:
    // source: './assets/source-icon.svg',
  },
  targets: ['auto'],
};
```

## Target

| Target | Outputs |
|---|---|
| `browser-extension` | `assets/icons/icon16.png`, `icon32.png`, `icon48.png`, `icon128.png`, `icon.svg` |
| `expo` | `assets/icon.png`, 투명 foreground `assets/adaptive-icon.png`, `assets/icon.svg` |
| `electron` | `assets/icon.png`, `assets/icon.ico`, `assets/icon.icns`, `assets/icon.svg` |
| `vscode` | `assets/icon.png` (256), `assets/icon.svg` |
| `pwa` | `public/icon-192.png`, `public/icon-512.png`, `public/favicon.ico`, `public/favicon.svg` |
| `mcp-connector` | `assets/icon.png` (1024), `assets/icon-512.png`, `assets/icon.svg` |
| `generic` | `assets/icon.png`, `assets/icon.svg` |

`--patch`를 주면 존재하는 manifest/config를 찾아 icon 경로를 갱신합니다.

`mark.source`에 완성된 SVG 파일을 지정하면 SVG 출력은 원본을 복사하고,
PNG/ICO/ICNS 출력은 `@resvg/resvg-js`로 rasterize합니다. `--preview`는
`icon-preview.html` contact sheet를 만들어 작은 사이즈와 투명 배경을 빠르게
확인하게 해줍니다.

v1에는 MCP 서버를 넣지 않았습니다. 아이콘 생성은 파일을 쓰는 로컬 작업이라 `--json` CLI와 skill 조합이 더 단순하고 안정적입니다.
