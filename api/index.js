// Vercel serverless entry. vercel.json rewrites /api/<path> to /api?__path=<path>,
// so restore the original URL before handing off to the shared router.
const { handleApi } = require('../lib/cricket.js');

module.exports = (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.searchParams.get('__path');
  if (p != null) {
    url.searchParams.delete('__path');
    req.url = `/api/${p}${url.search}`;
  }
  return handleApi(req, res);
};
