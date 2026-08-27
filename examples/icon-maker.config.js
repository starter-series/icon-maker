module.exports = {
  placeholder: true,
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
    // source: {
    //   default: './brand/icon.png',
    //   adaptiveForeground: './brand/icon-adaptive.png',
    //   maskable: './brand/icon-maskable.png',
    //   round: './brand/icon-round.png',
    //   monochrome: './brand/icon-monochrome.png',
    // },
  },
  // apple: {
  //   deliveryMode: 'legacy',
  //   assetCatalog: './StarterApp/Assets.xcassets',
  //   appIconSet: 'AppIcon',
  // },
  // android: { manifest: './app/src/main/AndroidManifest.xml' },
  // pwa: { manifest: './public/manifest.webmanifest' },
  targets: ['browser-extension'],
};
