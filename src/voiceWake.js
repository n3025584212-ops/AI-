/** Returns null when no wake phrase was spoken; an empty string means wake only. */
export function wakeCommand(text) {
  if(typeof text!=='string')return null;
  const normalized=text.normalize('NFKC').trim();
  const match=normalized.match(/^(?:你好[，,\s]*)?(?:小迪|小[\s]*DK|DK助手|迪凯助手)[，,。:：!！\s]*(.*)$/i);
  return match ? match[1].trim() : null;
}
