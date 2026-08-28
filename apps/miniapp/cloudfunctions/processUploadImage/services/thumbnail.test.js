const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  createThumbnail,
  ensureThumbnail,
  isDurableReference,
  resolveThumbnailSource,
} = require('./thumbnail');

test('thumbnail source follows durable canonical priority and rejects signed URLs', () => {
  assert.equal(resolveThumbnailSource({
    cleanImageUrl: 'cloud://clean',
    displayImageUrl: 'https://signed.example/display.jpg?sign=x',
    cropImageUrl: 'cloud://crop',
  }), 'cloud://clean');
  assert.equal(resolveThumbnailSource({
    displayImageUrl: 'https://signed.example/display.jpg?sign=x',
    cropImageUrl: 'cloud://crop',
  }), 'cloud://crop');
  assert.equal(isDurableReference('https://signed.example/display.jpg?sign=x'), false);
});

test('thumbnail generation uses Jimp primitive and persists uploaded file id', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const uploaded = [];
  const cloud = {
    downloadFile: async () => ({ fileContent: png }),
    uploadFile: async (input) => { uploaded.push(input); return { fileID: 'cloud://thumb' }; },
  };
  const result = await createThumbnail({
    cloud,
    item: { originalImageUrl: 'cloud://original' },
    cloudPath: 'wardrobe_uploads/thumbnails/primary/u/b/a.jpg',
  });
  assert.equal(result, 'cloud://thumb');
  assert.equal(uploaded[0].cloudPath, 'wardrobe_uploads/thumbnails/primary/u/b/a.jpg');
});

test('existing durable thumbnail is idempotently reused without image work', async () => {
  let downloads = 0;
  const result = await ensureThumbnail({
    cloud: { downloadFile: async () => { downloads += 1; }, uploadFile: async () => { throw new Error('must not upload'); } },
    item: { originalImageUrl: 'cloud://original' },
    existingThumbnail: 'cloud://existing-thumb',
    cloudPath: 'unused',
  });
  assert.equal(result, 'cloud://existing-thumb');
  assert.equal(downloads, 0);
});

test('primary thumbnail failure is fail-open and draft persistence still follows', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  const thumbnailStart = source.indexOf('thumbnailUrl = await ensureThumbnail');
  const warning = source.indexOf("console.warn('[processUploadImage] create thumbnail failed'", thumbnailStart);
  const persist = source.indexOf('await ref.set({ data })', warning);
  assert.ok(thumbnailStart >= 0 && warning > thumbnailStart && persist > warning);
  assert.match(source.slice(thumbnailStart, persist), /catch \(error\)/);
});

test('confirmation propagates the draft thumbnail without image processing', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'confirmClothesDrafts', 'index.js'),
    'utf8',
  );
  assert.match(source, /thumbnailUrl: draft\.thumbnailUrl \|\| ''/);
  assert.doesNotMatch(source, /createThumbnailForClothing|resolveThumbnailSourceImage/);
});

test('deployment vendor fallback loads garment assets without workspace node_modules', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'd1d-thumbnail-vendor-'));
  try {
    const shared = path.join(root, 'shared');
    const vendor = path.join(root, 'vendor', 'garment-assets');
    fs.mkdirSync(shared, { recursive: true });
    fs.mkdirSync(vendor, { recursive: true });
    fs.copyFileSync(
      path.join(__dirname, '..', '..', 'shared', 'thumbnail.js'),
      path.join(shared, 'thumbnail.js'),
    );
    fs.cpSync(
      path.resolve(__dirname, '..', '..', '..', '..', '..', 'packages', 'garment-assets'),
      vendor,
      { recursive: true, filter: (source) => !source.includes(`${path.sep}node_modules${path.sep}`) },
    );
    const probe = [
      "const thumbnail = require('./shared/thumbnail');",
      "if (thumbnail.resolveThumbnailSource({ cleanImageUrl: 'cloud://clean' }) !== 'cloud://clean') process.exit(1);",
    ].join(' ');
    execFileSync(process.execPath, ['-e', probe], { cwd: root, stdio: 'pipe' });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
