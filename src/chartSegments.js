// Separate missing samples so SVG never draws a line across an absent observation.
export function continuousSampleSegments(samples, valueOf) {
  const segments = [];
  let segment = [];
  for (const sample of samples) {
    if (Number.isFinite(valueOf(sample))) segment.push(sample);
    else if (segment.length) { segments.push(segment); segment = []; }
  }
  if (segment.length) segments.push(segment);
  return segments;
}
