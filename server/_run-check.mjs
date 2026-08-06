import 'dotenv/config';
import { getReportRowCount, getCaseListView } from './salesforce.js';

console.log('--- Block 1: AA report ---');
const aa = await getReportRowCount(process.env.SF_REPORT_AA);
console.log('AA count:', aa);

console.log('--- Block 2: AE report ---');
const ae = await getReportRowCount(process.env.SF_REPORT_AE);
console.log('AE count:', ae);

console.log('--- Block 3: gStore report ---');
const gstore = await getReportRowCount(process.env.SF_REPORT_GSTORE);
console.log('gStore count:', gstore);

console.log('--- Block 4: IM Bridge case list view ---');
const cases = await getCaseListView(process.env.SF_CASE_LISTVIEW);
console.log('Case list view size:', cases.size);
console.log('Columns:', cases.columns.map((c) => c.field));

