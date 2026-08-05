const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT_DIR, 'src');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const STAGE_DIR = path.join(DIST_DIR, 'staging');

function log(msg) {
  console.log(`[BUILD] ${msg}`);
}

function copyRecursiveSync(src, dest) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();

  if (isDirectory) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    fs.readdirSync(src).forEach((childItemName) => {
      copyRecursiveSync(
        path.join(src, childItemName),
        path.join(dest, childItemName)
      );
    });
  } else if (exists) {
    const destDir = path.dirname(dest);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    fs.copyFileSync(src, dest);
  }
}

function createZipArchive(stageDir, outputZipPath) {
  if (process.platform === 'win32') {
    const psScript = [
      `Add-Type -AssemblyName System.IO.Compression;`,
      `Add-Type -AssemblyName System.IO.Compression.FileSystem;`,
      `if (Test-Path '${outputZipPath}') { Remove-Item '${outputZipPath}' -Force };`,
      `$zip = [System.IO.Compression.ZipFile]::Open('${outputZipPath}', [System.IO.Compression.ZipArchiveMode]::Create);`,
      `$files = Get-ChildItem -Path '${stageDir}' -Recurse -File;`,
      `foreach ($file in $files) {`,
      `  $relPath = $file.FullName.Substring('${stageDir}'.Length + 1).Replace('\\', '/');`,
      `  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $relPath);`,
      `};`,
      `$zip.Dispose();`
    ].join(' ');

    execSync(`powershell -Command "${psScript}"`, { stdio: 'inherit' });
  } else {
    execSync(`cd "${stageDir}" && zip -r "${outputZipPath}" .`, { stdio: 'inherit' });
  }
}

function build() {
  log('Starting build process...');

  const baseManifestPath = path.join(SRC_DIR, 'manifest.json');
  if (!fs.existsSync(baseManifestPath)) {
    throw new Error('src/manifest.json not found!');
  }
  const baseManifest = JSON.parse(fs.readFileSync(baseManifestPath, 'utf8'));
  const version = baseManifest.version || '1.0.0';
  log(`Detected extension version: v${version}`);

  if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(DIST_DIR, { recursive: true });

  // 1. Firefox Build Target
  log('Building Firefox release package...');
  const ffStage = path.join(STAGE_DIR, 'firefox');
  copyRecursiveSync(SRC_DIR, ffStage);
  
  // Firefox Manifest Optimization
  const ffManifest = JSON.parse(JSON.stringify(baseManifest));
  ffManifest.background = { scripts: ['background.js'] };
  fs.writeFileSync(path.join(ffStage, 'manifest.json'), JSON.stringify(ffManifest, null, 2));

  const firefoxZipName = `reddit-nsfw-blocker-v${version}-firefox.zip`;
  const firefoxZipPath = path.join(DIST_DIR, firefoxZipName);
  createZipArchive(ffStage, firefoxZipPath);

  const ffStats = fs.statSync(firefoxZipPath);
  log(`  --> Firefox Package: ${firefoxZipPath} (${(ffStats.size / 1024).toFixed(2)} KB)`);

  // 2. Chrome Build Target
  log('Building Chrome release package...');
  const chromeStage = path.join(STAGE_DIR, 'chrome');
  copyRecursiveSync(SRC_DIR, chromeStage);

  // Chrome Manifest Optimization (service_worker strictly for Chrome MV3)
  const chromeManifest = JSON.parse(JSON.stringify(baseManifest));
  chromeManifest.background = { service_worker: 'background.js' };
  delete chromeManifest.browser_specific_settings; // Exclude Gecko-specific settings for Chrome
  fs.writeFileSync(path.join(chromeStage, 'manifest.json'), JSON.stringify(chromeManifest, null, 2));

  const chromeZipName = `reddit-nsfw-blocker-v${version}-chrome.zip`;
  const chromeZipPath = path.join(DIST_DIR, chromeZipName);
  createZipArchive(chromeStage, chromeZipPath);

  const chromeStats = fs.statSync(chromeZipPath);
  log(`  --> Chrome Package: ${chromeZipPath} (${(chromeStats.size / 1024).toFixed(2)} KB)`);

  // Cleanup staging folder
  fs.rmSync(STAGE_DIR, { recursive: true, force: true });
  log('Build completed successfully!');
}

try {
  build();
} catch (err) {
  console.error('[BUILD ERROR]', err.message);
  process.exit(1);
}
