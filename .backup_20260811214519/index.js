import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { getCaseListView, getTrendData } from './salesforce.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4001;

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/dashboard', async (req, res) => {
  try {
    const cases = await getCaseListView(process.env.SF_CASE_LISTVIEW);
    res.json({
      asOf: new Date().toISOString(),
      reportUrls: {
        aa: `${process.env.SF_INSTANCE_URL}/${process.env.SF_REPORT_AA}`,
        ae: `${process.env.SF_INSTANCE_URL}/${process.env.SF_REPORT_AE}`,
        gstore: `${process.env.SF_INSTANCE_URL}/${process.env.SF_REPORT_GSTORE}`,
      },
      cases,
    });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/trend', async (req, res) => {
  try {
    const range = req.query.range || '7d';
    const now = new Date();
    let startDate;
    if (range === '2d') startDate = new Date(now - 2 * 86400000);
    else if (range === '7d') startDate = new Date(now - 7 * 86400000);
    else if (range === '1m') startDate = new Date(now - 30 * 86400000);
    else startDate = new Date(now - 180 * 86400000);

    const dateMap = await getTrendData(startDate);

    const days = [];
    const cursor = new Date(startDate);
    cursor.setUTCHours(0, 0, 0, 0);
    const endMs = Date.now();
    while (cursor.getTime() <= endMs) {
      const key = cursor.toISOString().slice(0, 10);
      const entry = dateMap.get(key) || { aa: 0, ae: 0, gstore: 0 };
      days.push({ date: key, ...entry });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    res.json({ trend: days });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`CritSit dashboard running at http://localhost:${PORT}`);
});
