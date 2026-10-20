<<<<<<< HEAD
import { useState, useEffect } from 'react';
import { Search as SearchIcon, MapPin, X } from 'lucide-react';
import { type Venue } from '@/lib/supabase';
import { useVenues } from '@/hooks/useVenues';

const suggestions = ['Kololo', 'Ggaba Road', 'Bugolobi', 'Industrial Area', 'Live now'];

export default function SearchTab() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Venue[]>([]);
  const { venues: allVenues } = useVenues({ orderBy: 'created_at' });
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setSearched(false);
      return;
    }
    setSearched(true);
    const q = query.toLowerCase();
    const filtered = allVenues.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        v.location.toLowerCase().includes(q) ||
        v.status.toLowerCase().includes(q)
    );
    setResults(filtered);
  }, [query, allVenues]);

  const statusColor = (status: string) => {
    if (status === 'live') return 'text-wa-live bg-wa-live/10';
    if (status === 'sold_out') return 'text-wa-busy bg-wa-busy/10';
    return 'text-wa-quiet bg-wa-quiet/10';
  };

  return (
    <div className="flex flex-col h-full bg-wa-light dark:bg-wa-dark">
      <div className="px-4 md:px-8 pt-4 pb-3">
        <h1 className="text-2xl font-bold text-wa-lightText dark:text-wa-darkText">Search</h1>
        <p className="text-sm text-wa-lightTextSecondary dark:text-wa-darkTextSecondary mt-0.5">
          Find venues by name or area
        </p>
      </div>

      {/* Search bar */}
      <div className="px-4 md:px-8 pb-3">
        <div className="relative">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-wa-lightTextSecondary dark:text-wa-darkTextSecondary" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search venues, areas..."
            className="w-full bg-wa-lightPanel dark:bg-wa-darkSecondary text-wa-lightText dark:text-wa-darkText text-sm rounded-xl pl-10 pr-10 py-3 border border-wa-lightBorder dark:border-wa-darkBorder outline-none focus:ring-2 focus:ring-wa-green/40 transition-all"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-wa-lightTextSecondary dark:text-wa-darkTextSecondary"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Suggestions or results */}
      <div className="flex-1 overflow-y-auto px-4 md:px-8 pb-6">
        {!searched ? (
          <div>
            <p className="text-xs font-semibold text-wa-lightTextSecondary dark:text-wa-darkTextSecondary uppercase tracking-wide mb-2 mt-1">
              Suggested
            </p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => setQuery(s)}
                  className="bg-wa-lightPanel dark:bg-wa-darkSecondary text-sm text-wa-lightText dark:text-wa-darkText rounded-full px-3.5 py-1.5 border border-wa-lightBorder dark:border-wa-darkBorder hover:border-wa-green hover:text-wa-green transition-all"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : results.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <p className="text-sm text-wa-lightTextSecondary dark:text-wa-darkTextSecondary">
              No results for "{query}"
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 md:gap-3 mt-1">
            {results.map((venue) => (
              <div
                key={venue.id}
                className="flex items-center gap-3 bg-wa-lightPanel dark:bg-wa-darkSecondary rounded-xl p-3 border border-wa-lightBorder dark:border-wa-darkBorder animate-fade-in"
              >
                {venue.image_url && (
                  <img
                    src={venue.image_url}
                    alt={venue.name}
                    className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
                    loading="lazy"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-sm text-wa-lightText dark:text-wa-darkText truncate">
                    {venue.name}
                  </h3>
                  <div className="flex items-center gap-1 mt-0.5">
                    <MapPin className="w-3 h-3 text-wa-lightTextSecondary dark:text-wa-darkTextSecondary flex-shrink-0" />
                    <span className="text-xs text-wa-lightTextSecondary dark:text-wa-darkTextSecondary truncate">
                      {venue.location}
                    </span>
                  </div>
                </div>
                <span className={`text-xs font-semibold rounded-full px-2.5 py-1 ${statusColor(venue.status)}`}>
                  {venue.status}
                </span>
              </div>
            ))}
          </div>
        )}
=======
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
            className="bg-white dark:bg-gray-800 rounded-2xl overflow-y-auto border border-gray-200 dark:border-gray-700 shadow-sm hover:shadow-md transition-shadow"
          >
            {venue.image_url && (
              <div className="h-48 overflow-y-auto relative">
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
>>>>>>> e14542724eaa5b9d785ae538c31a2e121d3a7fd9
      </div>
    </div>
  );
}
<<<<<<< HEAD
=======

export default SearchTab;
>>>>>>> e14542724eaa5b9d785ae538c31a2e121d3a7fd9
