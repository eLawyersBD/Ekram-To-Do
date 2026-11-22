const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const zlib = require('zlib');
const os = require('os');

const TARGET_EMAIL = 'ekram.elawyersbd@gmail.com';
const PROJECT_ID = 'gen-lang-client-0557579854';

const CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';

const tokenPath = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');

function request(url, options = {}, data = null) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    }, (res) => {
      let body = [];
      res.on('data', chunk => body.push(chunk));
      res.on('end', () => {
        const fullBody = Buffer.concat(body);
        let parsedBody;
        try {
          parsedBody = JSON.parse(fullBody.toString('utf8'));
        } catch {
          parsedBody = fullBody.toString('utf8');
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(parsedBody);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${typeof parsedBody === 'string' ? parsedBody : JSON.stringify(parsedBody)}`));
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function findRefreshTokenForEmail(email) {
  if (!fs.existsSync(tokenPath)) return null;
  try {
    const config = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
    if (config.user?.email?.toLowerCase() === email.toLowerCase() && config.tokens?.refresh_token) {
      return config.tokens.refresh_token;
    }
    if (Array.isArray(config.additionalAccounts)) {
      const found = config.additionalAccounts.find(a => a.user?.email?.toLowerCase() === email.toLowerCase());
      if (found?.tokens?.refresh_token) return found.tokens.refresh_token;
    }
  } catch {}
  return null;
}

async function getAccessToken(refreshToken) {
  const postData = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  }).toString();

  const res = await request('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(postData)
    }
  }, postData);

  return res.access_token;
}

function getFiles(dir, baseDir = dir) {
  let files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(getFiles(fullPath, baseDir));
    } else {
      const relPath = '/' + path.relative(baseDir, fullPath).replace(/\\/g, '/');
      const rawContent = fs.readFileSync(fullPath);
      const gzippedContent = zlib.gzipSync(rawContent, { level: 9 });
      const hash = crypto.createHash('sha256').update(gzippedContent).digest('hex');
      files.push({ relPath, fullPath, hash, content: gzippedContent });
    }
  }
  return files;
}

async function deployHosting(accessToken, site) {
  const distDir = path.resolve(__dirname, 'dist');
  if (!fs.existsSync(distDir)) {
    throw new Error('dist directory not found. Please run npm run build first.');
  }

  const files = getFiles(distDir);
  console.log(`📦 Found ${files.length} static assets in dist/ to deploy to site "${site}".`);

  const version = await request(`https://firebasehosting.googleapis.com/v1beta1/sites/${site}/versions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  }, JSON.stringify({
    config: {
      headers: [
        {
          glob: '/index.html',
          headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' }
        },
        {
          glob: '/assets/**',
          headers: { 'Cache-Control': 'public, max-age=31536000, immutable' }
        }
      ],
      rewrites: [
        { glob: '**', path: '/index.html' }
      ]
    }
  }));

  const versionName = version.name;
  console.log(`✅ Created version: ${versionName}`);

  const fileHashMap = {};
  for (const f of files) {
    fileHashMap[f.relPath] = f.hash;
  }

  const populateRes = await request(`https://firebasehosting.googleapis.com/v1beta1/${versionName}:populateFiles`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  }, JSON.stringify({ files: fileHashMap }));

  const requiredHashes = populateRes.uploadRequiredHashes || [];
  const uploadUrl = populateRes.uploadUrl;
  console.log(`⚡ ${requiredHashes.length} files need uploading (${files.length - requiredHashes.length} cached).`);

  if (requiredHashes.length > 0) {
    const requiredMap = new Set(requiredHashes);
    const filesToUpload = files.filter(f => requiredMap.has(f.hash));
    for (let i = 0; i < filesToUpload.length; i++) {
      const file = filesToUpload[i];
      await request(`${uploadUrl}/${file.hash}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/octet-stream',
          'Content-Length': file.content.length
        }
      }, file.content);
      process.stdout.write(`   ✓ [${i + 1}/${filesToUpload.length}] ${file.relPath}\n`);
    }
  }

  await request(`https://firebasehosting.googleapis.com/v1beta1/${versionName}?update_mask=status`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  }, JSON.stringify({ status: 'FINALIZED' }));

  await request(`https://firebasehosting.googleapis.com/v1beta1/sites/${site}/releases?versionName=${encodeURIComponent(versionName)}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  });

  console.log('\n🎉 LIVE DEPLOYMENT COMPLETE & SUCCESSFUL!');
  console.log(`👉 https://ekram.elawyersbd.com/`);
  console.log(`👉 https://${site}.web.app`);
}

async function main() {
  const refreshToken = findRefreshTokenForEmail(TARGET_EMAIL);
  if (!refreshToken) throw new Error('Refresh token not found for ' + TARGET_EMAIL);
  const accessToken = await getAccessToken(refreshToken);
  await deployHosting(accessToken, PROJECT_ID);
}

main().catch(err => {
  console.error('❌ Deployment error:', err);
  process.exit(1);
});
