const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT_DIR, 'src');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

function log(msg) {
  console.log(`[BUILD] ${msg}`);
}

function build() {
  log('Starting build process...');

  // Step 1: Read manifest version from src/manifest.json
  const manifestPath = path.join(SRC_DIR, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error('src/manifest.json not found!');
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const version = manifest.version || '1.0.0';
  log(`Detected extension version: v${version}`);

  // Step 2: Ensure dist directory exists
  if (!fs.existsSync(DIST_DIR)) {
    fs.mkdirSync(DIST_DIR, { recursive: true });
  }

  // Step 3: Create Zip Archive directly from src/ with POSIX forward slashes (/)
  const firefoxZipName = `reddit-nsfw-blocker-v${version}-firefox.zip`;
  const firefoxZipPath = path.join(DIST_DIR, firefoxZipName);

  log(`Compressing src/ files with POSIX forward slashes into ${firefoxZipName}...`);

  if (process.platform === 'win32') {
    // PowerShell .NET script to explicitly normalize zip entry paths using '/'
    const psScript = [
      `Add-Type -AssemblyName System.IO.Compression;`,
      `Add-Type -AssemblyName System.IO.Compression.FileSystem;`,
      `if (Test-Path '${firefoxZipPath}') { Remove-Item '${firefoxZipPath}' -Force };`,
      `$zip = [System.IO.Compression.ZipFile]::Open('${firefoxZipPath}', [System.IO.Compression.ZipArchiveMode]::Create);`,
      `$files = Get-ChildItem -Path '${SRC_DIR}' -Recurse -File;`,
      `foreach ($file in $files) {`,
      `  $relPath = $file.FullName.Substring('${SRC_DIR}'.Length + 1).Replace('\\', '/');`,
      `  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $relPath);`,
      `};`,
      `$zip.Dispose();`
    ].join(' ');

    execSync(`powershell -Command "${psScript}"`, { stdio: 'inherit' });
  } else {
    // Unix zip command
    execSync(`cd "${SRC_DIR}" && zip -r "${firefoxZipPath}" .`, { stdio: 'inherit' });
  }

  // Step 4: Verify output zip file
  if (fs.existsSync(firefoxZipPath)) {
    const stats = fs.statSync(firefoxZipPath);
    const sizeKb = (stats.size / 1024).toFixed(2);
    log(`Success! Build artifact created:`);
    log(`  --> Location: ${firefoxZipPath}`);
    log(`  --> Size: ${sizeKb} KB`);
  } else {
    throw new Error('Zip artifact creation failed!');
  }
}

try {
  build();
} catch (err) {
  console.error('[BUILD ERROR]', err.message);
  process.exit(1);
}
