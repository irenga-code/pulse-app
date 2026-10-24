import { useState } from 'react';
import { Moon, Store, Search } from 'lucide-react';
import TonightTab from '@/tabs/TonightTab';
import VenuesTab from '@/tabs/VenuesTab';
import SearchTab from '@/tabs/SearchTab';

type View = 'venues' | 'tonight' | 'search';
const VIEWS: { id: View; label: string; icon: typeof Store }[] = [
  { id: 'venues', label: 'All venues', icon: Store },
  { id: 'tonight', label: 'Tonight', icon: Moon },
  { id: 'search', label: 'Search', icon: Search },
];

/** Venue catalog / storefront: every venue, what's live tonight, and search, under one business tab. */
export default function CatalogTab() {
  const [view, setView] = useState<View>('venues');
  return (
    <div className="flex flex-col flex-1">
      <div className="flex gap-1 mx-4 md:mx-6 mt-3 p-1 rounded-full bg-wa-lightSecondary dark:bg-wa-darkSecondary self-start" role="tablist" aria-label="Catalog view">
        {VIEWS.map((v) => {
          const Icon = v.icon;
          const on = view === v.id;
          return (
            <button key={v.id} role="tab" aria-selected={on} onClick={() => setView(v.id)}
              className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors duration-200 ${
                on ? 'bg-wa-lightPanel dark:bg-wa-darkPanel text-wa-green shadow-sm' : 'text-wa-lightTextSecondary dark:text-wa-darkTextSecondary'
              }`}>
              <Icon className="w-3.5 h-3.5" />{v.label}
            </button>
          );
        })}
      </div>
      <div key={view} className="flex-1 flex flex-col animate-section-in">
        {view === 'venues' ? <VenuesTab /> : view === 'tonight' ? <TonightTab /> : <SearchTab />}
      </div>
    </div>
  );
}
