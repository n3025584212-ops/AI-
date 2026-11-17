/* 登录成功后的二次进入：在首屏绘制前就打上标记，避免整段开屏动画再闪一遍。 */
(function () {
  try {
    if (sessionStorage.getItem('obAfterLogin') === '1') {
      document.documentElement.setAttribute('data-after-login', '1');
    }
  } catch (e) {}
})();
