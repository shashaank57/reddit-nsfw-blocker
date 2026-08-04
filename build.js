const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = __dirname;
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const STAGE_DIR = path.join(DIST_DIR, 'staging');

// Files and folders required for the browser extension bundle
const INCLUDED_PATHS = [
  'manifest.json',
  'background.js',
  'content.js',
  'content.css',
  'blocked.html',
  'popup',
  'icons',
  'icons-experimental',
  'README.md',
  'package.json'
];

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

function build() {
  log('Starting build process...');

  // Step 1: Read manifest version
  const manifestPath = path.join(ROOT_DIR, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error('manifest.json not found!');
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const version = manifest.version || '1.0.0';
  log(`Detected extension version: v${version}`);

  // Step 2: Clean previous dist & staging directories
  if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(STAGE_DIR, { recursive: true });

  // Step 3: Copy required extension files to staging
  log('Copying extension files into staging directory...');
  INCLUDED_PATHS.forEach((relPath) => {
    const srcPath = path.join(ROOT_DIR, relPath);
    const destPath = path.join(STAGE_DIR, relPath);
    if (fs.existsSync(srcPath)) {
      copyRecursiveSync(srcPath, destPath);
      log(`  + Added: ${relPath}`);
    } else {
      log(`  ! Warning: ${relPath} does not exist, skipping`);
    }
  });

  // Step 4: Create Zip Archive with POSIX forward slashes (/)
  const firefoxZipName = `reddit-nsfw-blocker-v${version}-firefox.zip`;
  const firefoxZipPath = path.join(DIST_DIR, firefoxZipName);

  log(`Compressing artifact with POSIX forward slashes into ${firefoxZipName}...`);

  if (process.platform === 'win32') {
    // PowerShell .NET script to explicitly normalize zip entry paths using '/'
    const psScript = [
      `Add-Type -AssemblyName System.IO.Compression;`,
      `Add-Type -AssemblyName System.IO.Compression.FileSystem;`,
      `if (Test-Path '${firefoxZipPath}') { Remove-Item '${firefoxZipPath}' -Force };`,
      `$zip = [System.IO.Compression.ZipFile]::Open('${firefoxZipPath}', [System.IO.Compression.ZipArchiveMode]::Create);`,
      `$files = Get-ChildItem -Path '${STAGE_DIR}' -Recurse -File;`,
      `foreach ($file in $files) {`,
      `  $relPath = $file.FullName.Substring('${STAGE_DIR}'.Length + 1).Replace('\\', '/');`,
      `  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $relPath);`,
      `};`,
      `$zip.Dispose();`
    ].join(' ');

    execSync(`powershell -Command "${psScript}"`, { stdio: 'inherit' });
  } else {
    // Unix zip command
    execSync(`cd "${STAGE_DIR}" && zip -r "${firefoxZipPath}" .`, { stdio: 'inherit' });
  }

  // Step 5: Clean up staging folder
  fs.rmSync(STAGE_DIR, { recursive: true, force: true });

  // Step 6: Verify output zip file
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
