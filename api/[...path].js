// Vercel serverless entry: every /api/* request is handled by the same code as the local server.
const { handleApi } = require('../server.js');

module.exports = (req, res) => handleApi(req, res);
