/* UUID v4 polyfill for insecure contexts (plain-HTTP public-IP deployments).
   crypto.randomUUID is secure-context-only; getRandomValues is not restricted. */
(function () {
  try {
    var c = globalThis.crypto;
    if (!c || typeof c.randomUUID === 'function') return;
    var hex = new Array(256);
    for (var i = 0; i < 256; i++) hex[i] = (i + 0x100).toString(16).slice(1);
    var fn = function () {
      var b = new Uint8Array(16);
      c.getRandomValues(b);
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      var h = '';
      for (var j = 0; j < 16; j++) h += hex[b[j]];
      return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
    };
    Object.defineProperty(c, 'randomUUID', { value: fn, configurable: true, writable: true });
  } catch (e) { /* degrade silently */ }
})();
