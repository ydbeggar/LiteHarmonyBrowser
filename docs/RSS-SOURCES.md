# RSS 公共源清单（v1.1.2）

> 2026-11-26 在 PC 端实测；手表端网络栈/UA 不同，发布前需逐源复测。
> 源配置：`entry/src/main/js/MainAbility/common/rsscfg.js`

## 默认源

| ID | 名称 | URL | PC 响应 | 条目 | 备注 |
|---|---|---|---:|---:|---|
| `sspai` | 少数派 | `https://sspai.com/feed` | 4.2 KB | 10 | 科技/效率，体积最小 |
| `solidot` | 奇客 Solidot | `https://www.solidot.org/index.rss` | 11.6 KB | 20 | 科技新闻，CDATA 正文 |
| `infoq` | InfoQ 中文 | `https://www.infoq.cn/feed` | 12.3 KB | 20 | 部分条目 description 仅“点击查看原文>” |
| `cnblogs` | 博客园 | `https://feed.cnblogs.com/blog/sitehome/rss` | 20.2 KB | 20 | 开发技术 |
| `oschina` | 开源中国 | `https://www.oschina.net/news/rss` | 29.4 KB | 50 | 开源/技术 |

## 备选 / 排除

| 源 | URL | 结果 | 处理 |
|---|---|---|---|
| IT之家 | `https://www.ithome.com/rss/` | 132.9 KB / 60 条 | 备选，不默认加载（体积大） |
| 36Kr | `https://36kr.com/feed` | 返回 HTML 反爬页，0 条 | 不接入 |
| 知乎 | `https://www.zhihu.com/rss` | 0 B / 超时 | 不接入 |
| 阮一峰 | `https://www.ruanyifeng.com/blog/atom.xml` | 45 KB / 3 条 | Atom 备选 |
| BBC 中文 | `https://feeds.bbci.co.uk/zhongwen/simp/rss.xml` | 20s 超时 | 不接入 |

## 解析规则

- 支持 RSS 2.0 `<item>` 与 Atom `<entry>`；
- 标题 80 字、摘要 240 字、正文 4000 字截断；
- 列表最多 20 条；
- 纯 ES5，无正则字面量（ArkUI.Lite 限制）；
- 失败时保留页面并显示“刷新重试”，不阻塞其他源。

## 手表端待测

1. 每个源首次加载耗时、成功/失败；
2. 列表 3 条/屏（方屏）、2~3 条/屏（圆屏）是否滚动顺畅；
3. 详情正文长段落是否裁切；
4. “阅读原文”跳转阅读页是否正常。
