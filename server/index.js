import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { getCaseListView } from './salesforce.js';

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

app.listen(PORT, () => {
  console.log(`CritSit dashboard running at http://localhost:${PORT}`);
});
