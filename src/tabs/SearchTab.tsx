import React, { useState } from 'react';
import { useVenues } from '../hooks/useVenues';
import { Search, MapPin } from 'lucide-react';

export function SearchTab() {
  const { venues } = useVenues({ orderBy: 'created_at' });
  const [searchQuery, setSearchQuery] = useState('');

  const suggestions = [
    'Kololo',
    'Kisementi',
    'Munyonyo',
    'Makindye',
    'Ggaba Road',
    'Bugolobi',
    'Industrial Area',
    'Live now'
  ];

  const filteredVenues = venues.filter((venue) => {
    const q = searchQuery.toLowerCase();
    if (q === 'live now') return venue.status === 'live';
    return (
      venue.name.toLowerCase().includes(q) ||
      venue.location.toLowerCase().includes(q)
    );
  });

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Search</h1>
        <p className="text-gray-600 dark:text-gray-400">Find venues by name or area</p>
      </div>

      <div className="relative mb-6">
        <Search className="absolute left-4 top-3.5 h-5 w-5 text-gray-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search venues, areas like Munyonyo, Kisementi, Makindye..."
          className="w-full pl-12 pr-4 py-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 shadow-sm"
        />
      </div>

      <div className="flex flex-wrap gap-2 mb-8">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            onClick={() => setSearchQuery(suggestion.toLowerCase() === searchQuery.toLowerCase() ? '' : suggestion)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
              searchQuery.toLowerCase() === suggestion.toLowerCase()
                ? 'bg-emerald-600 text-white'
                : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'
            }`}
          >
            {suggestion}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredVenues.map((venue) => (
          <div
            key={venue.id}
            className="bg-white dark:bg-gray-800 rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-700 shadow-sm hover:shadow-md transition-shadow"
          >
            {venue.image_url && (
              <div className="h-48 overflow-hidden relative">
                <img
                  src={venue.image_url}
                  alt={venue.name}
                  className="w-full h-full object-cover"
                />
                <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-md px-3 py-1 rounded-full text-xs font-medium text-white flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  Live tonight
                </div>
              </div>
            )}
            <div className="p-5">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">{venue.name}</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1 mb-4">
                <MapPin className="h-4 w-4" />
                {venue.location}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default SearchTab;
