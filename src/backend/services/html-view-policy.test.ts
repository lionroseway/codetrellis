import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlAssetType, htmlViewCsp, isSameReport, reportAssetPath } from './html-view-policy';

test('a report serves files from its own folder, and nothing outside it', () => {
  const report = 'reports/e2e/index.html';
  assert.equal(reportAssetPath(report, '/'), 'reports/e2e/index.html');
  assert.equal(reportAssetPath(report, '/index.html'), 'reports/e2e/index.html');
  assert.equal(reportAssetPath(report, '/assets/app.css'), 'reports/e2e/assets/app.css');
  assert.equal(reportAssetPath(report, '/data/a%20b.json'), 'reports/e2e/data/a b.json');
  // Out of the folder, however spelled.
  assert.equal(reportAssetPath(report, '/../secret.txt'), null);
  assert.equal(reportAssetPath(report, '/assets/../../x.js'), null);
  assert.equal(reportAssetPath(report, '/%2e%2e/%2e%2e/.env'), null);
  assert.equal(reportAssetPath(report, '/..%2f..%2f.env'), null);
  assert.equal(reportAssetPath(report, '/a%5c..%5c..%5c.env'), null);
  assert.equal(reportAssetPath(report, '/a%00.html'), null);
  assert.equal(reportAssetPath(report, '/%E0%A4%A'), null);
  // Its own subfolders, even when the name starts like the folder's sibling.
  assert.equal(reportAssetPath(report, '/../e2e-other/index.html'), null);
});

test('a report at the project root is confined to the project, which confined-fs enforces', () => {
  assert.equal(reportAssetPath('report.html', '/style.css'), 'style.css');
  assert.equal(reportAssetPath('report.html', '/../outside.css'), null);
});

test('only web assets are served, by extension', () => {
  assert.match(htmlAssetType('a/index.html')!, /^text\/html/);
  assert.match(htmlAssetType('a/app.MJS')!, /^text\/javascript/);
  assert.equal(htmlAssetType('a/font.woff2'), 'font/woff2');
  assert.equal(htmlAssetType('a/.env'), null);
  assert.equal(htmlAssetType('a/data.xlsx'), null);
  assert.equal(htmlAssetType('a/run.sh'), null);
});

test('the policy never allows the network, and scripts only when turned on', () => {
  for (const scripts of [false, true]) {
    const csp = htmlViewCsp(scripts);
    assert.match(csp, /^default-src 'none'/);
    assert.doesNotMatch(csp, /connect-src/);
    assert.doesNotMatch(csp, /https?:|\*/);
    assert.match(csp, /form-action 'none'/);
  }
  assert.match(htmlViewCsp(false), /script-src 'none'/);
  assert.match(htmlViewCsp(true), /script-src ct-html: 'unsafe-inline'/);
});

test('navigation stays within the same report', () => {
  assert.equal(isSameReport('ct-html://abc12345/index.html', 'ct-html://abc12345/files/a.html#L3'), true);
  assert.equal(isSameReport('ct-html://abc12345/index.html', 'ct-html://other1234/index.html'), false);
  assert.equal(isSameReport('ct-html://abc12345/index.html', 'https://example.com/'), false);
  assert.equal(isSameReport('ct-html://abc12345/index.html', 'file:///etc/passwd'), false);
  assert.equal(isSameReport('ct-html://abc12345/index.html', 'not a url'), false);
});

test('a report file is opened through confined-fs: a link planted in the report folder is refused', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { serveReportFile } = await import('./html-view-policy');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-report-')));
  try {
    fs.mkdirSync(path.join(root, 'reports', 'r', 'assets'), { recursive: true });
    fs.writeFileSync(path.join(root, 'reports', 'r', 'index.html'), '<p>ok</p>');
    fs.writeFileSync(path.join(root, 'reports', 'r', 'assets', 'app.css'), 'p{}');
    fs.writeFileSync(path.join(root, 'secret.css'), 'SECRET');
    fs.symlinkSync(path.join(root, 'secret.css'), path.join(root, 'reports', 'r', 'assets', 'linked.css'));
    fs.symlinkSync(root, path.join(root, 'reports', 'r', 'up'));
    const report = { root, rel: 'reports/r/index.html' };

    const ok = serveReportFile(report, '/assets/app.css', false);
    assert.equal(ok.status, 200);
    assert.match(ok.headers['Content-Type'], /^text\/css/);
    assert.match(ok.headers['Content-Security-Policy'], /script-src 'none'/);
    ok.stream?.destroy();

    assert.equal(serveReportFile(report, '/assets/linked.css', false).status, 404);
    assert.equal(serveReportFile(report, '/up/secret.css', false).status, 404);
    assert.equal(serveReportFile(report, '/../../secret.css', false).status, 404);
    assert.equal(serveReportFile({ root, rel: 'secret.css' }, '/secret.css', false).status, 404, 'only an HTML attachment is a report');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
