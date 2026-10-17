const { requestHeaders } = require('./request-security.cjs');

// A persistent Session outlives its BrowserWindow. Capture native references
// while the window is alive; never re-read its webContents getter in callbacks.
function createWindowLifecycle(window, { origin, authToken, onDownload }) {
  const contents = window.webContents;
  const session = contents.session;
  let active = true;
  let disposed = false;
  const listeners = new Map();
  const isAlive = () => active && !window.isDestroyed() && !contents.isDestroyed();
  const ownURL = raw => {
    try { return new URL(raw).origin === origin; } catch { return false; }
  };
  session.webRequest.onBeforeSendHeaders((details, callback) => {
    // A queued callback must complete even after cancellation, without adding
    // a desktop credential to a request from the expired window.
    callback({ requestHeaders: requestHeaders(details, isAlive() ? contents : null, origin, authToken) });
  });
  session.setPermissionRequestHandler((sender, permission, callback, details = {}) => {
    callback(isAlive() && sender === contents && permission === 'media'
      && ownURL(details.requestingUrl || sender.getURL()) && details.isMainFrame !== false
      && details.mediaTypes?.length === 1 && details.mediaTypes[0] === 'audio');
  });
  session.setPermissionCheckHandler((sender, permission, requestOrigin, details = {}) =>
    isAlive() && sender === contents && permission === 'media'
      && ownURL(requestOrigin) && details.mediaType === 'audio');
  const downloadListener = (event, item, sender) => {
    event.preventDefault();
    if (isAlive() && sender === contents && ownURL(item.getURL())) onDownload?.(event, item, sender);
  };
  session.on('will-download', downloadListener);

  function on(target, name, callback, once = false, { keepOnInvalidate = false, onCanceled } = {}) {
    if (!active) return () => {};
    const listener = (...args) => { if (isAlive()) callback(...args); else onCanceled?.(...args); };
    const remove = () => { target.removeListener(name, listener); listeners.delete(remove); };
    listeners.set(remove, keepOnInvalidate);
    if (once) target.once(name, listener); else target.on(name, listener);
    return remove;
  }
  function invalidate() {
    if (!active) return;
    active = false;
    session.webRequest.onBeforeSendHeaders(null);
    session.removeListener('will-download', downloadListener);
    for (const [remove, keepOnInvalidate] of [...listeners]) if (!keepOnInvalidate) remove();
    // Keep deny handlers until native destruction. Resetting them to default
    // during the server drain would change the live renderer's permission policy.
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    invalidate();
    for (const remove of [...listeners.keys()]) remove();
    session.setPermissionRequestHandler(null);
    session.setPermissionCheckHandler(null);
    window.removeListener('closed', dispose);
    contents.removeListener('destroyed', dispose);
  }
  window.once('closed', dispose);
  contents.once('destroyed', dispose);
  return { contents, session, isAlive, on, invalidate, dispose };
}

module.exports = { createWindowLifecycle };
