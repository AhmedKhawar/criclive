// Local server: serves public/ and the API. On Vercel, api/index.js handles the API instead.
require('./lib/cricket.js').startServer();
