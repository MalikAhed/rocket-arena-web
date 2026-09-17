import { configuration } from '../server/config.mjs';
import { Store } from '../server/store.mjs';
const config = configuration();
if (!config.databaseUrl) throw new Error('Set DATABASE_URL before applying migrations.');
const store = new Store({ connectionString: config.databaseUrl, ssl: config.ssl, season: config.season, rating: config.rating, serverId: config.serverId });
try { await store.migrate(); console.log('Applied online schema migration 001. No real users were seeded.'); }
finally { await store.close(); }
