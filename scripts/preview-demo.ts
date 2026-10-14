import express from 'express';
import { fileURLToPath } from 'node:url';

// A static preview with no workflow service, credentials, event writes or model connection.
const app = express();
let apiRequests = 0;
app.use('/api', (_req, res) => {
  apiRequests++;
  res.status(503).json({ error: 'This preview has no API backend' });
});
app.get('/__demo/status', (_req, res) => res.json({ backend: false, api_requests: apiRequests }));
app.use(express.static(fileURLToPath(new URL('../frontend/dist/', import.meta.url))));
app.listen(8788, '127.0.0.1', () => console.log('Offline demo: http://127.0.0.1:8788/?demo=1'));
