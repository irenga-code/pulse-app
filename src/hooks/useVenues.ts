import { useState } from 'react';
export interface Venue {
  id: string;
  name: string;
  location: string;
  status: 'live' | 'sold_out' | 'inactive';
  image_url: string;
  created_at: string;
}
export function useVenues(_options?: { orderBy?: string }) {
  const [venues] = useState<Venue[]>([
    {
      id: '1',
      name: 'Taboo',
      location: 'Bugolobi, Kampala',
      status: 'live',
      image_url: 'https://images.unsplash.com/photo-1566737236500-c8ac43014a67?auto=format&fit=crop&w=800&q=80',
      created_at: '2026-05-01'
    },
    {
      id: '2',
      name: 'Guvnor',
      location: 'Industrial Area, Kampala',
      status: 'live',
      image_url: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&w=800&q=80',
      created_at: '2026-05-02'
    },
    {
      id: '3',
      name: 'Casablanca',
      location: 'Kisementi, Kampala',
      status: 'live',
      image_url: 'https://images.unsplash.com/photo-1572116469696-31de0f17cc34?auto=format&fit=crop&w=800&q=80',
      created_at: '2026-05-03'
    },
    {
      id: '4',
      name: 'Nomad',
      location: 'Ggaba Road, Bunga',
      status: 'live',
      image_url: 'https://images.unsplash.com/photo-1543007630-9710e4a00a20?auto=format&fit=crop&w=800&q=80',
      created_at: '2026-05-04'
    },
    {
      id: '5',
      name: 'Paradigm',
      location: 'Ggaba Road, Kansanga',
      status: 'live',
      image_url: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=800&q=80',
      created_at: '2026-05-05'
    },
    {
      id: '6',
      name: 'Autospa',
      location: 'Ggaba Road, Munyonyo',
      status: 'live',
      image_url: 'https://images.unsplash.com/photo-1517457373958-b7bdd4587205?auto=format&fit=crop&w=800&q=80',
      created_at: '2026-05-06'
    },
    {
      id: '7',
      name: 'Chez Boss Mtoto',
      location: 'Ggaba Road, Munyonyo',
      status: 'live',
      image_url: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=800&q=80',
      created_at: '2026-05-07'
    },
    {
      id: '8',
      name: 'Catwalk',
      location: 'Kololo, Kampala',
      status: 'live',
      image_url: 'https://images.unsplash.com/photo-1545128485-c400e7702796?auto=format&fit=crop&w=800&q=80',
      created_at: '2026-05-08'
    },
    {
      id: '9',
      name: 'Vanquish',
      location: 'Kololo, Kampala',
      status: 'live',
      image_url: 'https://images.unsplash.com/photo-1545128485-c400e7702796?auto=format&fit=crop&w=800&q=80',
      created_at: '2026-05-09'
    }
  ]);
  return { venues, loading: false };
}
