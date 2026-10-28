/**
 * Location helpers. Only a coarse LABEL ("Kampala", "Bugolobi") ever leaves the device: raw coordinates are
 * used locally to pick the label and are never uploaded or stored.
 *
 * NEIGHBORHOODS are approximate area centres, good enough for a coarse label.
 */
export type GeoInfo = { label: 'Kampala' | 'Uganda' | null; neighborhood: string | null; distanceKm: number | null };

const KAMPALA = { minLat: 0.15, maxLat: 0.5, minLng: 32.4, maxLng: 32.75 };
const UGANDA = { minLat: -1.5, maxLat: 4.3, minLng: 29.5, maxLng: 35.1 };

export const NEIGHBORHOODS = [
  { name: 'Kololo', lat: 0.3333, lng: 32.5833 },
  { name: 'Bugolobi', lat: 0.3167, lng: 32.6167 },
  { name: 'Ggaba Road', lat: 0.285, lng: 32.605 },
  { name: 'Industrial Area', lat: 0.314, lng: 32.605 },
  { name: 'Kampala', lat: 0.3136, lng: 32.5811 },
];

export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const inside = (b: typeof KAMPALA, lat: number, lng: number) => lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng;

export function labelForCoords(lat: number, lng: number, maxNeighborhoodKm = 3): GeoInfo {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { label: null, neighborhood: null, distanceKm: null };
  const label = inside(KAMPALA, lat, lng) ? 'Kampala' : inside(UGANDA, lat, lng) ? 'Uganda' : null;
  if (label !== 'Kampala') return { label, neighborhood: null, distanceKm: null };
  let best: { name: string; d: number } | null = null;
  for (const n of NEIGHBORHOODS) {
    const d = haversineKm(lat, lng, n.lat, n.lng);
    if (!best || d < best.d) best = { name: n.name, d };
  }
  return best && best.d <= maxNeighborhoodKm
    ? { label, neighborhood: best.name, distanceKm: Math.round(best.d * 10) / 10 }
    : { label, neighborhood: null, distanceKm: best ? Math.round(best.d * 10) / 10 : null };
}
