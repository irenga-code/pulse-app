/** Preparing a picked photo/video for a status: size and type checks, and photo downscaling. */

export const MAX_BYTES = 25 * 1024 * 1024; // the post-media bucket limit
export const MAX_VIDEO_SECONDS = 30;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];

export type PreparedMedia = { blob: Blob; ext: string; type: 'image' | 'video'; width?: number; height?: number; previewUrl: string };

export function mediaKind(file: Pick<File, 'type'>): 'image' | 'video' | null {
  if (IMAGE_TYPES.includes(file.type)) return 'image';
  if (VIDEO_TYPES.includes(file.type)) return 'video';
  return null;
}

function videoExt(type: string) {
  return type === 'video/webm' ? 'webm' : type === 'video/quicktime' ? 'mov' : 'mp4';
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('That image could not be read.'));
    img.src = url;
  });
}

function videoDuration(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => resolve(v.duration);
    v.onerror = () => reject(new Error('That video could not be read.'));
    v.src = url;
  });
}

/** Throws an Error with a user-friendly message when the file can not be used. */
export async function prepareStatusMedia(file: File, maxEdge = 1280): Promise<PreparedMedia> {
  const kind = mediaKind(file);
  if (!kind) throw new Error('Choose a JPG, PNG or WebP photo, or an MP4, WebM or MOV video.');
  if (file.size > MAX_BYTES) throw new Error('That file is larger than 25 MB.');
  const previewUrl = URL.createObjectURL(file);
  try {
    if (kind === 'video') {
      const secs = await videoDuration(previewUrl);
      if (Number.isFinite(secs) && secs > MAX_VIDEO_SECONDS) throw new Error(`Statuses can be up to ${MAX_VIDEO_SECONDS} seconds long.`);
      return { blob: file, ext: videoExt(file.type), type: 'video', previewUrl };
    }
    const img = await loadImage(previewUrl);
    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    if (scale === 1 && file.size < 1.5 * 1024 * 1024) {
      return { blob: file, ext: file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg', type: 'image', width, height, previewUrl };
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.86));
    if (!blob) return { blob: file, ext: 'jpg', type: 'image', width, height, previewUrl };
    return { blob, ext: 'jpg', type: 'image', width, height, previewUrl };
  } catch (e) {
    URL.revokeObjectURL(previewUrl);
    throw e;
  }
}
