import { useCallback, useState } from 'react';
import { labelForCoords, type GeoInfo } from '@/camera/geo';

export type GeoStatus = 'idle' | 'asking' | 'ok' | 'denied' | 'unavailable';

/** One-shot location lookup. Coordinates never leave this hook: callers only get the coarse label. */
export function useGeolocation() {
  const [status, setStatus] = useState<GeoStatus>('idle');
  const [info, setInfo] = useState<GeoInfo | null>(null);

  const request = useCallback(() => {
    if (!('geolocation' in navigator)) { setStatus('unavailable'); return Promise.resolve<GeoInfo | null>(null); }
    setStatus('asking');
    return new Promise<GeoInfo | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const g = labelForCoords(pos.coords.latitude, pos.coords.longitude);
          setInfo(g);
          setStatus(g.label ? 'ok' : 'unavailable');
          resolve(g);
        },
        (err) => { setStatus(err.code === 1 ? 'denied' : 'unavailable'); resolve(null); },
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 }
      );
    });
  }, []);

  return { status, info, request };
}
