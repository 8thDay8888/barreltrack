/**
 * BarrelTrack — Google Sheets API Integration
 * ============================================
 * Connects the 8th Day BarrelTrack app to the "8th Day Barrel Inventory"
 * Google Sheet on shared Google Drive.
 *
 * KEY DESIGN: The Google Sheet stores the FULL production export (all 27 columns)
 * exactly as your production software outputs it. This module reads the whole sheet
 * but maps only the fields the app needs for display and location tracking.
 * Location columns (Warehouse, Row, Depth, Height) are updated by the app in-place.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PRODUCTION EXPORT COLUMNS (27 total — stored verbatim in the Sheet)
 * ─────────────────────────────────────────────────────────────────────────────
 *  A  Account          B  FacilityName     C  Lot              D  BarrelId
 *  E  Barrel Owner     F  Condition        G  Capacity         H  CharLevel
 *  I  WoodSpecies      J  Cooperage        K  SpiritProfile    L  KindOfSpirits
 *  M  RecipeName       N  FilledDate       O  Fill Month       P  Fill Year
 *  Q  Volume           R  Proof            S  PureAlcohol      T  BarrelAge
 *  U  SpiritAge        V  BatchId          W  Location         X  Warehouse
 *  Y  Row              Z  Depth            AA Height
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * APP-VISIBLE FIELDS (pulled from the sheet and shown on the scan card)
 * ─────────────────────────────────────────────────────────────────────────────
 *  BarrelId (D)   Cooperage (J)   RecipeName (M)   FilledDate (N)
 *  Proof (R)      Capacity (G)    Warehouse (X)    Row (Y)   Depth (Z)   Height (AA)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * MONTHLY UPDATE WORKFLOW
 * ─────────────────────────────────────────────────────────────────────────────
 *  1. Export your running log from production software (same format, all 27 cols)
 *  2. Call importFromProductionExport(rows) — it compares BarrelId column and:
 *       • Appends brand-new barrels (not yet in the sheet)
 *       • Updates production data on existing barrels (cooperage, proof, etc.)
 *       • NEVER overwrites Warehouse / Row / Depth / Height set by the app
 *       • NEVER deletes rows — removed barrels remain for audit trail
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE-TIME SETUP
 * ─────────────────────────────────────────────────────────────────────────────
 *  1. Go to console.cloud.google.com → create project "8thDayBarrelTrack"
 *  2. Enable Google Sheets API and Google Drive API
 *  3. Create OAuth 2.0 Client ID (Web Application) → copy CLIENT_ID below
 *  4. Create Google Sheet "8th Day Barrel Inventory" on shared Drive
 *     → rename first tab to "Barrels"
 *  5. Copy Spreadsheet ID from the URL → paste into SPREADSHEET_ID below
 *  6. Run initializeSheet() once to write headers and formatting
 */

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION — update CLIENT_ID and SPREADSHEET_ID before deploying
// ─────────────────────────────────────────────────────────────────────────────
const CONFIG = {
  CLIENT_ID:      'YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com',
  SPREADSHEET_ID: 'YOUR_SPREADSHEET_ID_FROM_URL',
  SHEET_NAME:     'Barrels',
  DATA_START_ROW: 2,        // Row 1 = headers; barrel data starts at row 2
  SCOPES:         'https://www.googleapis.com/auth/spreadsheets',
};

// ─────────────────────────────────────────────────────────────────────────────
// COLUMN MAP — production export schema, stored verbatim in the Google Sheet.
// Column letters A–Z then AA, AB, etc.
// "appKey" is the field name used inside the app (null = stored but not used by app).
// "appVisible" = true means the app reads and displays this field on the scan card.
// "locationField" = true means the app writes back to this column when moving barrels.
// ─────────────────────────────────────────────────────────────────────────────
const COLUMN_MAP = [
  // col   exportName        appKey          appVisible  locationField
  { col:'A',  name:'Account',       appKey:null,          appVisible:false, locationField:false },
  { col:'B',  name:'FacilityName',  appKey:null,          appVisible:false, locationField:false },
  { col:'C',  name:'Lot',           appKey:null,          appVisible:false, locationField:false },
  { col:'D',  name:'BarrelId',      appKey:'id',          appVisible:true,  locationField:false },
  { col:'E',  name:'Barrel Owner',  appKey:null,          appVisible:false, locationField:false },
  { col:'F',  name:'Condition',     appKey:null,          appVisible:false, locationField:false },
  { col:'G',  name:'Capacity',      appKey:'capacity',    appVisible:true,  locationField:false },
  { col:'H',  name:'CharLevel',     appKey:null,          appVisible:false, locationField:false },
  { col:'I',  name:'WoodSpecies',   appKey:null,          appVisible:false, locationField:false },
  { col:'J',  name:'Cooperage',     appKey:'cooperage',   appVisible:true,  locationField:false },
  { col:'K',  name:'SpiritProfile', appKey:null,          appVisible:false, locationField:false },
  { col:'L',  name:'KindOfSpirits', appKey:null,          appVisible:false, locationField:false },
  { col:'M',  name:'RecipeName',    appKey:'recipe',      appVisible:true,  locationField:false },
  { col:'N',  name:'FilledDate',    appKey:'fillDate',    appVisible:true,  locationField:false },
  { col:'O',  name:'Fill Month',    appKey:null,          appVisible:false, locationField:false },
  { col:'P',  name:'Fill Year',     appKey:null,          appVisible:false, locationField:false },
  { col:'Q',  name:'Volume',        appKey:null,          appVisible:false, locationField:false },
  { col:'R',  name:'Proof',         appKey:'proof',       appVisible:true,  locationField:false },
  { col:'S',  name:'PureAlcohol',   appKey:null,          appVisible:false, locationField:false },
  { col:'T',  name:'BarrelAge',     appKey:null,          appVisible:false, locationField:false },
  { col:'U',  name:'SpiritAge',     appKey:null,          appVisible:false, locationField:false },
  { col:'V',  name:'BatchId',       appKey:null,          appVisible:false, locationField:false },
  { col:'W',  name:'Location',      appKey:null,          appVisible:false, locationField:false },
  { col:'X',  name:'Warehouse',     appKey:'zone',        appVisible:true,  locationField:true  },
  { col:'Y',  name:'Row',           appKey:'row',         appVisible:true,  locationField:true  },
  { col:'Z',  name:'Depth',         appKey:'pallet',      appVisible:true,  locationField:true  },
  { col:'AA', name:'Height',        appKey:'slot',        appVisible:true,  locationField:true  },
  // App-only columns — appended after the export columns (not in production export)
  { col:'AB', name:'LastUpdated',   appKey:'updatedAt',   appVisible:false, locationField:false },
  { col:'AC', name:'UpdatedBy',     appKey:'updatedBy',   appVisible:false, locationField:false },
];

// Derived lookups built once at load time
const COL_BY_NAME   = Object.fromEntries(COLUMN_MAP.map(c => [c.name,  c]));
const COL_BY_APPKEY = Object.fromEntries(COLUMN_MAP.filter(c => c.appKey).map(c => [c.appKey, c]));
const TOTAL_COLS    = COLUMN_MAP.length;  // 29 (27 export + 2 app-only)
const LAST_COL      = COLUMN_MAP[TOTAL_COLS - 1].col;  // 'AC'

// Column index (0-based) helpers
function colIndex(colLetter) {
  // Handles A–Z (0–25) and AA–AZ (26–51)
  const upper = colLetter.toUpperCase();
  if (upper.length === 1) return upper.charCodeAt(0) - 65;
  return (upper.charCodeAt(0) - 64) * 26 + (upper.charCodeAt(1) - 65);
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTH — Google Identity Services (GIS)
// ─────────────────────────────────────────────────────────────────────────────

let _tokenClient = null;
let _accessToken  = null;
let _tokenExpiry  = 0;

/**
 * Load the Google Identity Services library dynamically.
 * Call once on app startup before any other function.
 */
export async function loadGoogleAuth() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) { resolve(); return; }
    const script = document.createElement('script');
    script.src    = 'https://accounts.google.com/gsi/client';
    script.onload = resolve;
    script.onerror = () => reject(new Error('Failed to load Google Identity Services'));
    document.head.appendChild(script);
  });
}

/**
 * Initialize the OAuth2 token client. Call after loadGoogleAuth() resolves.
 */
export function initTokenClient() {
  _tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.CLIENT_ID,
    scope:     CONFIG.SCOPES,
    callback: (response) => {
      if (response.error) throw new Error('Auth failed: ' + response.error);
      _accessToken = response.access_token;
      _tokenExpiry = Date.now() + (response.expires_in * 1000) - 60000;
    },
  });
}

/** Ensure a valid token, prompting re-login if expired. */
async function ensureAuth() {
  if (_accessToken && Date.now() < _tokenExpiry) return;
  return new Promise((resolve, reject) => {
    _tokenClient.callback = (response) => {
      if (response.error) { reject(new Error(response.error)); return; }
      _accessToken = response.access_token;
      _tokenExpiry = Date.now() + (response.expires_in * 1000) - 60000;
      resolve();
    };
    _tokenClient.requestAccessToken({ prompt: _accessToken ? '' : 'consent' });
  });
}

/** Sign out and clear stored tokens. */
export function signOut() {
  if (_accessToken) window.google.accounts.oauth2.revoke(_accessToken);
  _accessToken = null;
  _tokenExpiry = 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// CORE API HELPER
// ─────────────────────────────────────────────────────────────────────────────

async function sheetsRequest(method, endpoint, body = null) {
  await ensureAuth();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}${endpoint}`;
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${_accessToken}`,
      'Content-Type':  'application/json',
    },
  };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(url, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Sheets API ${res.status}: ${err?.error?.message || res.statusText}`);
  }
  return res.status === 204 ? null : res.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// ROW ↔ BARREL OBJECT CONVERSION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert a raw sheet row (array of cell values) → barrel object.
 * Only populates appKey fields — the rest of the raw data stays in the row
 * and is written back verbatim during updates so nothing is lost.
 */
function rowToBarrel(row, sheetRow) {
  const barrel = { _sheetRow: sheetRow, _rawRow: [...row] }; // preserve full raw row
  COLUMN_MAP.forEach((col, i) => {
    if (col.appKey) barrel[col.appKey] = (row[i] ?? '').toString().trim();
  });
  return barrel;
}

/**
 * Merge app field updates back into the preserved raw row.
 * Production data columns are untouched — only app-managed fields are changed.
 */
function mergeUpdatesIntoRow(barrel, updates) {
  const row = [...(barrel._rawRow || [])];
  // Pad row to full width if needed
  while (row.length < TOTAL_COLS) row.push('');

  Object.entries(updates).forEach(([appKey, value]) => {
    const colDef = COL_BY_APPKEY[appKey];
    if (!colDef) return;
    row[colIndex(colDef.col)] = value ?? '';
  });
  return row;
}

// ─────────────────────────────────────────────────────────────────────────────
// ONE-TIME SHEET INITIALIZATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Write the header row and apply formatting. Run ONCE when setting up the sheet.
 * Safe to re-run — it only overwrites row 1.
 */
export async function initializeSheet() {
  // Write all 29 column headers to row 1
  const headers = COLUMN_MAP.map(c => c.name);
  const range   = `${CONFIG.SHEET_NAME}!A1:${LAST_COL}1`;
  await sheetsRequest('PUT',
    `/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    { range, majorDimension: 'ROWS', values: [headers] }
  );

  // Apply formatting: bold headers, freeze row 1, auto-resize
  const meta  = await sheetsRequest('GET', '?fields=sheets.properties');
  const sheet = meta.sheets.find(s => s.properties.title === CONFIG.SHEET_NAME);
  if (!sheet) throw new Error(`Tab "${CONFIG.SHEET_NAME}" not found`);
  const sheetId = sheet.properties.sheetId;

  await sheetsRequest('POST', ':batchUpdate', {
    requests: [
      // Bold header row with dark background
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
          cell: {
            userEnteredFormat: {
              textFormat:      { bold: true, foregroundColor: { red:0, green:0, blue:0 } },
              backgroundColor: { red:1, green:1, blue:1 },
            },
          },
          fields: 'userEnteredFormat(textFormat,backgroundColor)',
        },
      },
      // Freeze row 1
      {
        updateSheetProperties: {
          properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
          fields: 'gridProperties.frozenRowCount',
        },
      },
      // Auto-resize all columns
      {
        autoResizeDimensions: {
          dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: TOTAL_COLS },
        },
      },
    ],
  });

  return { success: true, columns: headers.length, headers };
}

// ─────────────────────────────────────────────────────────────────────────────
// MONTHLY IMPORT — CORE FUNCTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * importFromProductionExport()
 * ────────────────────────────
 * Accepts the full production software export as an array of row arrays
 * (or objects) and intelligently syncs it to the Google Sheet:
 *
 *   ✓  NEW barrels    → appended as new rows at the bottom of the sheet
 *   ✓  EXISTING barrels → production data columns updated in-place
 *   ✗  Location fields (Warehouse/Row/Depth/Height) → NEVER overwritten
 *   ✗  App-only fields (LastUpdated/UpdatedBy) → NEVER overwritten
 *   ✗  Rows are NEVER deleted — removed barrels stay for audit trail
 *
 * @param {Array} exportRows  - Array of row arrays from the production export.
 *                              Row 0 may be the header row — detected automatically.
 * @param {Object} options
 *   @param {boolean} options.hasHeader  - true if exportRows[0] is a header row (default: true)
 *   @param {string}  options.operator   - Initials/name of person running the import
 *
 * @returns {Promise<ImportResult>}
 *   { added: number, updated: number, skipped: number, errors: string[] }
 *
 * USAGE EXAMPLE:
 *   // After user uploads/pastes the export file:
 *   const result = await importFromProductionExport(rawRows, { operator: 'JL' });
 *   console.log(`Added ${result.added} barrels, updated ${result.updated}`);
 */
export async function importFromProductionExport(exportRows, options = {}) {
  const { hasHeader = true, operator = 'import' } = options;

  // ── 1. Parse the export ─────────────────────────────────────────────────
  let dataRows = hasHeader ? exportRows.slice(1) : exportRows;

  // Support both array-of-arrays and array-of-objects
  const exportHeader = hasHeader ? exportRows[0] : COLUMN_MAP.map(c => c.name);
  const isObjectRows = dataRows.length > 0 && !Array.isArray(dataRows[0]);
  if (isObjectRows) {
    dataRows = dataRows.map(obj => exportHeader.map(h => obj[h] ?? ''));
  }

  // ── 2. Build column index map from export header ──────────────────────────
  // The export header may have different column order — we map by name, not position
  const exportColIndex = {};
  exportHeader.forEach((name, i) => { exportColIndex[name.trim()] = i; });

  // Helper: get a value from an export row by column name
  const exportVal = (row, colName) => {
    const i = exportColIndex[colName];
    return (i !== undefined && row[i] !== undefined && row[i] !== null)
      ? String(row[i]).trim()
      : '';
  };

  // ── 3. Load existing sheet data ───────────────────────────────────────────
  const existing   = await getAllBarrels();
  const existingMap = new Map(existing.map(b => [b.id, b]));

  // ── 4. Separate new barrels from updates ──────────────────────────────────
  const toAppend  = [];   // new barrels not yet in the sheet
  const toUpdate  = [];   // existing barrels with changed production data
  const errors    = [];
  let   skipped   = 0;

  const timestamp = new Date().toISOString();
  const abIndex   = colIndex('AB');  // LastUpdated
  const acIndex   = colIndex('AC');  // UpdatedBy

  for (const exportRow of dataRows) {
    const barrelId = exportVal(exportRow, 'BarrelId');
    if (!barrelId) { skipped++; continue; }

    // Build a full 29-column sheet row from the export row
    const sheetRow = new Array(TOTAL_COLS).fill('');

    // Map each export column to its sheet column position
    COLUMN_MAP.forEach(colDef => {
      const exportIdx = exportColIndex[colDef.name];
      if (exportIdx !== undefined) {
        sheetRow[colIndex(colDef.col)] = String(exportRow[exportIdx] ?? '').trim();
      }
    });

    if (existingMap.has(barrelId)) {
      // ── EXISTING BARREL: update production columns only ───────────────────
      const existing_barrel = existingMap.get(barrelId);
      const updatedRow = [...existing_barrel._rawRow];
      while (updatedRow.length < TOTAL_COLS) updatedRow.push('');

      let changed = false;
      COLUMN_MAP.forEach(colDef => {
        // Skip location fields and app-only fields — never overwrite
        if (colDef.locationField) return;
        if (['LastUpdated','UpdatedBy'].includes(colDef.name)) return;

        const ci  = colIndex(colDef.col);
        const newVal = sheetRow[ci];
        if (newVal !== '' && newVal !== updatedRow[ci]) {
          updatedRow[ci] = newVal;
          changed = true;
        }
      });

      if (changed) {
        updatedRow[abIndex] = timestamp;
        updatedRow[acIndex] = operator + ' (import)';
        toUpdate.push({ sheetRow: existing_barrel._sheetRow, row: updatedRow });
      } else {
        skipped++;
      }
    } else {
      // ── NEW BARREL: append with all production data ───────────────────────
      // Location fields start blank (assigned by app when barrel is physically placed)
      sheetRow[colIndex('X')] = '';  // Warehouse — blank until assigned in app
      sheetRow[colIndex('Y')] = '';  // Row
      sheetRow[colIndex('Z')] = '';  // Depth
      sheetRow[colIndex('AA')] = ''; // Height
      sheetRow[abIndex] = timestamp;
      sheetRow[acIndex] = operator + ' (import)';
      toAppend.push(sheetRow);
    }
  }

  const result = { added: toAppend.length, updated: toUpdate.length, skipped, errors };

  // ── 5. Append new barrels ─────────────────────────────────────────────────
  if (toAppend.length > 0) {
    const range = `${CONFIG.SHEET_NAME}!A1:${LAST_COL}1`;
    await sheetsRequest(
      'POST',
      `/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      { majorDimension: 'ROWS', values: toAppend }
    );
  }

  // ── 6. Update existing barrels (batch) ───────────────────────────────────
  if (toUpdate.length > 0) {
    const valueRanges = toUpdate.map(({ sheetRow: sr, row }) => ({
      range: `${CONFIG.SHEET_NAME}!A${sr}:${LAST_COL}${sr}`,
      majorDimension: 'ROWS',
      values: [row],
    }));
    await sheetsRequest('POST', '/values:batchUpdate?valueInputOption=USER_ENTERED', {
      valueInputOption: 'USER_ENTERED',
      data: valueRanges,
    });
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// READ OPERATIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch all barrels from the sheet.
 * Returns barrel objects with only app-visible fields populated,
 * but _rawRow preserves the full row for safe write-back.
 */
export async function getAllBarrels() {
  const range = `${CONFIG.SHEET_NAME}!A${CONFIG.DATA_START_ROW}:${LAST_COL}`;
  const data  = await sheetsRequest('GET', `/values/${encodeURIComponent(range)}`);
  const rows  = data.values ?? [];
  return rows
    .filter(row => row[colIndex('D')])  // skip rows with no BarrelId (col D)
    .map((row, i) => rowToBarrel(row, i + CONFIG.DATA_START_ROW));
}

/**
 * Fetch a single barrel by BarrelId. Scans the full sheet once.
 * @param {string} barrelId - e.g. '1003.H' or '103'
 */
export async function getBarrelById(barrelId) {
  const all = await getAllBarrels();
  return all.find(b => b.id === barrelId.trim()) ?? null;
}

/**
 * Search barrels — filters client-side after a full fetch.
 * @param {Object} filters  e.g. { zone: 'D7', recipe: 'Bourbon' }
 */
export async function searchBarrels(filters = {}) {
  const all = await getAllBarrels();
  return all.filter(b =>
    Object.entries(filters).every(([k, v]) =>
      !v || (b[k] ?? '').toLowerCase().includes(v.toLowerCase())
    )
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// WRITE OPERATIONS — LOCATION & AUDIT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Update a barrel's warehouse location.
 * Writes ONLY the four location columns (X, Y, Z, AA) plus LastUpdated / UpdatedBy.
 * All production export columns are preserved exactly as stored.
 *
 * @param {string} barrelId
 * @param {{ zone, row, pallet, slot }} location
 * @param {string} operator  - operator initials (from the app header field)
 */
export async function updateBarrelLocation(barrelId, location, operator = 'unknown') {
  const { barrel, sheetRow } = await _findBarrelRow(barrelId);
  if (!barrel) throw new Error(`Barrel ${barrelId} not found`);

  const timestamp = new Date().toISOString();
  const updatedRow = mergeUpdatesIntoRow(barrel, {
    zone:      location.zone      ?? '',
    row:       location.row       ?? '',
    pallet:    location.pallet    ?? '',
    slot:      location.slot      ?? '',
    updatedAt: timestamp,
    updatedBy: operator,
  });

  const range = `${CONFIG.SHEET_NAME}!A${sheetRow}:${LAST_COL}${sheetRow}`;
  await sheetsRequest('PUT',
    `/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    { range, majorDimension: 'ROWS', values: [updatedRow] }
  );

  return { ...barrel, zone: location.zone, row: location.row, pallet: location.pallet, slot: location.slot };
}

/**
 * Swap two barrels' locations atomically in a single batchUpdate call.
 * @param {string} idA
 * @param {string} idB
 * @param {string} operator
 */
export async function swapBarrelLocations(idA, idB, operator = 'unknown') {
  const all = await getAllBarrels();
  const a   = all.find(b => b.id === idA);
  const b   = all.find(b => b.id === idB);
  if (!a || !b) throw new Error(`Barrel not found: ${!a ? idA : idB}`);

  const timestamp = new Date().toISOString();
  const rowA = mergeUpdatesIntoRow(a, { zone:b.zone, row:b.row, pallet:b.pallet, slot:b.slot, updatedAt:timestamp, updatedBy:operator });
  const rowB = mergeUpdatesIntoRow(b, { zone:a.zone, row:a.row, pallet:a.pallet, slot:a.slot, updatedAt:timestamp, updatedBy:operator });

  await sheetsRequest('POST', '/values:batchUpdate?valueInputOption=USER_ENTERED', {
    valueInputOption: 'USER_ENTERED',
    data: [
      { range:`${CONFIG.SHEET_NAME}!A${a._sheetRow}:${LAST_COL}${a._sheetRow}`, majorDimension:'ROWS', values:[rowA] },
      { range:`${CONFIG.SHEET_NAME}!A${b._sheetRow}:${LAST_COL}${b._sheetRow}`, majorDimension:'ROWS', values:[rowB] },
    ],
  });

  return { a: { ...a, zone:b.zone, row:b.row, pallet:b.pallet, slot:b.slot },
           b: { ...b, zone:a.zone, row:a.row, pallet:a.pallet, slot:a.slot } };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT / REPORTING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Export the full barrel sheet as a CSV string (all 29 columns).
 * Useful for backup or re-importing into other systems.
 */
export async function exportToCSV() {
  const range = `${CONFIG.SHEET_NAME}!A1:${LAST_COL}`;
  const data  = await sheetsRequest('GET', `/values/${encodeURIComponent(range)}`);
  const rows  = data.values ?? [];
  return rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
}

/**
 * Return summary counts useful for the dashboard.
 */
export async function getInventorySummary() {
  const all       = await getAllBarrels();
  const located   = all.filter(b => b.zone);
  const byWarehouse = {};
  located.forEach(b => { byWarehouse[b.zone] = (byWarehouse[b.zone] || 0) + 1; });
  return {
    total:      all.length,
    located:    located.length,
    unassigned: all.length - located.length,
    byWarehouse,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────────────────────

async function _findBarrelRow(barrelId) {
  const all    = await getAllBarrels();
  const barrel = all.find(b => b.id === barrelId.trim());
  return { barrel: barrel ?? null, sheetRow: barrel?._sheetRow ?? null };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  CONFIG,
  COLUMN_MAP,
  COL_BY_NAME,
  COL_BY_APPKEY,
};

export default {
  // Auth
  loadGoogleAuth,
  initTokenClient,
  signOut,
  // Setup
  initializeSheet,
  // Import
  importFromProductionExport,
  // Read
  getAllBarrels,
  getBarrelById,
  searchBarrels,
  // Write
  updateBarrelLocation,
  swapBarrelLocations,
  // Reporting
  exportToCSV,
  getInventorySummary,
  // Config
  CONFIG,
  COLUMN_MAP,
};
