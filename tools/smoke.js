'use strict';

/**
 * Node smoke tests for the pure-function modules under
 * entry/src/main/js/MainAbility/common.
 *
 * The Lite runtime consumes those modules as ES modules (`export default`),
 * while Node cannot require `export` syntax from a .js file. This loader
 * rewrites `import X from './y.js'` / `export default` into CommonJS calls so
 * the very same source files can be exercised here without a build step.
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

const COMMON_DIR = path.resolve(
  __dirname,
  '..',
  'entry',
  'src',
  'main',
  'js',
  'MainAbility',
  'common'
);

/* --------------------------- @system.* mocks --------------------------- */

const storageData = {};

const storageMock = {
  get(options) {
    const key = options && options.key;
    let value = '';
    if (Object.prototype.hasOwnProperty.call(storageData, key)) {
      value = storageData[key];
    } else if (options && options.default !== undefined) {
      value = options.default;
    }
    if (options && typeof options.success === 'function') {
      options.success(value);
    }
  },
  set(options) {
    if (options && options.key !== undefined) {
      storageData[options.key] = options.value;
    }
    if (options && typeof options.success === 'function') {
      options.success();
    }
  },
  clear(options) {
    Object.keys(storageData).forEach((key) => {
      delete storageData[key];
    });
    if (options && typeof options.success === 'function') {
      options.success();
    }
  },
  delete(options) {
    if (options && options.key !== undefined) {
      delete storageData[options.key];
    }
    if (options && typeof options.success === 'function') {
      options.success();
    }
  }
};

/* --------------------------- @system.file mock --------------------------- */

/* 虚拟文件系统：按 uri 存字符串。position 语义可切换（fileMock.charMode）
   以模拟真机的「字符偏移」/「字节偏移」两种实现。 */
const fsData = {};
const fileCalls = [];
const fileMock = {
  charMode: true,
  writeText(options) {
    fileCalls.push(['writeText', options.uri, options.append ? 'append' : 'new']);
    const prev = options.append ? (fsData[options.uri] || '') : '';
    fsData[options.uri] = prev + (options.text || '');
    if (options.success) options.success();
  },
  readText(options) {
    fileCalls.push(['readText', options.uri, options.position, options.length]);
    const raw = fsData[options.uri];
    if (raw === undefined) {
      if (options.fail) options.fail('not found', 301);
      return;
    }
    const len = options.length === undefined ? 4096 : options.length;
    let pos = options.position || 0;
    if (!fileMock.charMode) {
      /* 字节偏移实现：把字符串按 UTF-8 字节换算回字符下标 */
      pos = byteToCharIndex(raw, pos);
    }
    const text = raw.substr(pos, len);
    if (options.success) options.success({ text: text });
  },
  delete(options) {
    fileCalls.push(['delete', options.uri]);
    const existed = fsData[options.uri] !== undefined;
    delete fsData[options.uri];
    if (existed) {
      if (options.success) options.success();
    } else if (options.fail) {
      options.fail('not found', 301);
    }
  },
  access(options) {
    if (fsData[options.uri] !== undefined) {
      if (options.success) options.success();
    } else if (options.fail) {
      options.fail('not found', 301);
    }
  },
  mkdir(options) {
    if (options.success) options.success();
  },
  /* v3.2：信息页存储统计用（file.list）——列出 dirUri 前缀下的普通文件 */
  list(options) {
    const prefix = options.uri.endsWith('/') ? options.uri : options.uri + '/';
    const fileList = [];
    Object.keys(fsData).forEach((k) => {
      if (k.indexOf(prefix) === 0 && k.indexOf('/', prefix.length) < 0) {
        fileList.push({ uri: k, length: fsData[k].length, type: 'file' });
      }
    });
    if (options.success) options.success({ fileList: fileList });
  }
};

function byteToCharIndex(s, bytePos) {
  let bytes = 0;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    const len = c < 0x80 ? 1 : (c < 0x800 ? 2 : 3);
    if (bytes + len > bytePos) return i;
    bytes += len;
  }
  return s.length;
}

const MOCKS = {
  '@system.storage': storageMock,
  '@system.fetch': { fetch() {} },
  '@system.network': { getType() {} },
  '@system.router': { push() {}, replace() {}, back() {} },
  '@system.prompt': { showToast() {} },
  '@system.device': { getInfo() {} },
  '@system.file': fileMock,
  '@system.brightness': {
    setKeepScreenOn(options) {
      if (options && typeof options.success === 'function') {
        options.success();
      }
    }
  }
};

function resetStorage() {
  Object.keys(storageData).forEach((key) => {
    delete storageData[key];
  });
}

/* ------------------------------ module loader ------------------------------ */

const cache = {};

function loadModule(absPath) {
  if (Object.prototype.hasOwnProperty.call(cache, absPath)) {
    return cache[absPath];
  }

  const source = fs.readFileSync(absPath, 'utf8');
  const dir = path.dirname(absPath);

  let transformed = source.replace(
    /\bimport\s+([A-Za-z_$][\w$]*)\s+from\s+(['"])([^'"]+)\2\s*;?/g,
    function (match, name, quote, spec) {
      return 'var ' + name + ' = __require(' + JSON.stringify(spec) + ');';
    }
  );
  transformed = transformed.replace(/\bexport\s+default\s+/g, 'module.exports = ');

  const moduleObj = { exports: {} };
  cache[absPath] = moduleObj.exports;

  const localRequire = function (spec) {
    if (Object.prototype.hasOwnProperty.call(MOCKS, spec)) {
      return MOCKS[spec];
    }
    return loadModule(path.resolve(dir, spec));
  };

  const fn = new Function(
    'module',
    'exports',
    '__require',
    transformed + '\n;return module.exports;'
  );
  const result = fn(moduleObj, moduleObj.exports, localRequire);
  cache[absPath] = result;
  return result;
}

function loadCommon(name) {
  return loadModule(path.join(COMMON_DIR, name + '.js'));
}

/* 全局虚拟文件系统复位（跨 section 共用） */
function resetFs() {
  Object.keys(fsData).forEach((k) => delete fsData[k]);
  fileCalls.length = 0;
  fileMock.charMode = true;
}

/* -------------------------------- harness -------------------------------- */

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('  PASS  ' + name);
  } catch (err) {
    failures.push({ name: name, message: err && err.message ? err.message : String(err) });
    console.log('  FAIL  ' + name + ' -> ' + (err && err.message ? err.message : err));
  }
}

function assert(cond, message) {
  if (!cond) {
    throw new Error(message || 'assertion failed');
  }
}

function eq(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(
      (message || 'value mismatch') +
        ' (expected=' + JSON.stringify(expected) + ', actual=' + JSON.stringify(actual) + ')'
    );
  }
}

function section(name) {
  console.log('\n[' + name + ']');
}

function summary() {
  console.log('\n----------------------------------------');
  console.log('passed: ' + passed + ', failed: ' + failures.length);
  if (failures.length > 0) {
    failures.forEach(function (f) {
      console.log('  - ' + f.name + ': ' + f.message);
    });
    process.exitCode = 1;
  }
  return failures.length === 0;
}

/* --------------------------------- cases --------------------------------- */

function runUrlCases() {
  section('url');
  const Url = loadCommon('url');

  test('normalize adds https and trailing slash', function () {
    eq(Url.normalize('example.com'), 'https://example.com/');
    eq(Url.normalize('  example.com/a  '), 'https://example.com/a');
  });

  test('normalize keeps explicit http/https and strips fragment', function () {
    eq(Url.normalize('http://localhost:8080'), 'http://localhost:8080/');
    eq(Url.normalize('https://a.example.com/p?x=1#frag'), 'https://a.example.com/p?x=1');
  });

  test('normalize rejects illegal input', function () {
    eq(Url.normalize(''), '');
    eq(Url.normalize('not a url'), '');
    eq(Url.normalize('javascript:alert(1)'), '');
    eq(Url.normalize('https://'), '');
    eq(Url.normalize('https://exa mple.com'), '');
  });

  test('resolve handles relative / root / protocol relative', function () {
    const base = 'https://example.com/a/b.html';
    eq(Url.resolve(base, 'c.html'), 'https://example.com/a/c.html');
    eq(Url.resolve(base, '../d.html'), 'https://example.com/d.html');
    eq(Url.resolve(base, '/e/f'), 'https://example.com/e/f');
    eq(Url.resolve(base, '//cdn.example.com/x'), 'https://cdn.example.com/x');
    eq(Url.resolve(base, './g'), 'https://example.com/a/g');
  });

  test('looksLikeToc blocks /chapter/<id> TOC pages, chapter URLs pass (v3.10)', function () {
    /* 创世目录页 419KB/853 链接——整包序列化进 698KB 堆必崩（Range/HEAD 均不可用） */
    eq(Url.looksLikeToc('https://chuangshi.qq.com/chapter/933334'), true);
    eq(Url.looksLikeToc('https://x.com/list/123'), true);
    eq(Url.looksLikeToc('https://x.com/toc/456?from=nav'), true);
    eq(Url.looksLikeToc('https://x.com/read/933334/6'), false, 'chapter page (3 segments) passes');
    eq(Url.looksLikeToc('https://x.com/chapter/933334/5'), false, 'nested chapter passes');
    eq(Url.looksLikeToc('https://x.com/'), false);
    eq(Url.looksLikeToc('https://x.com/chapter/abc'), false, 'non-numeric id passes');
    eq(Url.looksLikeToc(''), false);
  });

  test('resolve rejects non navigable targets', function () {
    const base = 'https://example.com/a/b.html';
    eq(Url.resolve(base, '#top'), '');
    eq(Url.resolve(base, 'mailto:a@b.com'), '');
    eq(Url.resolve(base, 'javascript:void(0)'), '');
    eq(Url.resolve(base, ''), '');
  });

  test('hostOf / displayOf', function () {
    eq(Url.hostOf('https://www.example.com/a/b'), 'example.com');
    eq(Url.hostOf('https://user:pw@a.example.com:8080/x'), 'a.example.com');
    eq(Url.displayOf('https://example.com/a/b'), 'example.com/a/b');
    eq(Url.normalize('https://example.com'), 'https://example.com/');
  });

  test('looksLikeUrl follows address-bar habits', function () {
    eq(Url.looksLikeUrl('https://example.com/a'), true, 'full url');
    eq(Url.looksLikeUrl('example.com'), true, 'bare domain');
    eq(Url.looksLikeUrl('localhost:8080/x'), true, 'host:port');
    eq(Url.looksLikeUrl('a/b'), true, 'path-ish');
    eq(Url.looksLikeUrl('龙族'), false, 'chinese keyword');
    eq(Url.looksLikeUrl('node.js 教程'), false, 'keyword with dot but has space');
    eq(Url.looksLikeUrl(''), false, 'empty');
  });
}

function runHtmlCases() {
  section('html');
  const Html = loadCommon('html');
  const Config = loadCommon('config');

  test('extracts title, body text and resolved links', function () {
    const html =
      '<html><head><title>示例 &amp; 标题</title>' +
      '<style>.x{color:red}</style><script>var a=1;</script></head>' +
      '<body><h1>备选标题</h1><p>第一段文字。</p><p>第二段，' +
      '<a href="/next?q=1">下一页</a>。</p>' +
      '<a href="https://other.example.com/x"><img src="x.png"></a></body></html>';
    const doc = Html.parse(html, 'https://example.com/a/b.html');
    eq(doc.kind, 'html');
    eq(doc.title, '示例 & 标题');
    assert(doc.text.indexOf('第一段文字。') >= 0, 'body text kept');
    assert(doc.text.indexOf('color:red') < 0, 'style removed');
    assert(doc.text.indexOf('var a=1') < 0, 'script removed');
    eq(doc.links.length, 2);
    eq(doc.links[0].text, '下一页');
    eq(doc.links[0].href, 'https://example.com/next?q=1');
    eq(doc.links[1].text, '');
    eq(doc.links[1].href, 'https://other.example.com/x');
  });

  test('decodes entities and tolerates malformed tags', function () {
    const html = '<div>a &lt; b &gt; c &nbsp; d &#20013;&#x6587; &unknown;</div><div><p>尾部';
    const doc = Html.parse(html, 'https://example.com/');
    assert(doc.text.indexOf('a < b > c') >= 0, 'entity decode');
    assert(doc.text.indexOf('中文') >= 0, 'numeric entity decode');
    assert(doc.text.indexOf('&unknown;') >= 0, 'unknown entity kept');
    assert(doc.text.indexOf('尾部') >= 0, 'unclosed tag text kept');
  });

  test('falls back to h1, then host', function () {
    eq(Html.parse('<div><h1>只有一级标题</h1></div>', 'https://a.example.com/x').title, '只有一级标题');
    eq(Html.parse('<div>没有标题</div>', 'https://www.a.example.com/x').title, 'a.example.com');
  });

  test('caps text length and sets truncated', function () {
    let body = '';
    for (let i = 0; i < 60000; i += 1) {
      body += '字';
    }
    const doc = Html.parse('<div>' + body + '</div>', 'https://example.com/');
    eq(doc.text.length, Config.MAX_TEXT_CHARS);
    assert(doc.truncated === true, 'truncated flag');
  });

  test('caps links at 40 and dedupes hrefs', function () {
    let html = '<div>';
    for (let i = 0; i < 60; i += 1) {
      html += '<a href="/p?id=' + i + '">L' + i + '</a>';
    }
    html += '<a href="/p?id=0">dup</a></div>';
    const doc = Html.parse(html, 'https://example.com/');
    eq(doc.links.length, 40);
  });

  test('plain text payload is read as body', function () {
    const doc = Html.parse('第一行\n第二行', 'https://example.com/x');
    eq(doc.kind, 'text');
    assert(doc.text.indexOf('第一行') >= 0, 'plain line 1');
    assert(doc.text.indexOf('第二行') >= 0, 'plain line 2');
    eq(doc.title, 'example.com');
  });

  test('json payload is unsupported, empty payload is empty', function () {
    eq(Html.parse('{"a":1}', 'https://example.com/x').kind, 'unsupported');
    eq(Html.parse('', 'https://example.com/x').kind, 'empty');
  });

  test('nav link detected from title / aria-label attributes', function () {
    const html =
      '<div><p>正文内容足够长的一段文字。</p>' +
      '<a href="/c/2.html" title="下一章">›</a>' +
      '<a href="/c/0.html" aria-label="上一章">‹</a></div>';
    const doc = Html.parse(html, 'https://example.com/c/1.html');
    eq(doc.nextHref, 'https://example.com/c/2.html');
    eq(doc.prevHref, 'https://example.com/c/0.html');
  });

  test('anchor text still wins over attributes', function () {
    const html = '<div><p>正文。</p><a href="/p/2" title="返回目录">下一页</a></div>';
    const doc = Html.parse(html, 'https://example.com/p/1');
    eq(doc.nextHref, 'https://example.com/p/2');
  });

  test('promo noise lines are stripped, real paragraphs kept', function () {
    const html =
      '<div><p>第一段正文，内容正常。</p>' +
      '<p>本章未完，请点击下一页继续阅读</p>' +
      '<p>请记住本站域名 www.example.com</p>' +
      '<p>第二段正文，同样正常。</p>' +
      '<p>短句。</p></div>';
    const doc = Html.parse(html, 'https://example.com/x');
    assert(doc.text.indexOf('本章未完') < 0, 'noise 1 removed');
    assert(doc.text.indexOf('请记住本站') < 0, 'noise 2 removed');
    assert(doc.text.indexOf('第一段正文') >= 0, 'paragraph 1 kept');
    assert(doc.text.indexOf('第二段正文') >= 0, 'paragraph 2 kept');
    assert(doc.text.indexOf('短句。') >= 0, 'short real line kept');
  });

  test('long paragraphs containing noise words are not stripped', function () {
    const line = '这一行虽然提到了本章未完但这只是正文里的一句话，长度超过了三十个字符的限制所以必须保留';
    const doc = Html.parse('<div><p>' + line + '</p></div>', 'https://example.com/x');
    assert(doc.text.indexOf('这一行虽然提到了') >= 0, 'long line kept');
  });

  test('novel-site navigation: start-reading link and chapter list', function () {
    const html =
      '<div><h1>龙族</h1><p>一本关于龙的小说，简介文字。</p>' +
      '<a href="/longzu/1.html">开始阅读</a>' +
      '<a href="/longzu/2.html">第一章</a>' +
      '<a href="/longzu/3.html">第2章 初到卡塞尔</a>' +
      '<a href="/longzu/4.html">第三章</a>' +
      '<a href="/about">关于我们</a></div>';
    const doc = Html.parse(html, 'https://luoxiadushu.com/longzu/');
    eq(doc.startHref, 'https://luoxiadushu.com/longzu/1.html', 'start link captured');
    eq(doc.chapters.length, 3, 'three chapter links');
    eq(doc.chapters[0].text, '第一章');
    eq(doc.chapters[1].href, 'https://luoxiadushu.com/longzu/3.html');
    eq(doc.chapters[2].text, '第三章');
  });

  test('next/prev chapter links still detected alongside chapters', function () {
    const html =
      '<div><p>正文内容足够长的一段文字。</p>' +
      '<a href="/c/2.html">下一章</a><a href="/c/0.html">上一章</a></div>';
    const doc = Html.parse(html, 'https://example.com/c/1.html');
    eq(doc.nextHref, 'https://example.com/c/2.html');
    eq(doc.prevHref, 'https://example.com/c/0.html');
    eq(doc.chapters.length, 0);
    eq(doc.startHref, '');
  });
}

function runPaginateCases() {
  section('paginate');
  const P = loadCommon('paginate');
  const Config = loadCommon('config');

  test('empty text yields one page and numeric offsets', function () {
    const r = P.paginate('', {});
    eq(r.pageCount, 1);
    eq(r.starts.length, 1);
    eq(r.starts[0], 0);
    eq(typeof r.starts[0], 'number');
    eq(P.paginate(null, {}).pageCount, 1);
  });

  test('starts is a number array, never a string array', function () {
    let text = '';
    for (let i = 0; i < 5000; i += 1) {
      text += '测试';
    }
    const r = P.paginate(text, { fontLevel: 1, lineLevel: 1 });
    assert(r.starts.length > 1, 'multiple pages');
    assert(r.starts.length === r.pageCount, 'pageCount matches starts');
    eq(typeof r.starts[1], 'number');
    eq(typeof text.substring(r.starts[1], r.starts[1] + 1), 'string');
  });

  test('offsets are monotonic and inside the text', function () {
    let text = '';
    for (let i = 0; i < 3000; i += 1) {
      text += i % 7 === 0 ? '\n' : '文';
    }
    const r = P.paginate(text, { fontLevel: 3, lineLevel: 2 });
    assert(r.starts[0] === 0, 'first start');
    for (let i = 1; i < r.starts.length; i += 1) {
      assert(r.starts[i] > r.starts[i - 1], 'monotonic at ' + i);
      assert(r.starts[i] < text.length, 'inside text at ' + i);
    }
  });

  test('pagination is deterministic and 50k chars stays bounded', function () {
    let text = '';
    for (let i = 0; i < 50000; i += 1) {
      text += '字';
    }
    const a = P.paginate(text, { fontLevel: 0, lineLevel: 0 });
    const b = P.paginate(text, { fontLevel: 0, lineLevel: 0 });
    eq(a.pageCount, b.pageCount);
    eq(a.starts.length, b.starts.length);
    assert(a.pageCount > 100, '50k chars produce many pages');
    assert(a.starts.length * 4 < text.length, 'offset array stays small');
  });

  test('pageText slices the shared string', function () {
    const text = 'abcdefghijklmnopqrstuvwxyz';
    const starts = [0, 10, 20];
    eq(P.pageText(text, starts, 0), 'abcdefghij');
    eq(P.pageText(text, starts, 1), 'klmnopqrst');
    eq(P.pageText(text, starts, 2), 'uvwxyz');
    eq(P.pageText(text, starts, 99), 'uvwxyz');
    eq(P.pageText(text, starts, -1), 'abcdefghij');
  });

  test('findPageByOffset maps an old page start to the new layout', function () {
    const starts = [0, 100, 200, 300];
    eq(P.findPageByOffset(starts, 0), 0);
    eq(P.findPageByOffset(starts, 150), 1);
    eq(P.findPageByOffset(starts, 200), 2);
    eq(P.findPageByOffset(starts, 999), 3);
    eq(P.findPageByOffset([], 10), 0);
  });

  test('CJK is wider than ASCII at the same font size', function () {
    assert(P.widthOf('中'.charCodeAt(0)) > P.widthOf('a'.charCodeAt(0)), 'CJK wider than ASCII');
    eq(P.widthOf('中'.charCodeAt(0)), 1);
    assert(P.widthOf(' '.charCodeAt(0)) > 0, 'space has width');
    assert(Config.CONTENT_W === 376, 'content width');
  });
}

function runStoreCases() {
  section('store');
  const Store = loadCommon('store');
  const Config = loadCommon('config');

  function resetFile() {
    Object.keys(fsData).forEach((k) => delete fsData[k]);
  }

  resetStorage();
  resetFile();
  Storage_reset(Store);

  test('empty storage yields defaults', function () {
    let ready = 0;
    Store.init(function () {
      ready += 1;
    });
    eq(ready, 1);
    eq(Store.loadBookmarks().length, 0);
    eq(Store.loadHistory().length, 0);
    const prefs = Store.loadPrefs();
    eq(prefs.fontSize, 24);
    eq(prefs.lineHeight, 1.55);
    eq(prefs.theme, undefined, 'theme field removed (unified dark theme)');
  });

  test('bookmarks dedupe by url and keep 50 newest', function () {
    for (let i = 0; i < 60; i += 1) {
      Store.saveBookmark({ url: 'https://example.com/p/' + i, title: 'T' + i });
    }
    const list = Store.loadBookmarks();
    eq(list.length, 50);
    eq(list[0].url, 'https://example.com/p/59');
    assert(Store.isBookmarked('https://example.com/p/59'), 'newest bookmarked');
    assert(!Store.isBookmarked('https://example.com/p/0'), 'oldest evicted');
  });

  test('bookmark toggle removes and re-adds', function () {
    const url = 'https://example.com/toggle';
    eq(Store.toggleBookmark({ url: url, title: 'Toggle' }), true);
    assert(Store.isBookmarked(url), 'added');
    eq(Store.toggleBookmark({ url: url, title: 'Toggle' }), false);
    assert(!Store.isBookmarked(url), 'removed');
  });

  test('titles are truncated to 40 chars', function () {
    let title = '';
    for (let i = 0; i < 100; i += 1) {
      title += '题';
    }
    Store.saveBookmark({ url: 'https://example.com/long', title: title });
    const list = Store.loadBookmarks();
    eq(list[0].title.length, Config.MAX_TITLE_CHARS);
  });

  test('history dedupes, orders newest first and clears', function () {
    Store.addHistory({ url: 'https://example.com/a', title: 'A' });
    Store.addHistory({ url: 'https://example.com/b', title: 'B' });
    Store.addHistory({ url: 'https://example.com/a', title: 'A2' });
    const list = Store.loadHistory();
    eq(list.length, 2);
    eq(list[0].url, 'https://example.com/a');
    eq(list[0].title, 'A2');
    Store.clearHistory();
    eq(Store.loadHistory().length, 0);
  });

  test('prefs persist valid values and reject invalid ones', function () {
    Store.savePrefs({ fontSize: 28, lineHeight: 1.7 });
    let prefs = Store.loadPrefs();
    eq(prefs.fontSize, 28);
    eq(prefs.lineHeight, 1.7);
    eq(prefs.theme, undefined, 'theme ignored');

    Store.savePrefs({ fontSize: 99, lineHeight: 9 });
    prefs = Store.loadPrefs();
    eq(prefs.fontSize, 24);
    eq(prefs.lineHeight, 1.55);
  });

  test('legacy v1.x prefs migrate by tier index', function () {
    Store.savePrefs({ fontSize: 18, lineHeight: 1.5 });
    let prefs = Store.loadPrefs();
    eq(prefs.fontSize, 20, 'legacy 小(18) -> 新小(20)');
    eq(prefs.lineHeight, 1.4, 'legacy 紧凑(1.5) -> 新紧凑(1.4)');

    Store.savePrefs({ fontSize: 22, lineHeight: 1.9 });
    prefs = Store.loadPrefs();
    eq(prefs.fontSize, 28, 'legacy 大(22) -> 新大(28)');
    eq(prefs.lineHeight, 1.7, 'legacy 宽松(1.9) -> 新宽松(1.7)');
  });

  test('keepScreenOn pref defaults on and persists (v3.7 screen-on setting)', function () {
    resetStorage();
    resetFile();
    Storage_reset(Store);
    Store.init();
    eq(Store.loadPrefs().keepScreenOn, true, 'default on (screen-off kills app during loads)');
    Store.savePrefs({ fontSize: 24, lineHeight: 1.55, keepScreenOn: false });
    eq(Store.loadPrefs().keepScreenOn, false);
    Store.resetState();
    Store.init();
    eq(Store.loadPrefs().keepScreenOn, false, 'off survives restart');
    /* 旧版 prefs（无该字段）迁移后默认开 */
    resetFile();
    fsData['internal://app/data/pf.txt'] = JSON.stringify({ fontSize: 24, lineHeight: 1.55 });
    Storage_reset(Store);
    Store.resetState();
    Store.init();
    eq(Store.loadPrefs().keepScreenOn, true, 'legacy prefs default on');
  });

  test('bookmarks, history and prefs survive a simulated restart', function () {
    resetStorage();
    resetFile();
    Store.resetState();
    Store.init();
    Store.saveBookmark({ url: 'https://example.com/keep', title: 'Keep' });
    Store.addHistory({ url: 'https://example.com/keep', title: 'Keep' });
    Store.savePrefs({ fontSize: 28, lineHeight: 1.7 });

    Store.resetState();
    Store.init();
    eq(Store.loadBookmarks().length, 1);
    eq(Store.loadHistory().length, 1);
    eq(Store.loadPrefs().fontSize, 28);
  });

  test('corrupted storage payload falls back to empty list', function () {
    resetFile();
    storageData[Config.KEY_BOOKMARKS] = '{not json';
    Storage_reset(Store);
    Store.init();
    eq(Store.loadBookmarks().length, 0);
  });

  test('v1 storage payload migrates to the single-file channel (A1)', function () {
    resetStorage();
    resetFile();
    storageData[Config.KEY_BOOKMARKS] =
      JSON.stringify([{ url: 'https://m.example.com/old', title: '旧书签', savedAt: 123 }]);
    storageData[Config.KEY_HISTORY] =
      JSON.stringify([{ url: 'https://m.example.com/h', title: '旧历史', visitedAt: 456 }]);
    Storage_reset(Store);
    Store.init();
    eq(Store.loadBookmarks().length, 1, 'migrated bookmark imported');
    eq(Store.loadBookmarks()[0].url, 'https://m.example.com/old');
    eq(Store.loadHistory().length, 1, 'migrated history imported');
    /* 迁移写回单文件且清理旧键 */
    assert(fsData['internal://app/data/bm.txt'] !== undefined, 'bookmark written to single file');
    assert(fsData['internal://app/data/hs.txt'] !== undefined, 'history written to single file');
    eq(storageData[Config.KEY_BOOKMARKS], undefined, 'legacy key cleaned');
    /* 二次冷启动只走单文件 */
    Storage_reset(Store);
    Store.resetState();
    Store.init();
    eq(Store.loadBookmarks().length, 1, 'file channel survives restart');
  });

  test('v3.1 part shards migrate to the single file once (v3.4)', function () {
    resetStorage();
    resetFile();
    /* v3.1~v3.3 分片格式：同一 JSON 串切成多片 */
    const json = JSON.stringify([{ url: 'https://old.example.com/x', title: '分片书签', savedAt: 7 }]);
    fsData['internal://app/data/bm.0'] = json.substring(0, 20);
    fsData['internal://app/data/bm.1'] = json.substring(20);
    Storage_reset(Store);
    Store.init();
    eq(Store.loadBookmarks().length, 1, 'shard merge imported');
    eq(Store.loadBookmarks()[0].title, '分片书签');
    assert(fsData['internal://app/data/bm.txt'] !== undefined, 'single file written');
    eq(fsData['internal://app/data/bm.0'], undefined, 'shard 0 reclaimed');
    eq(fsData['internal://app/data/bm.1'], undefined, 'shard 1 reclaimed');
    Storage_reset(Store);
    Store.resetState();
    Store.init();
    eq(Store.loadBookmarks().length, 1, 'single file survives restart');
  });

  test('byte budget drops oldest entries whole (long URLs never truncated)', function () {
    resetStorage();
    resetFile();
    Storage_reset(Store);
    Store.init();
    const longUrl = 'https://example.com/' + new Array(260).join('u'); /* 279 chars < MAX_URL_CHARS */
    for (let i = 0; i < 12; i += 1) {
      Store.saveBookmark({ url: longUrl + i, title: 'B' + i });
    }
    const raw = fsData['internal://app/data/bm.txt'];
    assert(raw !== undefined, 'persisted');
    assert(Buffer.byteLength(raw, 'utf8') <= 3900, 'single read budget kept: ' + Buffer.byteLength(raw, 'utf8'));
    /* 镜像未截断，落盘从新到旧装入；重启后只回读装下的条目 */
    Store.resetState();
    Store.init();
    const list = Store.loadBookmarks();
    assert(list.length < 12, 'oldest dropped by budget: ' + list.length);
    assert(list.length >= 8, 'most entries kept: ' + list.length);
    eq(list[0].url, longUrl + '11', 'newest kept');
    assert(list[0].url.length > 250, 'URL kept whole (no truncation)');
  });

  test('same-URL top refresh skips the disk write (browse-path write elimination)', function () {
    resetStorage();
    resetFile();
    Storage_reset(Store);
    Store.init();
    fileCalls.length = 0; /* init 的空表标记写不计入 */
    Store.addHistory({ url: 'https://example.com/visit', title: 'V' });
    Store.addHistory({ url: 'https://example.com/visit', title: 'V2' });
    Store.addHistory({ url: 'https://example.com/other', title: 'O' });
    const writes = fileCalls.filter((c) => c[0] === 'writeText' && c[1] === 'internal://app/data/hs.txt');
    eq(writes.length, 2, 'first add + new-URL add write; repeat visit is memory-only');
    eq(Store.loadHistory().length, 2);
    eq(Store.loadHistory()[0].title, 'O');
  });

  section('session');
  const Session = loadCommon('session');

  test('session keeps at most one full document (v3.5 heap peak guard)', function () {
    Session.reset();
    Session.open({ url: 'https://a.example.com/1', title: 'A', text: 'aaa' }, 3);
    Session.open({ url: 'https://a.example.com/2', title: 'B', text: 'bbb' }, 1);
    Session.open({ url: 'https://a.example.com/3', title: 'C', text: 'ccc' }, 0);
    eq(Session.docCount(), 1);
    eq(Session.getDoc('https://a.example.com/1'), null);
    eq(Session.getDoc('https://a.example.com/2'), null);
    assert(Session.getDoc('https://a.example.com/3') !== null, 'newest doc kept');
  });

  test('dropDocs releases residency before a new fetch (ch3 crash regression)', function () {
    /* 创世中文网第三章加载崩溃锚点：加载峰值（响应+截断副本+分块+拼接）
       不能叠加旧文档驻留——开抓前 dropDocs 全部释放，元数据保留可重抓。 */
    eq(Session.docCount(), 1);
    Session.dropDocs();
    eq(Session.docCount(), 0, 'no resident docs during the next load');
    eq(Session.getFrame('https://a.example.com/3').pageIndex, 0, 'frame metadata survives');
    assert(Session.getDoc('https://a.example.com/3') === null, 'doc ref dropped');
  });

  test('page index survives document eviction', function () {
    eq(Session.getPage('https://a.example.com/2'), 1);
    Session.setPage('https://a.example.com/2', 7);
    eq(Session.getPage('https://a.example.com/2'), 7);
    eq(Session.getFrame('https://a.example.com/1').pageIndex, 3);
  });

  test('push and pop walk the frame history', function () {
    Session.push('https://a.example.com/2', null, 7);
    eq(Session.getCurrent().url, 'https://a.example.com/2');
    const popped = Session.pop();
    assert(popped !== null, 'pop returns a frame');
    eq(Session.getCurrent().url, popped.url);
  });

}

/* 离线示例模块 sample.js 已在 1.2.0 瘦身时删除，对应用例随之移除。 */
function runGestureCases() {
  section('gesture');
  const G = loadCommon('gesture');

  test('swipe direction is normalized from strings and numbers', function () {
    eq(G.swipeDir({ direction: 'right' }), 'right');
    eq(G.swipeDir({ direction: 'UP' }), 'up');
    eq(G.swipeDir({ dir: 'down' }), 'down');
    eq(G.swipeDir({ direction: 1 }), 'down');
    eq(G.swipeDir({ direction: 3 }), 'right');
    eq(G.swipeDir({}), '');
    eq(G.swipeDir(null), '');
    eq(G.swipeDir({ direction: 'diagonal' }), '');
  });

  test('dirOf normalizes touch-event directions incl. falsy numeric 0', function () {
    eq(G.dirOf({ direction: 'up' }), 'up');
    eq(G.dirOf({ direction: 0 }), 'up', 'numeric 0 (up) 是 falsy，必须显式判定（斜向运动回归点）');
    eq(G.dirOf({ direction: 1 }), 'down');
    eq(G.dirOf({ direction: 2 }), 'left');
    eq(G.dirOf({ direction: 3 }), 'right');
    eq(G.dirOf({ direction: 'Down' }), 'down', '大小写归一');
    eq(G.dirOf({ dir: 'left' }), 'left', 'dir 字段兑底');
    eq(G.dirOf({ direction: 'diagonal' }), '');
    eq(G.dirOf({}), '');
    eq(G.dirOf(null), '');
  });

  test('touch delta maps to direction with thresholds', function () {
    eq(G.swipeFromDelta({ x: 100, y: 100 }, { x: 100, y: 40 }), 'up');
    eq(G.swipeFromDelta({ x: 100, y: 100 }, { x: 100, y: 200 }), 'down');
    eq(G.swipeFromDelta({ x: 100, y: 100 }, { x: 200, y: 100 }), 'right');
    eq(G.swipeFromDelta({ x: 100, y: 100 }, { x: 0, y: 100 }), 'left');
    /* 横向阈值 100px（LW-BACK-01 防误触）：90px 位移不触发 */
    eq(G.swipeFromDelta({ x: 100, y: 100 }, { x: 10, y: 100 }), '');
    eq(G.swipeFromDelta({ x: 100, y: 100 }, { x: 105, y: 105 }), '');
    eq(G.swipeFromDelta(null, { x: 1, y: 1 }), '');
  });

  test('swipe events honor distance threshold', function () {
    eq(G.swipeDir({ direction: 'right', distance: 120 }), 'right');
    eq(G.swipeDir({ direction: 'right', distance: 60 }), '', '短滑不触发返回');
    eq(G.swipeDir({ direction: 'right' }), 'right', '无 distance 字段放行');
    eq(G.swipeDir({ direction: 'up', distance: 30 }), 'up');
  });

  test('remember / take round-trip on page instance', function () {
    const vm = {};
    G.remember(vm, { touches: [{ clientX: 50, clientY: 300 }] });
    eq(G.take(vm, { touches: [{ clientX: 50, clientY: 220 }] }), 'up');
    eq(vm.gestureOrigin, null);
    eq(G.take(vm, { touches: [{ clientX: 50, clientY: 220 }] }), '');
  });

  test('pointOf parses touches list and direct coordinates', function () {
    eq(G.pointOf({ touches: [{ clientX: 10, clientY: 20 }] }).x, 10);
    eq(G.pointOf({ touches: [{ x: 5, y: 6 }] }).y, 6);
    eq(G.pointOf({ clientX: 3, clientY: 4 }).x, 3);
    eq(G.pointOf(null), null);
    eq(G.pointOf({}), null);
  });
}

function runSearchCases() {
  section('search');
  const Search = loadCommon('search');
  const SearchCfg = loadCommon('searchcfg');

  test('buildUrl encodes the query into the RSS endpoint', function () {
    const url = Search.buildUrl('轻小说');
    assert(url.indexOf(SearchCfg.URL_BASE) === 0, 'base prefix: ' + url);
    assert(url.indexOf(' ') < 0, 'no raw spaces');
    assert(url.indexOf('first=') < 0, 'single-request url has no paging param');
    eq(Search.buildUrl('  '), '');
    eq(Search.buildUrl(''), '');
  });

  const RSS_OK =
    '<?xml version="1.0"?><rss version="2.0"><channel><title>必应：测试</title>' +
    '<item><title>第一篇 &amp; 测试</title><link>https://a.example.com/x</link>' +
    '<description>这是第一条摘要，<em>含高亮</em>标签。</description><pubDate>x</pubDate></item>' +
    '<item><title>第二篇</title><link>https://b.example.com/y</link>' +
    '<description>第二条摘要文本。</description></item>' +
    '</channel></rss>';

  test('parses rss items with title, subtitle, full summary and host', function () {
    const r = Search.parse(RSS_OK);
    eq(r.kind, 'ok');
    eq(r.items.length, 2);
    eq(r.items[0].title, '第一篇 & 测试');
    eq(r.items[0].url, 'https://a.example.com/x');
    eq(r.items[0].host, 'a.example.com');
    eq(r.items[0].sub, '这是第一条摘要，含高亮标签。');
    eq(r.items[0].summary, '这是第一条摘要，含高亮标签。');
    assert(r.items[0].summary.indexOf('<em>') < 0, 'tags stripped');
    eq(r.items[1].url, 'https://b.example.com/y');
  });

  test('caps results at 10 and truncates subtitle to one line', function () {
    let xml = '<?xml version="1.0"?><rss version="2.0"><channel>';
    for (let i = 0; i < 15; i += 1) {
      xml += '<item><title>T' + i + '</title><link>https://e' + i + '.com/a</link>' +
        '<description>S' + i + '</description></item>';
    }
    xml += '</channel></rss>';
    const r = Search.parse(xml);
    eq(r.items.length, SearchCfg.MAX_RESULTS);
    eq(SearchCfg.MAX_RESULTS, 10);
    eq(r.items[0].title, 'T0');
    eq(r.items[9].title, 'T9');

    let long = '';
    for (let i = 0; i < 120; i += 1) {
      long += '题';
    }
    let sum = '';
    for (let i = 0; i < 800; i += 1) {
      sum += '摘';
    }
    const xml2 = '<?xml version="1.0"?><rss version="2.0"><channel>' +
      '<item><title>' + long + '</title><link>https://x.com/a</link>' +
      '<description>' + sum + '</description></item></channel></rss>';
    const r2 = Search.parse(xml2);
    eq(r2.items[0].title.length, SearchCfg.TITLE_CHARS);
    eq(r2.items[0].sub.length, SearchCfg.SUBTITLE_CHARS);
    eq(r2.items[0].summary.length, SearchCfg.SUMMARY_FULL_CHARS);
  });

  test('non-xml payload is classified as error, empty rss as empty', function () {
    eq(Search.parse('<html><body>被拦截了</body></html>').kind, 'error');
    eq(Search.parse('<?xml version="1.0"?><rss version="2.0"><channel></channel></rss>').kind, 'empty');
    eq(Search.parse('').kind, 'error');
    eq(Search.parse(null).kind, 'error');
  });
}

function runFadeCases() {
  section('fade');
  const Fade = loadCommon('fade');

  test('fadeIn starts from the dim step and owns one timer', function () {
    const vm = { fadeOpacity: 1 };
    Fade.fadeIn(vm);
    eq(vm.fadeOpacity, 0.35, 'starts dim');
    assert(vm.__fadeTimer > 0, 'timer armed');
    const first = vm.__fadeTimer;
    Fade.fadeIn(vm);
    assert(vm.__fadeTimer !== first, 're-fade replaces the previous timer');
    Fade.cancel(vm);
  });

  test('cancel restores full opacity and clears the timer', function () {
    const vm = { fadeOpacity: 1 };
    Fade.fadeIn(vm);
    Fade.cancel(vm);
    eq(vm.fadeOpacity, 1);
    eq(vm.__fadeTimer, 0);
    Fade.cancel(vm);
    eq(vm.fadeOpacity, 1, 'cancel is idempotent');
    Fade.cancel(null);
    eq(Fade.INTERVAL, 32, 'transition budget ≈ 160ms over 5 steps');
  });
}

function runNavruleCases() {
  section('navrule');
  const Nav = loadCommon('navrule');

  test('chapter titles are recognized (v3.3: long titles, numeric forms, sections)', function () {
    eq(Nav.isChapterText('第一章'), true);
    eq(Nav.isChapterText('第12章 旧版修复'), true);
    eq(Nav.isChapterText(' 第100回 '), true);
    eq(Nav.isChapterText('第5话'), true);
    eq(Nav.isChapterText('第一卷序章'), true);
    eq(Nav.isChapterText('说明'), false);
    eq(Nav.isChapterText('第'), false);
    /* v3.3 修复：长章节标题（>20 字，小说站常态）旧版全部漏判 */
    eq(Nav.isChapterText('第一章这是一段非常非常非常非常长的标题文本超过二十'), true);
    eq(Nav.isChapterText('第两百三十四章 我有一剑可开天门（第一更求票）'), true);
    /* v3.3 修复：纯数字编号目录条目 */
    eq(Nav.isChapterText('12. 风起'), true);
    eq(Nav.isChapterText('012、龙王归来'), true);
    eq(Nav.isChapterText('3章'), true);
    /* v3.3 修复：卷首/卷尾语条目与装饰括号 */
    eq(Nav.isChapterText('楔子'), true);
    eq(Nav.isChapterText('番外一 归乡'), true);
    eq(Nav.isChapterText('【第十二章】龙王'), true);
    /* 误判防线 */
    eq(Nav.isChapterText('上一章'), false);
    eq(Nav.isChapterText('下一章'), false);
    eq(Nav.isChapterText('3.14 版本更新说明'), false);
    eq(Nav.isChapterText(''), false);
    eq(Nav.isChapterText(null), false);
  });

  test('findChapterToken normalizes labels', function () {
    const t = Nav.findChapterToken('书名 第 12 章 龙王');
    assert(t !== null, 'token found');
    eq(t.label, '第12章', 'spaces compacted');
    const b = Nav.findChapterToken('012、风起');
    eq(b.label, '第12章', 'numeric form normalized');
    eq(Nav.findChapterToken('普通标题'), null);
  });

  test('offline title recognition: 书名 + 第n章 (v3.3)', function () {
    eq(Nav.offlineTitle('《龙族》第十二章 龙王最新章节', ''), '龙族 第十二章');
    eq(Nav.offlineTitle('龙族_第十二章 龙王_顶点小说', ''), '龙族 第十二章');
    eq(Nav.offlineTitle('第十二章 龙王-龙族-笔趣阁', ''), '龙族 第十二章');
    eq(Nav.offlineTitle('012、风起-龙族-笔趣阁', ''), '龙族 第12章');
    /* 标题无章号时回退正文首行识别 */
    eq(Nav.offlineTitle('龙族最新章节_笔趣阁', '第十二章 龙王\n正文开始'), '龙族 第十二章');
    /* 书名或章号任一识别不出 → 空串，调用方回退原网页标题 */
    eq(Nav.offlineTitle('第十二章 龙王传说', ''), '');
    eq(Nav.offlineTitle('普通网页标题', ''), '');
    eq(Nav.offlineTitle('', ''), '');
  });

  test('start-reading texts are recognized', function () {
    eq(Nav.isStartText('开始阅读'), true);
    eq(Nav.isStartText(' 立即阅读 '), true);
    eq(Nav.isStartText('开始阅读本书'), true);
    eq(Nav.isStartText('阅读'), false, 'too generic');
    eq(Nav.isStartText('阅读设置'), false);
    eq(Nav.isStartText(''), false);
  });
}

function runCacheRemovedCases() {
  section('cache(removed)');
  const fs2 = require('fs');
  const path2 = require('path');

  test('web cache removed: cache.js deleted with the feature (v3.3)', function () {
    /* 网页缓存功能 v3.3 整体删除（用户决策：实际作用感知不大，离线网页保留）。
       删除同时根除 v3.1 起「Cache.save 写分片与翻页 loadRange 读同批文件」
       竞态/锁悬挂崩溃类——阅读与翻页热路径不再触碰 @system.file。 */
    const gone = !fs2.existsSync(path2.join(COMMON_DIR, 'cache.js'));
    eq(gone, true, 'cache.js should be deleted');
  });

  test('no source module still imports the removed cache', function () {
    const srcRoot = path2.join(ROOT_DIR, 'entry', 'src', 'main', 'js', 'MainAbility');
    const files = [
      'app.js',
      'pages/reader/reader.js',
      'pages/index/index.js',
      'common/space.js',
      'common/fsutil.js'
    ];
    files.forEach(function (rel) {
      const src = fs2.readFileSync(path2.join(srcRoot, rel), 'utf8');
      assert(src.indexOf('cache.js') < 0, rel + ' must not reference cache.js');
    });
  });

  test('reader paging is pure in-memory slicing (no file channel)', function () {
    const srcRoot = path2.join(ROOT_DIR, 'entry', 'src', 'main', 'js', 'MainAbility');
    const src = fs2.readFileSync(path2.join(srcRoot, 'pages/reader/reader.js'), 'utf8');
    assert(src.indexOf('loadRange') < 0, 'no lazy file-range reads in reader');
    assert(src.indexOf('Paginate.pageText') >= 0, 'memory slice is the only paging path');
    assert(src.indexOf('Cache.') < 0, 'no cache calls remain');
  });

  test('fsutil mutex: read waits for in-flight write on the same base (v3.1 黑屏回归)', function () {
    /* 3.1 崩溃根因：install() 写分片与首屏翻页区间读同批文件并发 →
       真机 FS 读写竞态黑屏。v3.2 互斥锁：写链持锁、读排队。缓存删除后
       锁继续保护 store/saved 数据，此锚点防互斥退化。 */
    resetFs();
    const pending = [];
    const original = fileMock.writeText;
    fileMock.writeText = function (options) {
      pending.push(function () {
        fsData[options.uri] =
          (options.append ? (fsData[options.uri] || '') : '') + (options.text || '');
        if (options.success) options.success();
      });
    };
    const Fs = loadCommon('fsutil');
    let writeDone = false;
    Fs.writeParts('internal://app/data/race.', '竞态测试正文', 20, (ok) => { writeDone = ok; });
    eq(writeDone, false, 'write still in flight');
    let readState = 'waiting';
    Fs.readParts('internal://app/data/race.', 20, (t) => { readState = t; });
    eq(readState, 'waiting', 'read must queue behind the in-flight write');
    while (pending.length > 0) {
      pending.shift()();
    }
    eq(writeDone, true, 'write completes after flush');
    eq(readState, '竞态测试正文', 'queued read released with complete content');
    fileMock.writeText = original;
    resetFs();
  });

  test('delete chains advance when file.delete callbacks are lost (v3.3 加固)', function () {
    /* v3.2 残留死锁面：quietDeleteRange/deleteList 无守卫，一步 delete 回调
       丢失即永久悬挂（writeParts 尾清持锁路径会卡死后续同基名读写），
       与 3.1 表现一致。v3.3 逐步守卫推进；此处用伪定时器同步验证。 */
    resetFs();
    const originalDelete = fileMock.delete;
    fileMock.delete = function () { /* 吞掉全部回调 */ };
    const realSet = global.setTimeout;
    const realClear = global.clearTimeout;
    const timers = [];
    global.setTimeout = function (fn, ms) {
      const t = { fn: fn, ms: ms, cancelled: false };
      timers.push(t);
      return t;
    };
    global.clearTimeout = function (t) {
      if (t) {
        t.cancelled = true;
      }
    };
    const Fs = loadCommon('fsutil');
    fsData['internal://app/data/d.0'] = 'x';
    let done = false;
    Fs.quietDeleteRange('internal://app/data/d.', 0, 3, () => { done = true; });
    eq(done, false, 'chain stalls while delete callbacks are lost');
    let rounds = 0;
    while (!done && rounds < 12) {
      const t = timers.shift();
      if (!t) {
        break;
      }
      if (!t.cancelled) {
        t.fn();
      }
      rounds += 1;
    }
    eq(done, true, 'guard timers advance the chain to completion');
    global.setTimeout = realSet;
    global.clearTimeout = realClear;
    fileMock.delete = originalDelete;
    resetFs();
  });

  test('global queue: at most one file op in flight (browse-crash regression, v3.7)', function () {
    /* 浏览崩溃贯穿 3.1~3.6 的公共面：并行 file 调用（store 多链 + 路由参数 +
       离线读取 = 3~6 个同时在飞）。v2.4~v3.0 全程串行故稳定。全局 FIFO 队列
       把所有原生调用压回同一时刻至多 1 个。 */
    resetFs();
    const pending = [];
    const origWrite = fileMock.writeText;
    fileMock.writeText = function (options) {
      /* 回调暂扣，模拟真机慢回调；放行时才落盘 */
      pending.push(function () {
        fsData[options.uri] = options.text || '';
        if (options.success) options.success();
      });
    };
    try {
      const Fs = loadCommon('fsutil');
      let done1 = 'x';
      let done2 = 'x';
      let done3 = 'x';
      Fs.writeSmall('internal://app/data/a.txt', '1', (ok) => { done1 = ok; });
      Fs.writeSmall('internal://app/data/a.txt', '2', (ok) => { done2 = ok; });
      eq(pending.length, 1, 'only the first op is in flight');
      eq(done2, 'x', 'second op queued');
      pending.shift()();
      eq(done1, true, 'first released');
      eq(pending.length, 1, 'second op now in flight');
      pending.shift()();
      eq(done2, true, 'second released');
      Fs.readSmall('internal://app/data/a.txt', (t) => { done3 = t; });
      eq(done3, '2', 'serial writes land in order, read sees last write');
    } finally {
      fileMock.writeText = origWrite;
      resetFs();
    }
  });

  test('deleteList also carries per-step guards', function () {
    resetFs();
    const originalDelete = fileMock.delete;
    fileMock.delete = function () { /* 吞掉全部回调 */ };
    const realSet = global.setTimeout;
    const realClear = global.clearTimeout;
    const timers = [];
    global.setTimeout = function (fn, ms) {
      const t = { fn: fn, ms: ms, cancelled: false };
      timers.push(t);
      return t;
    };
    global.clearTimeout = function (t) {
      if (t) {
        t.cancelled = true;
      }
    };
    const Fs = loadCommon('fsutil');
    let done = false;
    Fs.deleteList(['internal://app/saved/a.0', 'internal://app/saved/a.1'], () => { done = true; });
    eq(done, false, 'chain stalls while delete callbacks are lost');
    let rounds = 0;
    while (!done && rounds < 12) {
      const t = timers.shift();
      if (!t) {
        break;
      }
      if (!t.cancelled) {
        t.fn();
      }
      rounds += 1;
    }
    eq(done, true, 'guard timers advance the chain to completion');
    global.setTimeout = realSet;
    global.clearTimeout = realClear;
    fileMock.delete = originalDelete;
    resetFs();
  });
}

function runSavedCases() {
  section('saved(offline v2)');
  const Saved = loadCommon('saved');

  function resetFile() {
    Object.keys(fsData).forEach((k) => delete fsData[k]);
    fileCalls.length = 0;
    fileMock.charMode = true;
  }

  test('keyOf is deterministic short ASCII', function () {
    const a = Saved.keyOf('https://example.com/a', 1700000000001);
    eq(a, Saved.keyOf('https://example.com/a', 1700000000001));
    assert(a !== Saved.keyOf('https://example.com/b', 1700000000001), 'distinct');
    eq(/^o[0-9a-f]+[0-9]{5}$/.test(a), true, 'ascii key: ' + a);
    assert(a.length <= 20, 'short key keeps file uri under 128 chars');
  });

  test('multi-part save/list/load round-trips in char-offset mode', function () {
    resetFile();
    const text = new Array(2601).join('中') + 'tail';
    let ok = 'unset';
    Saved.save({ url: 'https://ex.com/p1', title: '标题' }, text, null, (r) => { ok = r; });
    eq(ok, true, 'save ok');
    let items = [];
    Saved.list((l) => { items = l; });
    eq(items.length, 1);
    eq(items[0].parts, 3, '2604 chars -> 3 parts of <=1200');
    let back = '';
    Saved.load(items[0].key, items[0].parts, (t) => { back = t; });
    eq(back, text, 'char-mode round-trip exact');
  });

  test('12000-char save caps at 4600 chars -> 4 parts, marker, round-trip (v1.0.5 rollback)', function () {
    /* 真机实测：5 片（≤7 次调用）仍崩（v1.0.4），4 片（≤6 次）稳定（v1.0.3）——
       稳定阈值在 6 次调用以内。此用例锁定回退后的封顶值与分片数。 */
    resetFile();
    const text = new Array(12001).join('字');
    const seen = [];
    let ok = 'unset';
    Saved.save({ url: 'https://chuangshi.qq.com/read/933334/3', title: '龙族 第3章' }, text,
      (written, total) => { seen.push(written + '/' + total); },
      (r) => { ok = r; });
    eq(ok, true, 'save ok');
    const partKeys = Object.keys(fsData).filter((k) => k.indexOf('internal://app/saved/') === 0 && k.indexOf('list.txt') < 0);
    eq(partKeys.length, 4, '4600+marker chars -> exactly 4 part files');
    eq(partKeys.every((k) => fsData[k].length <= 1200), true, 'every part <= 1200 chars');
    eq(seen.length, 5, 'progress: 4 parts + list step (total=parts+1)');
    eq(seen[0], '1/5', 'first progress');
    eq(seen[4], '5/5', 'final progress equals total');
    let items = [];
    Saved.list((l) => { items = l; });
    eq(items[0].parts, 4);
    let back = '';
    Saved.load(items[0].key, items[0].parts, (t) => { back = t; });
    eq(back.length, 4600 + '\n（离线内容已截断，完整内容请联网阅读）'.length, 'round-trip length = cap + marker');
    eq(back.indexOf('（离线内容已截断，完整内容请联网阅读）') > 0, true, 'truncation marker appended');
    eq(back.substring(0, 4600) === text.substring(0, 4600), true, 'capped body byte-identical');
  });

  test('multi-part round-trips unchanged in byte-offset mode (v1 corruption regression)', function () {
    resetFile();
    fileMock.charMode = false;
    const text = new Array(2601).join('中') + 'tail';
    let ok = 'unset';
    Saved.save({ url: 'https://ex.com/p2', title: '标题' }, text, null, (r) => { ok = r; });
    eq(ok, true, 'save ok');
    let items = [];
    Saved.list((l) => { items = l; });
    let back = '';
    Saved.load(items[0].key, items[0].parts, (t) => { back = t; });
    eq(back, text, 'byte-mode round-trip exact (part files use no position)');
    fileMock.charMode = true;
  });

  test('progress advances monotonically and ends at total', function () {
    resetFile();
    const text = new Array(3601).join('x');
    const marks = [];
    Saved.save({ url: 'https://ex.com/p3', title: 't' }, text,
      (w, total) => { marks.push([w, total]); }, () => {});
    eq(marks.length, 4, '3 parts + manifest step');
    for (let i = 0; i < marks.length; i += 1) {
      if (i > 0) {
        assert(marks[i][0] >= marks[i - 1][0], 'monotonic at ' + i);
      }
      assert(marks[i][0] <= marks[i][1], 'written <= total at ' + i);
    }
    eq(marks[marks.length - 1][0], marks[marks.length - 1][1], 'ends complete');
  });

  test('same url overwrites: one entry, new content, old parts reclaimed', function () {
    resetFile();
    Saved.save({ url: 'https://ex.com/dup', title: 'A' }, '旧正文旧正文', null, () => {});
    Saved.save({ url: 'https://ex.com/dup', title: 'B' }, '新正文新正文', null, () => {});
    let items = [];
    Saved.list((l) => { items = l; });
    eq(items.length, 1, 'deduped');
    eq(items[0].title, 'B');
    let back = '';
    Saved.load(items[0].key, items[0].parts, (t) => { back = t; });
    eq(back, '新正文新正文', 'new content wins');
  });

  test('capacity keeps newest 12 entries and evicts oldest', function () {
    resetFile();
    for (let i = 0; i < 15; i += 1) {
      Saved.save({ url: 'https://ex.com/cap' + i, title: 't' + i }, 'x', null, () => {});
    }
    let items = [];
    Saved.list((l) => { items = l; });
    eq(items.length, 12, 'MAX entries');
    eq(items[0].title, 't14', 'newest first');
    eq(items[11].title, 't3', 'oldest kept is t3');
  });

  test('remove drops entry and its part files', function () {
    resetFile();
    const text = new Array(2601).join('中');
    Saved.save({ url: 'https://ex.com/rm', title: 'rm' }, text, null, () => {});
    let items = [];
    Saved.list((l) => { items = l; });
    const key = items[0].key;
    eq(fsData['internal://app/saved/' + key + '.0'] !== undefined, true, 'part 0 exists');
    let ok = 'unset';
    Saved.remove(key, items[0].parts, (r) => { ok = r; });
    eq(ok, true);
    eq(fsData['internal://app/saved/' + key + '.0'], undefined, 'part 0 deleted');
    let after = [];
    Saved.list((l) => { after = l; });
    eq(after.length, 0, 'entry gone');
  });

  test('manifest stays under the 4KB single-read budget with capped fields', function () {
    resetFile();
    const longTitle = new Array(31).join('标') + '题'; /* 30 chars before cap */
    for (let i = 0; i < 12; i += 1) {
      /* URL 前 100 字符内区分，避免截断后同址去重 */
      const longUrl = 'https://ex.com/' + i + '/' + new Array(121).join('u');
      Saved.save({ url: longUrl, title: longTitle }, 'x', null, () => {});
    }
    const raw = fsData['internal://app/saved/list.txt'];
    assert(raw !== undefined, 'manifest written');
    assert(Buffer.byteLength(raw, 'utf8') < 4000, 'manifest < 4KB: ' + Buffer.byteLength(raw, 'utf8'));
    let items = [];
    Saved.list((l) => { items = l; });
    eq(items.length, 12);
    assert(items[0].title.length <= 28, 'title capped at 28 (v3.3)');
    assert(items[0].url.length <= 100, 'url capped');
  });

  test('file exceptions degrade: callbacks fire once, never throw', function () {
    resetFile();
    const originalWrite = fileMock.writeText;
    fileMock.writeText = function () { throw new Error('file unavailable'); };
    let saveCount = 0;
    Saved.save({ url: 'https://ex.com/boom', title: 'b' }, 'abc', null, () => { saveCount += 1; });
    eq(saveCount, 1, 'save callback once despite exception');
    fileMock.writeText = originalWrite;

    const originalRead = fileMock.readText;
    fileMock.readText = function () { throw new Error('file unavailable'); };
    let items = 'unset';
    Saved.list((l) => { items = l; });
    eq(items.length, 0, 'list degrades to empty');
    let back = 'unset';
    Saved.load('k', 3, (t) => { back = t; });
    eq(back, '', 'load degrades to empty');
    fileMock.readText = originalRead;
    resetFile();
  });
}

function runRouteCases() {
  section('route(params file channel)');
  const Route = loadCommon('route');

  function resetFile() {
    Object.keys(fsData).forEach((k) => delete fsData[k]);
    fileCalls.length = 0;
    fileMock.charMode = true;
    resetStorage();
  }

  test('go persists full params to the file channel (beyond 128-byte storage limit)', function () {
    resetFile();
    const big = { offline: 1, key: 'oabc123456789', title: new Array(25).join('长'), parts: 12 };
    Route.go('pages/reader/reader', big);
    const raw = fsData['internal://app/lwb_route.txt'];
    assert(raw !== undefined, 'params file written');
    assert(Buffer.byteLength(JSON.stringify(big), 'utf8') > 128, 'payload really exceeds 128 bytes');
    eq(JSON.parse(raw).title, big.title, 'full payload preserved');
    Route.goHome();
  });

  test('takeAsync reads params from the file when module channel is empty', function () {
    resetFile();
    Route.goHome(); /* 清空模块级通道，模拟独立 bundle 页面 */
    fsData['internal://app/lwb_route.txt'] = JSON.stringify({ offline: 1, key: 'k1', title: '标题', parts: 3 });
    let got = 'unset';
    Route.takeAsync((p) => { got = p; });
    assert(got !== null, 'params returned');
    eq(got.key, 'k1');
    eq(got.parts, 3);
  });

  test('takeAsync falls back to storage when the file is missing', function () {
    resetFile();
    Route.goHome();
    storageData['lwb_route_params'] = JSON.stringify({ url: 'https://ex.com/x' });
    let got = 'unset';
    Route.takeAsync((p) => { got = p; });
    assert(got !== null, 'storage fallback works');
    eq(got.url, 'https://ex.com/x');
  });

  test('takeAsync yields null when neither channel has params', function () {
    resetFile();
    Route.goHome();
    let got = 'unset';
    Route.takeAsync((p) => { got = p; });
    eq(got, null, 'no stale params');
  });

  test('setCurrent/getCurrent use the file channel for long URLs (A2)', function () {
    resetFile();
    const longUrl = 'https://example.com/' + new Array(200).join('u');
    assert(longUrl.length > 128, 'URL really exceeds the storage limit');
    Route.setCurrent(longUrl);
    eq(fsData['internal://app/lwb_cur.txt'], longUrl, 'file channel holds the full URL');
    /* 模拟独立 bundle 页 + storage 静默失败：只能从文件读回 */
    globalThis.__lwbCurrentUrl = '';
    delete storageData['lwb_current_url'];
    let got = 'unset';
    Route.getCurrent((u) => { got = u; });
    eq(got, longUrl, 'getCurrent falls through to the file channel');
    Route.setCurrent('');
  });

  test('setCurrent keeps short URLs in storage only and dedupes (v3.4 browse path)', function () {
    resetFile();
    const shortUrl = 'https://example.com/short';
    Route.setCurrent(shortUrl);
    Route.setCurrent(shortUrl); /* fetch/install 各调一次：第二次必须零操作 */
    eq(fsData['internal://app/lwb_cur.txt'], undefined, 'no file write for short URLs');
    eq(storageData['lwb_current_url'], shortUrl, 'storage holds it');
    globalThis.__lwbCurrentUrl = '';
    let got = 'unset';
    Route.getCurrent((u) => { got = u; });
    eq(got, shortUrl, 'getCurrent reads the storage channel');
    Route.setCurrent('');
  });
}

function runLinkpassCases() {
  section('linkpass(toc cross-page channel)');
  const Lp = loadCommon('linkpass');

  function resetFile() {
    Object.keys(fsData).forEach((k) => delete fsData[k]);
    fileCalls.length = 0;
    fileMock.charMode = true;
  }

  test('save/load round-trips the toc payload across bundles', function () {
    resetFile();
    const payload = {
      title: '龙族',
      url: 'https://example.com/longzu/',
      pageIndex: 2,
      links: [
        { text: '第十二章 龙王', href: 'https://example.com/longzu/12.html' },
        { text: '开始阅读', href: 'https://example.com/longzu/1.html' }
      ]
    };
    let saved = 'unset';
    Lp.save(payload, (ok) => { saved = ok; });
    eq(saved, true);
    let got = null;
    Lp.load((p) => { got = p; });
    assert(got !== null, 'payload returned');
    eq(got.title, '龙族');
    eq(got.pageIndex, 2);
    eq(got.links.length, 2);
    eq(got.links[0].text, '第十二章 龙王');
    eq(got.links[1].href, 'https://example.com/longzu/1.html');
  });

  test('load yields null without payload or on corrupted data', function () {
    resetFile();
    let got = 'unset';
    Lp.load((p) => { got = p; });
    eq(got, null, 'no payload -> null');
    fsData['internal://app/lwb_link.0'] = '{broken json';
    got = 'unset';
    Lp.load((p) => { got = p; });
    eq(got, null, 'corrupted -> null');
    resetFile();
  });

  test('mergeLinks puts chapter links first and dedupes by href', function () {
    /* 大站正文页 419 章目录排在 HTML 后段，前 40 条链接被页头导航灌满——
       章节优先合并保证「目录」可用（v3.5）。 */
    const chapters = [
      { text: '第1章 献词', href: 'https://c.qq.com/r/1' },
      { text: '第2章', href: 'https://c.qq.com/r/2' }
    ];
    const links = [
      { text: '加入书架', href: 'https://c.qq.com/shelf' },
      { text: '第1章 献词', href: 'https://c.qq.com/r/1' }, /* 重复 href 去重 */
      { text: '下载APP', href: 'https://c.qq.com/app' }
    ];
    const merged = Lp.mergeLinks(chapters, links);
    eq(merged.length, 4, 'deduped total');
    eq(merged[0].text, '第1章 献词', 'chapters first');
    eq(merged[1].href, 'https://c.qq.com/r/2');
    eq(merged[2].text, '加入书架');
    /* 上限 40 */
    const many = [];
    for (let i = 0; i < 60; i += 1) {
      many.push({ text: 'L' + i, href: 'https://c.qq.com/' + i });
    }
    eq(Lp.mergeLinks(many, many).length, 40, 'capped at 40');
  });

  test('mergeLinks drops TOC-nav links (整本目录页 = 必崩, v3.10)', function () {
    const chapters = [{ text: '第1章 献词', href: 'https://c.qq.com/r/1' }];
    const links = [
      { text: '返回目录', href: 'https://chuangshi.qq.com/chapter/933334' },
      { text: '第2章 序幕', href: 'https://c.qq.com/r/2' },
      { text: '目录', href: 'https://chuangshi.qq.com/chapter/933334' },
      { text: '全部章节', href: 'https://c.qq.com/list/9' }
    ];
    const merged = Lp.mergeLinks(chapters, links);
    eq(merged.length, 2, 'TOC-nav items filtered out');
    eq(merged[0].text, '第1章 献词');
    eq(merged[1].text, '第2章 序幕');
    /* 长标题里含「目录」二字不当导航拦截（长度 >12 直接放过） */
    const long = [{ text: '第99章 目录之力的觉醒与试炼', href: 'https://c.qq.com/r/99' }];
    eq(Lp.mergeLinks([], long).length, 1, 'long chapter title kept');
  });

  test('payload budget drops tail links whole; zero part files (v3.8 crash fix)', function () {
    /* 点「链接」瞬间崩溃 = 分片写首次保存的"幽灵分片删除洪峰"。单小文件化后：
       恰好 1 写 1 读、零分片零删除；超预算从尾部（非章节）整条丢弃。 */
    resetFile();
    const links = [];
    for (let i = 0; i < 60; i += 1) {
      links.push({ text: '第' + i + '章 标题标题', href: 'https://chuangshi.qq.com/read/933334/' + i });
    }
    let saved = 'unset';
    Lp.save({ title: '龙族', url: 'https://chuangshi.qq.com/read/933334/1', pageIndex: 0, links: links }, (ok) => { saved = ok; });
    eq(saved, true);
    const raw = fsData['internal://app/lwb_link.txt'];
    assert(raw !== undefined, 'single small file written');
    assert(Buffer.byteLength(raw, 'utf8') <= 3900, 'budget kept: ' + Buffer.byteLength(raw, 'utf8'));
    eq(fsData['internal://app/lwb_link.0'], undefined, 'no part files (phantom-delete source gone)');
    let got = null;
    Lp.load((p) => { got = p; });
    assert(got !== null, 'round-trips');
    assert(got.links.length < 60, 'tail links dropped: ' + got.links.length);
    assert(got.links.length >= 30, 'most links kept: ' + got.links.length);
    eq(got.links[0].href, 'https://chuangshi.qq.com/read/933334/0', 'front (chapters) preserved');
    eq(got.title, '龙族');
    eq(got.pageIndex, 0);
    resetFile();
  });
}

function runLayoutCases() {
  section('layout(GT 466 circle / FIT 408x480)');
  const Layout = loadCommon('layout');
  const Paginate = loadCommon('paginate');

  test('FIT rect profile keeps the original 408x480 geometry', function () {
    const g = Layout._pageFor(
      { screenShape: 'rect', windowWidth: 408, windowHeight: 480, apiVersion: 23 },
      'index'
    );
    eq(g.w, 408);
    eq(g.h, 480);
    eq(g.menuY, 94);
    eq(g.menuH, 384);
    eq(g.titleAlign, 'left');
    eq(g.round, false);
  });

  test('GT circle profile uses 466x466 and compressed vertical geometry', function () {
    const g = Layout._pageFor(
      { screenShape: 'circle', windowWidth: 466, windowHeight: 466, apiVersion: 23 },
      'index'
    );
    eq(g.w, 466);
    eq(g.h, 466);
    eq(g.menuY, 134);
    eq(g.menuH, 234);
    eq(g.titleAlign, 'center');
    eq(g.round, true);
  });

  test('square/round fallback by window ratio when screenShape is absent', function () {
    eq(Layout._pageFor({ windowWidth: 466, windowHeight: 466 }, 'reader').round, true);
    eq(Layout._pageFor({ windowWidth: 408, windowHeight: 480 }, 'reader').round, false);
  });

  test('v1.1.2 ai/rss pages have complete FIT and ROUND geometry', function () {
    const pages = ['ai', 'rss'];
    for (let i = 0; i < pages.length; i += 1) {
      const fit = Layout._pageFor({ screenShape: 'rect', windowWidth: 408, windowHeight: 480, apiVersion: 26 }, pages[i]);
      const rd = Layout._pageFor({ screenShape: 'circle', windowWidth: 466, windowHeight: 466, apiVersion: 26 }, pages[i]);
      eq(fit.w, 408);
      eq(rd.w, 466);
      eq(fit.round, false);
      eq(rd.round, true);
      assert(fit.hdrX !== undefined && rd.hdrX !== undefined, pages[i] + ' header geometry');
      assert(fit.listY > 0 && rd.listY > 0, pages[i] + ' list geometry');
    }
  });

  test('model fallback recognises GT / FIT when dimensions are absent', function () {
    eq(Layout._pageFor({ model: 'HUAWEI WATCH GT 5' }, 'reader').round, true);
    eq(Layout._pageFor({ model: 'HUAWEI WATCH FIT 5 Pro' }, 'reader').round, false);
  });

  test('network tier: FIT 20s / GT 45s / API<24 old 60s and smaller windows', function () {
    const fit = Layout._netFor({ screenShape: 'rect', apiVersion: 24 });
    const gt = Layout._netFor({ screenShape: 'circle', apiVersion: 24 });
    const old = Layout._netFor({ screenShape: 'circle', apiVersion: 20 });
    const old23 = Layout._netFor({ screenShape: 'circle', apiVersion: 23 });
    eq(fit.timeoutMs, 20000);
    eq(fit.maxHtml, 48000);
    eq(fit.respCapBytes, 98304);
    eq(fit.parseWindowChars, 44000);
    eq(fit.slow, false);
    eq(gt.timeoutMs, 45000);
    eq(gt.maxHtml, 40000);
    eq(gt.respCapBytes, 40960);
    eq(gt.parseWindowChars, 32000);
    eq(gt.loadMs, 30000);
    eq(gt.slow, true);
    eq(old.timeoutMs, 60000);
    eq(old.maxHtml, 32000);
    eq(old.maxText, 8000);
    eq(old.respCapBytes, 32000);
    eq(old.parseWindowChars, 28000);
    eq(old23.timeoutMs, 60000, 'API 23 also uses the old-device tier (threshold <24)');
  });

  test('apiVersion defensive parsing: string, number, missing', function () {
    const str = Layout._netFor({ screenShape: 'rect', apiVersion: '26.0.0' });
    eq(str.slow, false, 'string "26.0.0" parsed as 26 >= 24');
    const num = Layout._netFor({ screenShape: 'rect', apiVersion: 26 });
    eq(num.slow, false, 'number 26 >= 24');
    const missing = Layout._netFor({ screenShape: 'rect' });
    eq(missing.slow, true, 'missing apiVersion defaults to slow tier');
    const zero = Layout._netFor({ screenShape: 'rect', apiVersion: 0 });
    eq(zero.slow, true, 'apiVersion 0 defaults to slow tier');
  });

  test('Layout.init consumes device.getInfo and applies the GT profile', function () {
    const dev = MOCKS['@system.device'];
    const original = dev.getInfo;
    Layout._reset();
    dev.getInfo = function (options) {
      options.success({
        screenShape: 'circle',
        windowWidth: 466,
        windowHeight: 466,
        apiVersion: 24,
        model: 'HUAWEI WATCH GT 5'
      });
    };
    let got = null;
    Layout.init(function (p) {
      got = p;
    });
    eq(got && got.w, 466);
    eq(got && got.round, true);
    eq(Layout.isRound(), true);
    eq(loadCommon('config').MAX_HTML_CHARS, 32000);
    dev.getInfo = original;
    Layout._reset();
  });

  test('round reader body is shorter, so the same text paginates into more pages', function () {
    const text = '这是一段用于验证圆屏分页的测试正文。'.repeat(120);
    const fit = Layout._pageFor({ screenShape: 'rect' }, 'reader');
    const gt = Layout._pageFor({ screenShape: 'circle' }, 'reader');
    const pFit = Paginate.paginate(text, { fontSize: 24, width: 376, height: fit.bodyH });
    const pGt = Paginate.paginate(text, { fontSize: 24, width: 376, height: gt.bodyH });
    eq(pGt.pageCount > pFit.pageCount, true, 'round body 210 < fit body 320');
  });

  test('layout geometry lookup never mutates Config defaults', function () {
    const Config = loadCommon('config');
    Layout._pageFor({ screenShape: 'circle', apiVersion: 8 }, 'settings');
    eq(Config.MAX_HTML_CHARS, 44000);
    eq(Config.MAX_TEXT_CHARS, 12000);
    eq(Config.FETCH_TIMEOUT, 20000);
  });

  test('Route maps subpages to pages/round on circle, home stays index', function () {
    const Route = loadCommon('route');
    Layout._reset();
    eq(Route._targetUri('pages/reader/reader'), 'pages/reader/reader');
    eq(Route._targetUri('pages/index/index'), 'pages/index/index');
    const dev = MOCKS['@system.device'];
    const original = dev.getInfo;
    dev.getInfo = function (options) {
      options.success({ screenShape: 'circle', windowWidth: 466, windowHeight: 466, apiVersion: 24 });
    };
    Layout.init(function () {});
    eq(Route._targetUri('pages/reader/reader'), 'pages/round/reader/reader');
    eq(Route._targetUri('pages/round/reader/reader'), 'pages/round/reader/reader');
    eq(Route._targetUri('pages/index/index'), 'pages/index/index');
    dev.getInfo = original;
    Layout._reset();
  });

  test('every g.* field used by HML exists in both FIT and GT geometry', function () {
    const fs2 = require('fs');
    const path2 = require('path');
    const pagesDir = path2.join(
      ROOT_DIR, 'entry', 'src', 'main', 'js', 'MainAbility', 'pages'
    );
    const names = ['index', 'reader', 'search', 'links', 'shelf', 'settings', 'offline'];
    for (let i = 0; i < names.length; i += 1) {
      const name = names[i];
      const hml = fs2.readFileSync(path2.join(pagesDir, name, name + '.hml'), 'utf8');
      const used = {};
      const re = /g\.([A-Za-z0-9_]+)/g;
      let m;
      while ((m = re.exec(hml)) !== null) {
        used[m[1]] = true;
      }
      const fit = Layout._pageFor({ screenShape: 'rect', apiVersion: 23 }, name);
      const gt = Layout._pageFor({ screenShape: 'circle', apiVersion: 23 }, name);
      Object.keys(used).forEach((field) => {
        eq(Object.prototype.hasOwnProperty.call(fit, field), true, name + '.hml g.' + field + ' missing in FIT');
        eq(Object.prototype.hasOwnProperty.call(gt, field), true, name + '.hml g.' + field + ' missing in GT');
      });
    }
  });
}

function runScreenCases() {
  section('screen(keep-on setting)');
  const mock = MOCKS['@system.brightness'];
  const calls = [];
  mock.setKeepScreenOn = function (options) {
    calls.push(options && options.keepScreenOn === true ? 'on' : 'off');
    if (options && typeof options.success === 'function') {
      options.success();
    }
  };
  const Screen = loadCommon('screen');

  test('apply forwards keepScreenOn to brightness (FIT5 Pro setKeepScreenOn)', function () {
    calls.length = 0;
    Screen.apply(true);
    Screen.apply(false);
    eq(calls.join(','), 'on,off');
  });

  test('apply degrades silently when the API throws', function () {
    mock.setKeepScreenOn = function () {
      throw new Error('api missing');
    };
    let threw = false;
    try {
      Screen.apply(true);
    } catch (err) {
      threw = true;
    }
    eq(threw, false, 'apply never throws');
    mock.setKeepScreenOn = function (options) {
      if (options && typeof options.success === 'function') {
        options.success();
      }
    };
  });
}

function runSearchCacheCases() {
  section('searchcache(removed)');
  test('search result cache removed: dual-view search page keeps results in page memory', function () {
    /* 1.5.x 的 SearchCache 依赖 globalThis/storage 大值，Lite 上不可靠
       （storage 单值硬限制 128 字节），已改为同页双视图方案，无跨页缓存。 */
    const fs2 = require('fs');
    const path2 = require('path');
    const gone = !fs2.existsSync(path2.join(COMMON_DIR, 'searchcache.js'));
    eq(gone, true, 'searchcache.js should be deleted');
  });
}

function runPagingCases() {
  section('paging');
  const Paging = loadCommon('paging');
  const Config = loadCommon('config');

  function makeItems(n) {
    const out = [];
    for (let i = 0; i < n; i += 1) {
      out.push({ id: i });
    }
    return out;
  }

  test('default page size comes from Config', function () {
    eq(Paging.sizeOf(0), Config.LIST_PAGE_SIZE);
    eq(Paging.sizeOf(undefined), Config.LIST_PAGE_SIZE);
    eq(Paging.sizeOf(-3), Config.LIST_PAGE_SIZE);
    eq(Paging.sizeOf(4), 4);
    eq(Config.LIST_PAGE_SIZE, 3, 'unified big-font style uses 3 items per page');
    eq(Paging.countOf(50), Math.ceil(50 / Config.LIST_PAGE_SIZE));
  });

  test('empty list has no pages and no pager label', function () {
    const w = Paging.windowOf(0, 0);
    eq(w.pageCount, 0);
    eq(w.label, '');
    eq(w.hasPrev, false);
    eq(w.hasNext, false);
    eq(w.start, 0);
    eq(w.end, 0);
    eq(Paging.slice([], w).length, 0);
  });

  test('50 items split into 5 pages of 10 with explicit size', function () {
    eq(Paging.countOf(50, 10), 5);
    const items = makeItems(50);
    const first = Paging.windowOf(50, 0, 10);
    eq(first.label, '1/5');
    eq(first.hasPrev, false);
    eq(first.hasNext, true);
    eq(first.start, 0);
    eq(first.end, 10);
    const slice = Paging.slice(items, first);
    eq(slice.length, 10);
    eq(slice[0].id, 0);
    eq(slice[9].id, 9);

    const last = Paging.windowOf(50, 4, 10);
    eq(last.label, '5/5');
    eq(last.hasPrev, true);
    eq(last.hasNext, false);
    eq(last.start, 40);
    eq(last.end, 50);
    eq(Paging.slice(items, last)[0].id, 40);
  });

  test('partial last page keeps the remainder only', function () {
    const items = makeItems(23);
    eq(Paging.countOf(23, 10), 3);
    const w = Paging.windowOf(23, 2, 10);
    eq(w.start, 20);
    eq(w.end, 23);
    eq(Paging.slice(items, w).length, 3);
    eq(w.hasNext, false);
  });

  test('page index is clamped instead of overflowing', function () {
    eq(Paging.windowOf(25, 9, 10).page, 2);
    eq(Paging.windowOf(25, -4, 10).page, 0);
    eq(Paging.windowOf(25, NaN, 10).page, 0);
    eq(Paging.windowOf(0, 3, 10).page, 0);
    eq(Paging.windowOf(25, 9, 10).end, 25);
  });

  test('single page hides the pager label', function () {
    const w = Paging.windowOf(7, 0, 10);
    eq(w.pageCount, 1);
    eq(w.label, '');
    eq(w.hasPrev, false);
    eq(w.hasNext, false);
    eq(Paging.slice(makeItems(7), w).length, 7);
  });

  test('slice tolerates a shorter source than the window claims', function () {
    const w = Paging.windowOf(30, 2, 10);
    const short = makeItems(21);
    const slice = Paging.slice(short, w);
    eq(slice.length, 1);
    eq(slice[0].id, 20);
  });
}

/* store.resetState keeps the module cache; storage mock resets separately */
function Storage_reset(Store) {
  Store.resetState();
}

function runVersionCases() {
  section('version consistency');
  /* 三处版本号必须一致：关于页（index.js APP_VERSION）、AppScope/app.json5、
     entry/src/main/config.json。2.3.0 交付时关于页漏更新过（用户真机反馈），用例防回归。 */
  test('about page / app.json5 / config.json versions agree', function () {
    const fs2 = require('fs');
    const path2 = require('path');
    const idx = fs2.readFileSync(path2.join(ROOT_DIR, 'entry', 'src', 'main', 'js', 'MainAbility', 'pages', 'index', 'index.js'), 'utf8');
    const app = fs2.readFileSync(path2.join(ROOT_DIR, 'AppScope', 'app.json5'), 'utf8');
    const cfg = fs2.readFileSync(path2.join(ROOT_DIR, 'entry', 'src', 'main', 'config.json'), 'utf8');
    /* Release V1.0 起展示名带前缀（'Release V1.0'），清单版本仍是纯数字 1.0.0：
       取展示串中的数字段与清单比对（主版本.次版本必须一致）。 */
    const mIdx = idx.match(/APP_VERSION = '([^']+)'/);
    const mApp = app.match(/"versionName":\s*"([0-9.]+)"/);
    const mCfg = cfg.match(/"name":\s*"([0-9.]+)"/);
    assert(mIdx && mApp && mCfg, 'all three version strings found');
    const disp = mIdx[1].replace(/[^0-9.]/g, '');
    assert(disp.length > 0, 'display version carries digits: ' + mIdx[1]);
    eq(mApp[1], mCfg[1], 'app.json5 and config.json agree');
    eq(mApp[1].indexOf(disp) === 0 || disp.indexOf(mApp[1]) === 0, true,
      'display ' + mIdx[1] + ' matches manifest ' + mApp[1]);
  });
}

function runSpaceCases() {
  section('space(info page)');
  const Space = loadCommon('space');

  function resetFile() {
    Object.keys(fsData).forEach((k) => delete fsData[k]);
  }

  test('usage reports saved only; cache and data are excluded (v3.3)', function () {
    resetFile();
    fsData['internal://app/c/k.0'] = new Array(501).join('x'); /* 旧缓存遗留，不计入 */
    fsData['internal://app/saved/a.0'] = new Array(301).join('y'); /* 300 */
    fsData['internal://app/data/bm.0'] = new Array(1001).join('z'); /* 不计入 */
    let got = null;
    Space.usage((u) => { got = u; });
    eq(got.savedBytes, 300, 'saved only');
    eq(got.savedCount, 1);
  });

  test('formatBytes renders human units', function () {
    eq(Space.formatBytes(512), '512 B');
    eq(Space.formatBytes(2048), '2.0 KB');
    eq(Space.formatBytes(3 * 1024 * 1024), '3.0 MB');
    eq(Space.formatBytes(0), '0 B');
  });

  test('purgeLegacyCache clears old cache leftovers only (v3.3 feature removed)', function () {
    resetFile();
    fsData['internal://app/c/k.0'] = 'c0';
    fsData['internal://app/c/_keys.txt'] = 'k';
    fsData['internal://app/saved/a.0'] = 's0';
    fsData['internal://app/data/bm.0'] = 'd0';
    let ok = 'unset';
    Space.purgeLegacyCache((r) => { ok = r; });
    eq(ok, true);
    eq(fsData['internal://app/c/k.0'], undefined, 'legacy cache part gone');
    eq(fsData['internal://app/c/_keys.txt'], undefined, 'keys ledger gone');
    eq(fsData['internal://app/saved/a.0'], 's0', 'offline content preserved');
    eq(fsData['internal://app/data/bm.0'], 'd0', 'bookmarks preserved');
  });

  test('clearSaved removes offline files only (two-step confirm target)', function () {
    resetFile();
    fsData['internal://app/saved/list.txt'] = '[]';
    fsData['internal://app/saved/a.0'] = 's0';
    fsData['internal://app/c/k.0'] = 'c0';
    fsData['internal://app/data/bm.0'] = 'd0';
    let ok = 'unset';
    Space.clearSaved((r) => { ok = r; });
    eq(ok, true);
    eq(fsData['internal://app/saved/list.txt'], undefined, 'manifest gone');
    eq(fsData['internal://app/saved/a.0'], undefined, 'offline part gone');
    eq(fsData['internal://app/c/k.0'], 'c0', 'legacy cache untouched here');
    eq(fsData['internal://app/data/bm.0'], 'd0', 'bookmarks preserved');
    let u = null;
    Space.usage((x) => { u = x; });
    eq(u.savedCount, 0, 'usage reflects the clear');
  });

  test('usage degrades to zeros when file.list throws', function () {
    resetFile();
    const original = fileMock.list;
    fileMock.list = function () { throw new Error('file unavailable'); };
    let got = 'unset';
    Space.usage((u) => { got = u; });
    assert(got !== 'unset', 'callback fired despite exception');
    eq(got.savedBytes, 0);
    eq(got.savedCount, 0);
    fileMock.list = original;
    resetFile();
  });
}

function runPageSinkCases() {
  section('pagesink(P2 streaming)');
  const Sink = loadCommon('pagesink');
  const layout = { fontSize: 24, lineHeight: 37, width: 376, height: 320 };

  test('empty text yields one empty page', function () {
    const r = Sink.create(layout, {}).finish();
    eq(r.pageCount, 1);
    eq(r.starts.length, 1);
    eq(r.starts[0], 0);
    eq(r.text, '');
  });

  test('long CJK text paginates with monotonic starts', function () {
    const text = '中'.repeat(600);
    const s = Sink.create(layout, {});
    s.write(text);
    const r = s.finish();
    assert(r.pageCount > 1, 'multiple pages');
    eq(r.starts.length, r.pageCount, 'starts matches pages');
    eq(r.starts[0], 0);
    for (let i = 1; i < r.starts.length; i += 1) {
      assert(r.starts[i] > r.starts[i - 1], 'monotonic at ' + i);
      assert(r.starts[i] < text.length, 'inside text at ' + i);
    }
    eq(r.text.length, text.length);
  });

  test('chunked feed matches one-shot feed', function () {
    const text = ('第一段正文。'.repeat(80) + '\n' + '第二段正文。'.repeat(80));
    const a = Sink.create(layout, {});
    a.write(text);
    const one = a.finish();
    const b = Sink.create(layout, {});
    for (let i = 0; i < text.length; i += 7) {
      b.write(text.substring(i, i + 7));
    }
    const many = b.finish();
    eq(many.text, one.text);
    eq(many.pageCount, one.pageCount);
    eq(JSON.stringify(many.starts), JSON.stringify(one.starts));
  });

  test('noise lines stripped inline, long noise-word line kept', function () {
    const text = '本章未完，请点击下一页继续\n第一段正文\n' + '这一行虽然提到了本章未完但它是很长的正文行，必须保留不能删除也不能当成推广。\n';
    const s = Sink.create(layout, {});
    s.write(text);
    const r = s.finish();
    assert(r.text.indexOf('本章未完，请点击下一页继续') < 0, 'short noise removed');
    assert(r.text.indexOf('第一段正文') >= 0, 'body kept');
    assert(r.text.indexOf('这一行虽然提到了') >= 0, 'long line kept');
  });

  test('maxText caps text and sets truncated', function () {
    const s = Sink.create(layout, { maxText: 100 });
    s.write('字'.repeat(500));
    const r = s.finish();
    eq(r.text.length, 100);
    eq(r.truncated, true);
  });

  test('keepPages page texts reassemble filtered text', function () {
    const text = '第一段正文。\n第二段正文。\n第三段正文。';
    const s = Sink.create(layout, { keepPages: true });
    s.write(text);
    const r = s.finish();
    let joined = '';
    for (let i = 0; i < r.pages.length; i += 1) {
      joined += r.pages[i].text || '';
    }
    eq(joined, r.text);
  });
}

function runSchedulerCases() {
  section('scheduler(P2 burst budget + memory gate)');
  const Sched = loadCommon('scheduler');

  test('memoryGate passes when peak is under 40% of heap', function () {
    const g = Sched.memoryGate(65536, 5000, 12, 500000);
    eq(g.ok, true, 'reason: ' + g.reason);
  });

  test('memoryGate rejects when peak exceeds 40% of heap', function () {
    const g = Sched.memoryGate(131072, 12000, 40, 500000);
    eq(g.ok, false, 'should reject large peak');
  });

  test('degrade reduces caps until within budget', function () {
    const d = Sched.degrade(131072, 12000, 40, 500000);
    assert(d.respCapBytes < 131072, 'respCap reduced');
    assert(d.textCapChars < 12000, 'textCap reduced');
  });

  test('scheduleFileOp respects burst budget', function () {
    Sched.resetBurst();
    let executed = 0;
    for (let i = 0; i < 6; i += 1) {
      Sched.scheduleFileOp(function () { executed += 1; });
    }
    assert(executed <= 4, 'at most 4 in first burst, got ' + executed);
    eq(Sched.burstPending() > 0, true, 'excess queued');
    Sched.resetBurst();
  });

  test('task queue processes by priority', function () {
    const order = [];
    Sched.enqueue(3, function () { order.push('p3'); });
    Sched.enqueue(1, function () { order.push('p1'); });
    Sched.enqueue(2, function () { order.push('p2'); });
    Sched.processQueue();
    eq(order.join(','), 'p1,p2,p3');
    eq(Sched.queueLength(), 0);
  });
}

function runPageStoreCases() {
  section('pagestore(P3 chapter files + page table)');
  const PS = loadCommon('pagestore');

  test('keyOf is deterministic short ASCII', function () {
    const a = PS.keyOf('https://example.com/read/1/2');
    const b = PS.keyOf('https://example.com/read/1/2');
    eq(a, b);
    assert(a.indexOf('r') === 0, 'prefix r');
    assert(a.length <= 20, 'short key');
  });

  test('encodeIdx / decodeIdx round-trip', function () {
    const offsets = [0, 360, 720, 1080, 1500];
    const buf = PS.encodeIdx(offsets);
    assert(buf instanceof Uint8Array, 'produces Uint8Array');
    eq(buf[0], 0x50, 'magic P');
    const decoded = PS.decodeIdx(buf);
    assert(decoded !== null, 'decodes');
    eq(decoded.count, 5);
    eq(JSON.stringify(decoded.offsets), JSON.stringify(offsets));
  });

  test('decodeIdx rejects invalid magic', function () {
    const bad = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00]);
    eq(PS.decodeIdx(bad), null);
  });

  test('utf8Decode handles CJK and ASCII', function () {
    const text = 'Hello 中文 World';
    const bytes = [];
    for (let i = 0; i < text.length; i += 1) {
      const c = text.charCodeAt(i);
      if (c < 0x80) {
        bytes.push(c);
      } else if (c < 0x800) {
        bytes.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F));
      } else {
        bytes.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
      }
    }
    const buf = new Uint8Array(bytes);
    const decoded = PS.utf8Decode(buf, 0, buf.length);
    eq(decoded, text);
  });

  test('utf8Decode skips continuation bytes at start', function () {
    const bytes = [0xE4, 0xB8, 0xAD, 0xE6, 0x96, 0x87]; // 中文
    const buf = new Uint8Array(bytes);
    const decoded = PS.utf8Decode(buf, 1, 6); // start at continuation byte
    eq(decoded, '中文');
  });
}

function runFileBudgetCases() {
  section('fsutil(UTF-8 byte budget)');
  const Fs = loadCommon('fsutil');

  test('splitText caps each part at 1200 chars and 3600 UTF-8 bytes', function () {
    const parts = Fs.splitText('😀'.repeat(1200), Fs.PART_CHARS, 24);
    eq(parts.length > 1, true, '4-byte chars need more than one part');
    for (let i = 0; i < parts.length; i += 1) {
      assert(Fs.utf8Len(parts[i]) <= Fs.PART_BYTES, 'part bytes <= 3600');
      assert(parts[i].length <= 1200, 'part chars <= 1200');
    }
    eq(parts.join(''), '😀'.repeat(1200));
  });

  test('splitText keeps ASCII within one 1200-char part', function () {
    const parts = Fs.splitText('a'.repeat(1200), Fs.PART_CHARS, 24);
    eq(parts.length, 1);
    eq(parts[0].length, 1200);
  });
}

function runRssCases() {
  section('rss(RSS 2.0 / Atom)');
  const Rss = loadCommon('rss');

  test('parses RSS 2.0 titles, links and CDATA description', function () {
    const xml = '<?xml version="1.0"?><rss><channel><title>测试频道</title>' +
      '<item><title><![CDATA[第一条新闻]]></title><link>https://example.com/1</link>' +
      '<description><![CDATA[<p>正文摘要</p>]]></description>' +
      '<pubDate>Thu, 26 Nov 2026 15:00:00 +0800</pubDate></item></channel></rss>';
    const r = Rss.parse(xml, '测试');
    eq(r.title, '测试频道');
    eq(r.items.length, 1);
    eq(r.items[0].title, '第一条新闻');
    eq(r.items[0].link, 'https://example.com/1');
    eq(r.items[0].summary, '正文摘要');
    eq(r.items[0].date, '11-26 15:00');
  });

  test('decodes escaped HTML in description', function () {
    const xml = '<rss><channel><item><title>A</title><link>u</link>' +
      '<description>&lt;p&gt;第一段&lt;/p&gt;&lt;p&gt;第二段&lt;/p&gt;</description></item></channel></rss>';
    const r = Rss.parse(xml, 'x');
    assert(r.items[0].summary.indexOf('第一段') >= 0, 'keeps text');
    assert(r.items[0].summary.indexOf('<p>') < 0, 'strips escaped tags');
  });

  test('parses Atom entries and href links', function () {
    const xml = '<feed><title>Atom 源</title><entry><title>Atom 新闻</title>' +
      '<link href="https://example.com/a" rel="alternate"/>' +
      '<summary>摘要</summary><updated>2026-11-26T12:00:00Z</updated></entry></feed>';
    const r = Rss.parse(xml, 'Atom');
    eq(r.title, 'Atom 源');
    eq(r.items.length, 1);
    eq(r.items[0].link, 'https://example.com/a');
    eq(r.items[0].date, '2026-11-26 12:00');
  });

  test('empty feed reports no-items', function () {
    const r = Rss.parse('<rss><channel><title>x</title></channel></rss>', 'x');
    eq(r.items.length, 0);
    eq(r.error, 'no-items');
  });
}

function runMarkdownCases() {
  section('md(Markdown -> plain text)');
  const Md = loadCommon('md');

  test('strips headings, links and images', function () {
    const text = Md.toText('# 标题\n\n[链接文字](https://example.com)\n\n![图片](https://x/a.png)\n\n**加粗**');
    eq(text, '标题\n链接文字\n加粗');
  });

  test('strips code fences but keeps code text', function () {
    const text = Md.toText('```\nvar a = 1;\n```\n\n正文');
    eq(text, 'var a = 1;\n正文');
  });

  test('decodes entities', function () {
    eq(Md.toText('A &amp; B'), 'A & B');
  });
}

function runAiConfigCases() {
  section('aicfg(DeepSeek key persistence)');
  const Cfg = loadCommon('aicfg');
  test('masks keys', function () {
    eq(Cfg.mask('sk-1234567890abcdef'), 'sk-1****cdef');
    eq(Cfg.mask(''), '未设置');
  });
  test('normalizes keys when the watch keyboard cannot type "-"', function () {
    eq(Cfg.normalizeKey('abcdef1234567890'), 'sk-abcdef1234567890');
    eq(Cfg.normalizeKey('skabcdef1234567890'), 'sk-abcdef1234567890');
    eq(Cfg.normalizeKey('SK-abcdef1234567890'), 'sk-abcdef1234567890');
    eq(Cfg.normalizeKey(' sk－abcdef1234567890 '), 'sk-abcdef1234567890');
  });
  test('save/load round-trip through storage', function () {
    Cfg.saveKey('sk-test-123456', function (ok) {
      eq(ok, true);
    });
    Cfg.load(function (cfg) {
      eq(cfg.hasKey, true);
      eq(cfg.enabled, true);
      eq(cfg.key, 'sk-test-123456');
    });
  });
  test('toggle off keeps the API key; toggle back on needs no re-entry', function () {
    Cfg.saveKey('sk-keep-123456', function () {});
    Cfg.setEnabled(false, function () {});
    Cfg.load(function (cfg) {
      eq(cfg.hasKey, true, 'turning off must not clear the key');
      eq(cfg.enabled, false, 'off state');
    });
    Cfg.setEnabled(true, function () {});
    Cfg.load(function (cfg) {
      eq(cfg.hasKey, true, 'key still present after re-enable');
      eq(cfg.key, 'sk-keep-123456', 'key unchanged');
      eq(cfg.enabled, true, 're-enabled without re-entry');
    });
  });
  test('rejects empty key', function () {
    Cfg.saveKey('', function (ok, reason) {
      eq(ok, false);
      assert(reason.length > 0, 'has reason');
    });
  });
}

function main() {
  /* v1.0.2：真机默认在文件调用之间插入一拍宏任务（防原生回调内重入文件服务，
     离线保存完成即崩的修复）。冒烟需要确定性的同步回调链，这里显式关掉；
     该开关只影响"异步回调之后"的 pump 时机，不改变队列语义。 */
  loadCommon('fsutil').setDeferBetweenOps(false);

  runUrlCases();
  runHtmlCases();
  runPaginateCases();
  runPageSinkCases();
  runSchedulerCases();
  runPageStoreCases();
  runStoreCases();
  runPagingCases();
  runGestureCases();
  runSearchCases();
  runSearchCacheCases();
  runFadeCases();
  runNavruleCases();
  runCacheRemovedCases();
  runSavedCases();
  runRouteCases();
  runLinkpassCases();
  runLayoutCases();
  runFileBudgetCases();
  runRssCases();
  runMarkdownCases();
  runAiConfigCases();
  runScreenCases();
  runSpaceCases();
  runVersionCases();
  summary();
}

main();


