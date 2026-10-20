/**
 * Best MediaRecorder format this browser can produce.
 * WebM first: Chrome, Edge and Firefox can always encode it. MP4 is the fallback (Safari). Some Chromium builds
 * report `video/mp4` as supported but have no H.264 encoder and silently record audio only, which is why every
 * recording is also validated after the fact (see CameraModal) and a bad format can be skipped.
 */
const CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
];

export function pickRecorderMime(
  rec: { isTypeSupported(t: string): boolean } | undefined = typeof MediaRecorder !== 'undefined' ? MediaRecorder : undefined,
  skip: string[] = []
): { mime: string; ext: 'mp4' | 'webm' } | null {
  if (!rec) return null;
  for (const mime of CANDIDATES) {
    if (skip.includes(mime)) continue;
    if (rec.isTypeSupported(mime)) return { mime, ext: mime.includes('mp4') ? 'mp4' : 'webm' };
  }
  return null;
}
