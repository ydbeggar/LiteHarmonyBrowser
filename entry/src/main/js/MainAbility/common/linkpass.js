/**
 * 目录页数据传递（v3.8：单小文件版）。
 *
 * 背景（1.5.x「结果已失效」教训 + FIT5 Pro 能力检测定案）：Lite 每页独立
 * bundle、模块级变量不跨页共享、globalThis 不存在——阅读页持有的文档
 * 在目录页**看不到**。跨页可靠通道只有 @system.file（route.js 文件参数同款）。
 *
 * v3.4~3.6 的分片写在本会话首次保存时会**删除幽灵分片**（尾清 [n..MAX) 不存在
 * 的文件）——用户"点『链接』的瞬间崩溃"正是该删除洪峰（串行化后仅存的
 * 删除并峰点）。v3.8 改与 store v3.4 同款**单小文件**：
 * - 保存 = 恰好 1 次小写；读取 = 恰好 1 次小读；**零删除、零分片**；
 * - UTF-8 字节预算 3900B（< readText 4000B 上限）自截断：超预算从链接表
 *   尾部整条丢弃（mergeLinks 章节链接在前，先保住章节）。
 *
 * 流程：
 *   reader.onOpenLinks → Linkpass.save({title,url,pageIndex,links}) → 跳目录页
 *   links.onInit       → Linkpass.load(cb) 取回链接表
 */
import Fs from './fsutil.js';
import Navrule from './navrule.js';

var FILE_URI = 'internal://app/lwb_link.txt';
var BYTE_BUDGET = 3900;

function capText(value, max) {
  var s = value === null || value === undefined ? '' : String(value);
  return s.length > max ? s.substring(0, max) : s;
}

/** 载荷打包：链接表从前往后装入，超字节预算的尾部（非章节）整条丢弃。 */
function packPayload(payload) {
  var p = payload || {};
  var out = {
    title: capText(p.title, 60),
    url: capText(p.url, 200),
    pageIndex: typeof p.pageIndex === 'number' ? Math.floor(p.pageIndex) : 0,
    links: []
  };
  var base = Fs.utf8Len(JSON.stringify(out)) + 2;
  var used = 0;
  var links = p.links || [];
  for (var i = 0; i < links.length; i += 1) {
    var src = links[i];
    if (!src || !src.href) {
      continue;
    }
    var it = { text: capText(src.text, 60), href: capText(src.href, 200) };
    var add = Fs.utf8Len(JSON.stringify(it)) + (out.links.length > 0 ? 1 : 0);
    if (base + used + add > BYTE_BUDGET) {
      break;
    }
    out.links.push(it);
    used += add;
  }
  var text = '';
  try {
    text = JSON.stringify(out);
  } catch (err) {
    text = '';
  }
  return text;
}

/** 写入目录载荷。done(ok) 可省略；写失败不影响跳转（目录页自行兜底空态）。 */
function save(payload, done) {
  var end = Fs.once(done);
  var text = packPayload(payload);
  if (!text) {
    end(false);
    return;
  }
  Fs.writeSmall(FILE_URI, text, function (ok) {
    end(ok);
  });
}

/** 读取目录载荷。cb(payload|null)，必回调；解析失败按空处理。 */
function load(cb) {
  var end = Fs.once(cb);
  Fs.readSmall(FILE_URI, function (raw) {
    if (!raw) {
      end(null);
      return;
    }
    var data = null;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      data = null;
    }
    if (!data || typeof data !== 'object') {
      end(null);
      return;
    }
    end(data);
  });
}

/**
 * 目录载荷链接表：章节链接（html.js 识别，≤40 条）优先 + 其余链接补足，
 * 按 href 去重、总量 ≤40。大站正文页的 419 章巨型目录排在 HTML 后半段，
 * 只收"前 40 条链接"会被页头导航灌满——章节优先保证目录可用。
 */
function mergeLinks(chapters, links) {
  var out = [];
  var seen = {};
  var lists = [chapters || [], links || []];
  for (var k = 0; k < lists.length && out.length < 40; k += 1) {
    for (var i = 0; i < lists[k].length && out.length < 40; i += 1) {
      var it = lists[k][i];
      if (!it || !it.href || Object.prototype.hasOwnProperty.call(seen, it.href)) {
        continue;
      }
      /* v3.10：站点「目录/返回目录」条目只通向整本目录页（数百 KB，
         整包序列化必崩）——不入表，目录列表自身即章节导航。 */
      if (Navrule.isTocNavText(it.text)) {
        continue;
      }
      seen[it.href] = 1;
      out.push({ text: String(it.text || ''), href: String(it.href) });
    }
  }
  return out;
}

export default {
  save: save,
  load: load,
  mergeLinks: mergeLinks
};
