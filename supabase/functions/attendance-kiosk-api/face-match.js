// face-api.js 0.22.2 / faceRecognitionNet 128-dimensional descriptors.
export const MODEL = 'face-api-0.22.2-recognition-v1';
export function validDescriptor(value) {
  if (!Array.isArray(value) || value.length !== 128 ||
      !value.every(x => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= 2)) return false;
  const norm = Math.hypot(...value);
  return norm > 0.1 && norm < 3;
}
export function matchFace(probe, people) {
  if (!validDescriptor(probe)) return null;
  const ranked = people.map(person => ({ person, distance: Math.min(
    ...(person.descriptors || []).filter(validDescriptor).map(sample =>
      Math.hypot(...probe.map((x, i) => x - sample[i]))))
  })).sort((a, b) => a.distance - b.distance);
  const best = ranked[0];
  // Conservative pilot threshold; a close runner-up always requires manual selection.
  if (!best || best.distance > 0.45 || (ranked[1] && ranked[1].distance - best.distance < 0.08)) return null;
  return best.person;
}
