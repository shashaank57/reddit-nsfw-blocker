const fs = require('fs');
const path = require('path');

// Simple script to generate SVG icons and ensure directory exists
const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

function getSVG(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="#FF4500" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
  <rect width="24" height="24" rx="5" fill="#161B22"/>
  <circle cx="12" cy="12" r="8" stroke="#FF4500" stroke-width="2"/>
  <line x1="6.34" y1="6.34" x2="17.66" y2="17.66" stroke="#FF4500" stroke-width="2"/>
</svg>`;
}

[16, 48, 128].forEach(size => {
  fs.writeFileSync(path.join(iconsDir, `icon${size}.svg`), getSVG(size));
});

console.log('Icons generated successfully!');
