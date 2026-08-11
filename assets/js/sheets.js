/* sheets.js — ดึงและแปลงข้อมูลจาก Google Sheet (gviz endpoint, ไม่ต้องใช้ API key) */

const Sheets = (() => {
  /** ดึง spreadsheet ID จากลิงก์ หรือคืนค่าเดิมถ้าเป็น ID อยู่แล้ว */
  function extractId(input) {
    if (!input) return null;
    const trimmed = input.trim();
    const m = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (m) return m[1];
    // ถ้าผู้ใช้วาง ID มาตรง ๆ
    if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed)) return trimmed;
    return null;
  }

  /** ดึง gid (ถ้ามี) จากลิงก์ */
  function extractGid(input) {
    if (!input) return null;
    const m = input.match(/[#&?]gid=([0-9]+)/);
    return m ? m[1] : null;
  }

  /** สร้าง URL ของ gviz endpoint */
  function buildUrl(id, tabName, gid) {
    let url = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:json`;
    if (tabName) url += `&sheet=${encodeURIComponent(tabName)}`;
    else if (gid) url += `&gid=${encodeURIComponent(gid)}`;
    return url;
  }

  /** แปลงค่าจาก gviz cell ให้เป็นค่าที่ใช้งานได้ */
  function parseCellValue(cell, type) {
    if (!cell || cell.v === null || cell.v === undefined) return null;
    if (type === 'date' || type === 'datetime') {
      // gviz ส่งค่า date เป็น string "Date(2024,0,15)"
      if (typeof cell.v === 'string') {
        const dm = cell.v.match(/Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+),(\d+))?\)/);
        if (dm) {
          return new Date(+dm[1], +dm[2], +dm[3], +dm[4] || 0, +dm[5] || 0, +dm[6] || 0);
        }
      }
      return cell.f || cell.v;
    }
    return cell.v;
  }

  /**
   * ดึงข้อมูลจาก Sheet คืนค่าเป็น { columns, rows }
   *  columns: [{ label, type }]
   *  rows: [{ [label]: value, ... }]
   */
  async function fetchTable(input, tabName) {
    const id = extractId(input);
    if (!id) throw new Error('ไม่พบ Google Sheet ID — กรุณาตรวจสอบลิงก์อีกครั้ง');

    const gid = extractGid(input);
    const url = buildUrl(id, tabName, gid);

    let text;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      text = await res.text();
    } catch (e) {
      throw new Error(
        'ดึงข้อมูลไม่สำเร็จ — ตรวจสอบว่า Sheet ตั้งค่าแชร์เป็น "ทุกคนที่มีลิงก์" แล้ว (' + e.message + ')'
      );
    }

    // gviz ห่อ JSON ไว้ใน callback: /*O_o*/\ngoogle.visualization.Query.setResponse({...});
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1) {
      throw new Error('รูปแบบข้อมูลไม่ถูกต้อง — Sheet อาจไม่ได้แชร์แบบสาธารณะ');
    }

    let payload;
    try {
      payload = JSON.parse(text.substring(start, end + 1));
    } catch (e) {
      throw new Error('แปลงข้อมูลไม่สำเร็จ: ' + e.message);
    }

    if (payload.status === 'error') {
      const msg = (payload.errors && payload.errors[0] && payload.errors[0].detailed_message) || 'ไม่ทราบสาเหตุ';
      throw new Error('Google Sheet: ' + stripHtml(msg));
    }

    const table = payload.table;
    if (!table || !table.cols) throw new Error('ไม่พบตารางข้อมูลใน Tab นี้');

    const rawCols = table.cols;
    const rawRows = table.rows || [];

    // ค่าดิบของทุก cell (ก่อนสร้างเป็น object) เพื่อใช้ตรวจคอลัมน์/แถวว่าง
    const matrix = rawRows.map((r) =>
      rawCols.map((c, i) => parseCellValue(r.c[i], c.type))
    );

    const isEmpty = (v) => v === null || v === undefined || v === '';

    // 1) ตัดคอลัมน์ที่ไม่มีข้อมูลเลย (เช่น K, L, M ที่ว่างทั้งคอลัมน์)
    const keepCol = rawCols.map((c, i) => {
      const hasHeader = c.label && c.label.trim();
      const hasData = matrix.some((row) => !isEmpty(row[i]));
      return hasHeader || hasData;
    });

    // สร้างชื่อคอลัมน์ (ใช้ label ถ้ามี ไม่งั้นใช้ตัวอักษร A, B, C)
    const columns = rawCols
      .map((c, i) => ({
        idx: i,
        id: c.id,
        label: (c.label && c.label.trim()) || String.fromCharCode(65 + (i % 26)),
        type: c.type || 'string',
      }))
      .filter((_, i) => keepCol[i]);

    // กันชื่อคอลัมน์ซ้ำ (ไม่งั้น object key ทับกัน ข้อมูลหาย)
    const seen = {};
    columns.forEach((col) => {
      if (seen[col.label] !== undefined) {
        seen[col.label] += 1;
        col.label = `${col.label} (${seen[col.label]})`;
      } else {
        seen[col.label] = 0;
      }
    });

    // 2) สร้างแถว โดยข้ามแถวที่ว่างทั้งแถว
    const rows = [];
    matrix.forEach((row) => {
      if (columns.every((col) => isEmpty(row[col.idx]))) return; // แถวว่าง
      const obj = {};
      columns.forEach((col) => {
        obj[col.label] = row[col.idx];
      });
      rows.push(obj);
    });

    // ตัด field idx ที่ใช้ภายในออก
    columns.forEach((c) => delete c.idx);

    return { columns, rows, sheetId: id };
  }

  function stripHtml(s) {
    return String(s).replace(/<[^>]*>/g, '').trim();
  }

  return { extractId, fetchTable };
})();
