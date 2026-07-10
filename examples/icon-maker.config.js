module.exports = {
  project: {
    name: 'Starter App',
    slug: 'starter-app',
    description: 'A reusable starter application',
  },
  mark: {
    glyph: 'braces',
    shape: 'squircle',
    background: '#111827',
    foreground: '#f8fafc',
    accent: '#38bdf8',
    radius: 0.24,
    // source: { default: './brand/icon.svg', adaptiveForeground: './brand/icon-adaptive.svg' },
  },
  // apple: { assetCatalog: './StarterApp/Assets.xcassets', appIconSet: 'AppIcon' },
  targets: ['browser-extension'],
};
