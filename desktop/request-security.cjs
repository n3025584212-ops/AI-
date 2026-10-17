function sameOrigin(raw, origin) {
  try { const url = new URL(raw); return url.protocol === 'http:' && url.origin === origin && !url.username && !url.password; }
  catch { return false; }
}

// Do not give the renderer a credential getter or a general HTTP proxy.
function requestHeaders(details, contents, origin, token) {
  const headers = { ...details.requestHeaders };
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === 'authorization' && (headers[key] === `Bearer ${token}` || sameOrigin(details.url, origin))) delete headers[key];
  }
  try {
    if (!contents.isDestroyed() && details.webContentsId === contents.id && details.frame
      && details.frame === contents.mainFrame && sameOrigin(details.frame.url, origin)
      && sameOrigin(contents.getURL(), origin) && sameOrigin(details.url, origin)
      && new URL(details.url).pathname.startsWith('/api/') && details.resourceType === 'xhr') {
      headers.Authorization = `Bearer ${token}`;
    }
  } catch { /* A navigating/destroyed frame gets no credential. */ }
  return headers;
}

module.exports = { sameOrigin, requestHeaders };
