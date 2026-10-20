// Usage: npm run verify:venues
// Checks the live Supabase `venues` table against the 8 confirmed venues.
import { createClient } from '@supabase/supabase-js';

const expected = {
  Thrones: 'Bugolobi',
  Taboo: 'Bugolobi',
  Guvnor: 'Industrial Area',
  'Black Panther': 'Kampala',
  Nomad: 'Ggaba Road',
  Paradigm: 'Ggaba Road',
  Catwalk: 'Kololo',
  Vanquish: 'Kololo',
};

const { VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: key } = process.env;
if (!url || !key) {
  console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY');
  process.exit(2);
}

const { data, error } = await createClient(url, key).from('venues').select('name, location');
if (error) {
  console.error('Query failed:', error.message);
  process.exit(2);
}

let failed = false;
for (const [name, location] of Object.entries(expected)) {
  const rows = data.filter((v) => v.name === name);
  if (rows.length !== 1) {
    console.log(`FAIL  ${name}: found ${rows.length} rows (expected 1)`);
    failed = true;
  } else if (rows[0].location !== location) {
    console.log(`FAIL  ${name}: "${rows[0].location}" (expected "${location}")`);
    failed = true;
  } else {
    console.log(`ok    ${name} - ${location}`);
  }
}
const extra = data.filter((v) => !(v.name in expected));
if (extra.length) console.log(`note  ${extra.length} extra venue(s): ${extra.map((v) => v.name).join(', ')}`);
process.exit(failed ? 1 : 0);
