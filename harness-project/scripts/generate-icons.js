const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ICONS_DIR = path.join(__dirname, '..', 'output', 'icons');
const SVG_PATH = path.join(ICONS_DIR, 'icon.svg');
const svgContent = fs.readFileSync(SVG_PATH, 'utf8');

const SIZES = [72, 96, 128, 144, 152, 192, 384, 512];

// Apple splash screen sizes (width x height)
const SPLASH_SIZES = [
  { w: 1170, h: 2532, name: 'iphone-13' },      // iPhone 13/14
  { w: 1284, h: 2778, name: 'iphone-13-pro-max' }, // iPhone 13/14 Pro Max
  { w: 1179, h: 2556, name: 'iphone-14-pro' },   // iPhone 14 Pro
  { w: 1290, h: 2796, name: 'iphone-14-pro-max' }, // iPhone 14 Pro Max
  { w: 2048, h: 2732, name: 'ipad-pro-12' },     // iPad Pro 12.9
  { w: 1668, h: 2388, name: 'ipad-pro-11' },     // iPad Pro 11
  { w: 1620, h: 2160, name: 'ipad-10' },         // iPad 10th gen
];

async function main() {
  var browser = await chromium.launch();
  var page = await browser.newPage();

  // Generate PNG icons
  for (var size of SIZES) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`
      <html><body style="margin:0;padding:0;background:transparent">
        <div style="width:${size}px;height:${size}px">
          ${svgContent.replace('viewBox="0 0 512 512"', `viewBox="0 0 512 512" width="${size}" height="${size}"`)}
        </div>
      </body></html>
    `);
    await page.screenshot({
      path: path.join(ICONS_DIR, `icon-${size}x${size}.png`),
      type: 'png',
      omitBackground: true,
    });
    console.log(`  icon-${size}x${size}.png`);
  }

  // Generate maskable icon (with padding)
  var maskSize = 512;
  await page.setViewportSize({ width: maskSize, height: maskSize });
  await page.setContent(`
    <html><body style="margin:0;padding:0;background:#2D7A4F">
      <div style="width:${maskSize}px;height:${maskSize}px;display:flex;align-items:center;justify-content:center;background:#2D7A4F">
        <div style="width:${Math.floor(maskSize * 0.8)}px;height:${Math.floor(maskSize * 0.8)}px">
          ${svgContent.replace('viewBox="0 0 512 512"', `viewBox="0 0 512 512" width="${Math.floor(maskSize * 0.8)}" height="${Math.floor(maskSize * 0.8)}"`)}
        </div>
      </div>
    </body></html>
  `);
  await page.screenshot({
    path: path.join(ICONS_DIR, 'icon-maskable-512x512.png'),
    type: 'png',
  });
  console.log('  icon-maskable-512x512.png');

  // Generate Apple splash screens
  for (var splash of SPLASH_SIZES) {
    await page.setViewportSize({ width: splash.w, height: splash.h });
    await page.setContent(`
      <html><body style="margin:0;padding:0;background:linear-gradient(135deg,#2D7A4F,#1B5E3A);width:${splash.w}px;height:${splash.h}px;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:sans-serif">
        <div style="width:160px;height:160px;margin-bottom:40px">
          ${svgContent.replace('viewBox="0 0 512 512"', 'viewBox="0 0 512 512" width="160" height="160"')}
        </div>
        <div style="color:white;font-size:32px;font-weight:700;letter-spacing:1px;margin-bottom:12px">꿈-드림 페스티벌</div>
        <div style="color:rgba(255,255,255,0.7);font-size:18px;font-weight:400">미래기술존 운영 시스템</div>
        <div style="position:absolute;bottom:60px;display:flex;gap:12px">
          <div style="width:12px;height:12px;border-radius:50%;background:#E8705A"></div>
          <div style="width:12px;height:12px;border-radius:50%;background:#D4943A"></div>
          <div style="width:12px;height:12px;border-radius:50%;background:#2BA5B3"></div>
          <div style="width:12px;height:12px;border-radius:50%;background:#6BAF3A"></div>
          <div style="width:12px;height:12px;border-radius:50%;background:#8B6FC0"></div>
        </div>
      </body></html>
    `);
    await page.screenshot({
      path: path.join(ICONS_DIR, `splash-${splash.name}.png`),
      type: 'png',
    });
    console.log(`  splash-${splash.name}.png`);
  }

  await browser.close();
  console.log('\nDone! Generated', SIZES.length, 'icons + 1 maskable +', SPLASH_SIZES.length, 'splash screens');
}

main().catch(console.error);
