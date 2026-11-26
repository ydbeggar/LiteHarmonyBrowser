import store from './common/store.js';
import space from './common/space.js';
import screen from './common/screen.js';

export default {
  onCreate() {
    store.setWriteErrorHandler(function () {
      console.error('LiteBrowser: storage write failed');
    });
    store.init(function () {
      /* 屏幕常亮设定（v3.7）：按用户偏好启用/关闭（默认开） */
      screen.apply(store.loadPrefs().keepScreenOn !== false);
    });
    /* v3.3：网页缓存功能已删除，启动时尽力回收旧版本遗留的 internal://app/c/ */
    space.purgeLegacyCache();
  },
  onDestroy() {
    /* persistence is incremental; nothing to flush */
  }
};
