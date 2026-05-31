import { getRows } from './sheets.js';

// True if `member` (its Playa Name or legal Name) appears in the comma-separated
// AssignedTo of the Roles row whose Name matches `roleName` (case-insensitive).
// Reads the whole Roles tab per call (no caching) — consistent with other
// per-request sheet reads in this codebase; fine at this scale.
export async function isAssignedToRole(sheets, spreadsheetId, roleName, member) {
  if (!member) return false;
  const rows = await getRows(sheets, spreadsheetId, 'Roles');
  if (!rows.length) return false;
  const headers = rows[0];
  const nameCol = headers.indexOf('Name');
  const assignedCol = headers.indexOf('AssignedTo');
  if (nameCol === -1 || assignedCol === -1) return false;
  const target = (roleName || '').trim().toLowerCase();
  const playa = (member['Playa Name'] || '').trim().toLowerCase();
  const legal = (member.Name || '').trim().toLowerCase();
  for (let i = 1; i < rows.length; i++) {
    if ((rows[i][nameCol] || '').trim().toLowerCase() !== target) continue;
    const assigned = (rows[i][assignedCol] || '').split(',').map(s => s.trim().toLowerCase());
    if ((playa && assigned.indexOf(playa) !== -1) || (legal && assigned.indexOf(legal) !== -1)) {
      return true;
    }
  }
  return false;
}
