import 'dotenv/config';

const { SF_CLIENT_ID, SF_CLIENT_SECRET, SF_INSTANCE_URL, SF_API_VERSION = 'v60.0' } = process.env;

const tokenRes = await fetch(`${SF_INSTANCE_URL}/services/oauth2/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: SF_CLIENT_ID,
    client_secret: SF_CLIENT_SECRET,
  }),
});
const tokenData = await tokenRes.json();
if (!tokenRes.ok) {
  console.error('AUTH FAILED', tokenData);
  process.exit(1);
}
console.log('Authenticated as instance:', tokenData.instance_url);

// Who am I?
const idRes = await fetch(tokenData.id, { headers: { Authorization: `Bearer ${tokenData.access_token}` } });
const idData = await idRes.json();
console.log('Identity:', idData.username, idData.user_id);

async function sf(path) {
  const res = await fetch(`${tokenData.instance_url}${path}`, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const data = await res.json();
  return { status: res.status, data };
}

for (const [label, reportId] of [['AA', process.env.SF_REPORT_AA], ['AE', process.env.SF_REPORT_AE], ['GSTORE', process.env.SF_REPORT_GSTORE]]) {
  const { status, data } = await sf(`/services/data/${SF_API_VERSION}/analytics/reports/${reportId}/describe`);
  console.log(`\n=== ${label} report describe (status ${status}) ===`);
  if (data.reportMetadata) {
    console.log('name:', data.reportMetadata.name);
    console.log('reportType:', JSON.stringify(data.reportMetadata.reportType));
    console.log('reportFilters:', JSON.stringify(data.reportMetadata.reportFilters));
    console.log('reportBooleanFilter:', data.reportMetadata.reportBooleanFilter);
    console.log('standardDateFilter:', JSON.stringify(data.reportMetadata.standardDateFilter));
    console.log('scope:', data.reportMetadata.scope);
  } else {
    console.log(JSON.stringify(data).slice(0, 1000));
  }
}

// List view describe
const lvAll = await sf(`/services/data/${SF_API_VERSION}/sobjects/Case/listviews`);
const lv = lvAll.data.listviews?.find(l => l.developerName === process.env.SF_CASE_LISTVIEW || l.label === process.env.SF_CASE_LISTVIEW);
console.log('\n=== List view match ===', lv ? { id: lv.id, developerName: lv.developerName, label: lv.label } : 'NOT FOUND');
if (lv) {
  const desc = await sf(`/services/data/${SF_API_VERSION}/sobjects/Case/listviews/${lv.id}/describe`);
  console.log('List view whereCondition:', desc.data.whereCondition);
  console.log('List view scope:', desc.data.scope);
}

console.log('\n=== Bucket field definitions (AA report) ===');
const { data: aaDesc } = await sf(`/services/data/${SF_API_VERSION}/analytics/reports/${process.env.SF_REPORT_AA}/describe`);
console.log(JSON.stringify(aaDesc.reportExtendedMetadata?.bucketFieldsMetadata, null, 2));

console.log('\n=== Sample open Incident cases (any SLA category, any status) ===');
const soql = `SELECT Id, CaseNumber, Status, Type, SLA_Category__c, Impact_Percentage__c, Product_Type__c, Account.Name, Zendesk_id__c FROM Case WHERE Type = 'Incident' AND Status NOT IN ('Pending Confirmation','Solved') ORDER BY CreatedDate DESC LIMIT 25`;
const { status: qStatus, data: qData } = await sf(`/services/data/${SF_API_VERSION}/query?q=${encodeURIComponent(soql)}`);
console.log('status', qStatus, 'totalSize', qData.totalSize);
console.log(JSON.stringify(qData.records, null, 2));
