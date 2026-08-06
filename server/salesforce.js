const {
  SF_CLIENT_ID,
  SF_CLIENT_SECRET,
  SF_INSTANCE_URL,
  SF_API_VERSION = 'v60.0',
} = process.env;

for (const [key, value] of Object.entries({ SF_CLIENT_ID, SF_CLIENT_SECRET, SF_INSTANCE_URL })) {
  if (!value) throw new Error(`Missing required env var: ${key}`);
}

let cachedToken = null; // { accessToken, instanceUrl }

async function authenticate() {
  const url = `${SF_INSTANCE_URL}/services/oauth2/token`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: SF_CLIENT_ID,
    client_secret: SF_CLIENT_SECRET,
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Salesforce authentication failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  cachedToken = { accessToken: data.access_token, instanceUrl: data.instance_url };
  console.log('[salesforce] authenticated successfully');
  return cachedToken;
}

async function getToken() {
  if (!cachedToken) await authenticate();
  return cachedToken;
}

async function sfFetch(path, { retry = true } = {}) {
  const token = await getToken();
  const res = await fetch(`${token.instanceUrl}${path}`, {
    headers: { Authorization: `Bearer ${token.accessToken}` },
  });

  if (res.status === 401 && retry) {
    cachedToken = null;
    return sfFetch(path, { retry: false });
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Salesforce API error (${res.status}) on ${path}: ${text}`);
  }

  return res.json();
}

/**
 * Runs a report and returns its detail row count (matches the number shown
 * in the tile's grand-total, since these reports have no groupings).
 */
export async function getReportRowCount(reportId) {
  const data = await sfFetch(
    `/services/data/${SF_API_VERSION}/analytics/reports/${reportId}?includeDetails=true`
  );

  const grandTotal = data.factMap?.['T!T'];
  if (grandTotal?.rows) {
    console.log(`[salesforce] report ${reportId} fetched successfully (${grandTotal.rows.length} rows)`);
    return grandTotal.rows.length;
  }

  // Grouped report fallback: sum rows across every bucket.
  const count = Object.values(data.factMap || {}).reduce(
    (sum, group) => sum + (group.rows ? group.rows.length : 0),
    0
  );
  console.log(`[salesforce] report ${reportId} fetched successfully (${count} rows, grouped)`);
  return count;
}

let cachedBucketMap = null; // Map<Product_Type__c value, 'aa' | 'ae'>

/**
 * Mirrors the "Product Line" bucket field configured on the AA Tickets
 * report (the same one shown in Salesforce's bucket editor) so a Product
 * Type value counts toward the same service here as it does in the report
 * tiles. Cached for the process lifetime — bucket assignments change rarely
 * and restarting the server is enough to pick up an edit.
 */
async function getProductLineBucketMap() {
  if (cachedBucketMap) return cachedBucketMap;

  const reportId = process.env.SF_REPORT_AA;
  const data = await sfFetch(`/services/data/${SF_API_VERSION}/analytics/reports/${reportId}/describe`);
  const bucket = data.reportMetadata?.buckets?.find((b) => b.sourceColumnName === 'Case.Product_Type__c');

  const map = new Map();
  for (const { label, sourceDimensionValues } of bucket?.values || []) {
    const service = label === 'AA' ? 'aa' : label === 'AE' ? 'ae' : null;
    if (!service) continue;
    for (const value of sourceDimensionValues) map.set(value, service);
  }

  cachedBucketMap = map;
  return map;
}

/**
 * gStore is counted by its own report via a direct equality filter, not
 * the AA/AE bucket, so it takes priority over the bucket's own "AE"
 * grouping of the gStore product type.
 */
function classifyProductType(productType, bucketMap) {
  if (!productType) return null;
  if (productType === 'gStore') return 'gstore';
  return bucketMap.get(productType) || null;
}

async function resolveListViewId(devNameOrId) {
  const looksLikeId = /^00B[a-zA-Z0-9]{12,15}$/.test(devNameOrId);
  if (looksLikeId) return devNameOrId;

  const all = await sfFetch(`/services/data/${SF_API_VERSION}/sobjects/Case/listviews`);
  const match = all.listviews.find(
    (lv) => lv.developerName === devNameOrId || lv.label === devNameOrId
  );
  if (!match) throw new Error(`Case list view "${devNameOrId}" not found`);
  return match.id;
}

// The List View Results API always includes these system/audit fields even
// when the Salesforce UI hides them for this list view.
const HIDDEN_CASE_FIELDS = new Set([
  'Id',
  'RecordTypeId',
  'CreatedDate',
  'LastModifiedDate',
  'SystemModstamp',
  'Default_Ticket_IM__c',
]);

const SALESFORCE_ID = /^[a-zA-Z0-9]{15,18}$/;

// Salesforce labels this relationship field after the lookup ("Default Ticket IM"),
// not the case number it actually displays.
const COLUMN_LABEL_OVERRIDES = {
  'Default_Ticket_IM__r.CaseNumber': 'Case ID',
};

/**
 * Each IM Bridge row is a bridge case pointing at the actual incident via
 * Default_Ticket_IM__c; that incident's Product_Type__c is what determines
 * AA/AE/gStore, so it has to be looked up separately from the list view.
 */
async function getProductTypesByCaseId(caseIds) {
  const ids = [...new Set(caseIds)].filter((id) => SALESFORCE_ID.test(id));
  if (!ids.length) return new Map();

  const soql = `SELECT Id, Product_Type__c FROM Case WHERE Id IN (${ids.map((id) => `'${id}'`).join(',')})`;
  const data = await sfFetch(`/services/data/${SF_API_VERSION}/query?q=${encodeURIComponent(soql)}`);

  return new Map(data.records.map((r) => [r.Id, r.Product_Type__c]));
}

/**
 * Returns { columns, rows } for a Case list view, using the same columns
 * and filters configured on the list view in Salesforce, unfiltered. Adds
 * a synthetic leading "Service" column classifying each row as aa/ae/gstore
 * to match the AA/AE/gStore report tiles, when the list view links to the
 * underlying incident via Default_Ticket_IM__c.
 */
export async function getCaseListView(devNameOrId) {
  const listViewId = await resolveListViewId(devNameOrId);
  const results = await sfFetch(
    `/services/data/${SF_API_VERSION}/sobjects/Case/listviews/${listViewId}/results`
  );

  const columns = results.columns
    .filter((col) => !HIDDEN_CASE_FIELDS.has(col.fieldNameOrPath))
    .map((col) => ({
      field: col.fieldNameOrPath,
      label: COLUMN_LABEL_OVERRIDES[col.fieldNameOrPath] || col.label,
    }));

  const rows = results.records.map((record) =>
    Object.fromEntries(record.columns.map((col) => [col.fieldNameOrPath, col.value]))
  );

  const hasIncidentLink = results.columns.some((col) => col.fieldNameOrPath === 'Default_Ticket_IM__c');
  if (hasIncidentLink) {
    const [productTypesById, bucketMap] = await Promise.all([
      getProductTypesByCaseId(rows.map((r) => r.Default_Ticket_IM__c)),
      getProductLineBucketMap(),
    ]);

    rows.forEach((row) => {
      const productType = productTypesById.get(row.Default_Ticket_IM__c);
      row.__service = classifyProductType(productType, bucketMap);
      row.__caseUrl = row.Default_Ticket_IM__c
        ? `${SF_INSTANCE_URL}/lightning/r/Case/${row.Default_Ticket_IM__c}/view`
        : null;
    });
    columns.unshift({ field: '__service', label: 'Service' });
  }

  console.log(`[salesforce] case list view "${devNameOrId}" fetched successfully (${rows.length} case(s))`);
  return { columns, rows, size: rows.length };
}
