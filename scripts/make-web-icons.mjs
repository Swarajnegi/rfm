// Home-screen icons for the web app, composed from the Android adaptive-icon
// foreground on the launcher's own background colour. iOS shows a transparent
// icon on black, so every size is rendered opaque. Re-run after the icon art
// changes:  node scripts/make-web-icons.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const fg = 'data:image/png;base64,' + readFileSync('android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png').toString('base64');
const bg = /#[0-9A-Fa-f]{6}/.exec(readFileSync('android/app/src/main/res/values/ic_launcher_background.xml', 'utf8'))[0];
const b = await chromium.launch();
const p = await b.newPage();
for (const [size, name] of [[180, 'apple-touch-icon.png'], [192, 'icon-192.png'], [512, 'icon-512.png'], [512, 'icon-maskable-512.png']]) {
    // The adaptive foreground already keeps its art inside the safe zone, so
    // the same composition serves as the maskable icon.
    await p.setViewportSize({ width: size, height: size });
    await p.setContent(`<body style="margin:0;background:${bg}"><img src="${fg}" style="width:${size}px;height:${size}px;display:block"></body>`);
    await p.screenshot({ path: `web/icons/${name}`, clip: { x: 0, y: 0, width: size, height: size } });
}
await b.close();
console.log('icons written to web/icons/');
