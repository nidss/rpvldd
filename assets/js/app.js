/* app.js — เชื่อม UI, จัดการ state และวาดกราฟบน Dashboard */

(() => {
  // ---------- palette (theme-aware, ปลอดภัยต่อสายตา) ----------
  const PALETTE = ['#6ea8fe', '#7bd88f', '#ffc857', '#f47174', '#b28dff', '#4dd0e1', '#ff9f6e', '#c3e88d'];

  // ---------- state ----------
  let currentData = null; // { columns, rows }
  let cardCounter = 0;
  const charts = new Map(); // cardId -> Chart instance
  const tabHistorySet = new Set();

  // ---------- element refs ----------
  const el = (id) => document.getElementById(id);
  const sheetUrl = el('sheetUrl');
  const tabName = el('tabName');
  const tabHistory = el('tabHistory');
  const fetchDataBtn = el('fetchDataBtn');
  const chartPanel = el('chartPanel');
  const chartType = el('chartType');
  const labelCol = el('labelCol');
  const valueCols = el('valueCols');
  const chartTitle = el('chartTitle');
  const renderBtn = el('renderBtn');
  const recoBox = el('recoBox');
  const recoText = el('recoText');
  const applyRecoBtn = el('applyRecoBtn');
  const statusBar = el('statusBar');
  const cards = el('cards');
  const emptyState = el('emptyState');
  const dashMeta = el('dashMeta');
  const previewBox = el('previewBox');
  const previewMeta = el('previewMeta');
  const previewTable = el('previewTable');

  let lastReco = null;

  // ---------- helpers ----------
  function setStatus(msg, kind = 'info') {
    if (!msg) {
      statusBar.hidden = true;
      return;
    }
    statusBar.hidden = false;
    statusBar.className = 'status ' + kind;
    statusBar.textContent = msg;
  }

  function fillSelect(select, options, selected) {
    select.innerHTML = '';
    options.forEach((opt) => {
      const o = document.createElement('option');
      o.value = opt;
      o.textContent = opt;
      if (opt === selected) o.selected = true;
      select.appendChild(o);
    });
  }

  function fillChecklist(container, columns, selectedSet) {
    container.innerHTML = '';
    columns.forEach((col) => {
      const label = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = col;
      cb.checked = selectedSet.has(col);
      label.appendChild(cb);
      label.appendChild(document.createTextNode(col));
      container.appendChild(label);
    });
  }

  function getCheckedValues(container) {
    return Array.from(container.querySelectorAll('input:checked')).map((c) => c.value);
  }

  function addTabHistory(name) {
    if (!name || tabHistorySet.has(name)) return;
    tabHistorySet.add(name);
    const o = document.createElement('option');
    o.value = name;
    tabHistory.appendChild(o);
  }

  // ---------- ดึงข้อมูล ----------
  async function fetchData() {
    const url = sheetUrl.value.trim();
    if (!url) {
      setStatus('กรุณาวางลิงก์ Google Sheet ก่อน', 'error');
      return;
    }

    const tab = tabName.value.trim();
    fetchDataBtn.disabled = true;
    fetchDataBtn.textContent = 'กำลังดึงข้อมูล...';
    setStatus('กำลังดึงข้อมูลจาก Google Sheet...', 'info');

    try {
      const data = await Sheets.fetchTable(url, tab);
      if (!data.rows.length) {
        setStatus('ดึงข้อมูลได้ แต่ Tab นี้ไม่มีข้อมูล (0 แถว)', 'error');
        return;
      }
      currentData = data;
      addTabHistory(tab || '(tab แรก)');
      onDataLoaded();
      setStatus(`ดึงข้อมูลสำเร็จ — ${data.rows.length} แถว, ${data.columns.length} คอลัมน์`, 'success');
    } catch (e) {
      setStatus(e.message, 'error');
    } finally {
      fetchDataBtn.disabled = false;
      fetchDataBtn.textContent = 'ดึงข้อมูล';
    }
  }

  function onDataLoaded() {
    const colNames = currentData.columns.map((c) => c.label);

    // แนะนำกราฟ
    lastReco = Recommend.suggest(currentData.columns, currentData.rows);
    recoBox.hidden = false;
    recoText.textContent = lastReco.reason;

    // ตั้งค่าเริ่มต้นตามคำแนะนำ
    chartType.value = lastReco.type;
    fillSelect(labelCol, colNames, lastReco.labelCol || colNames[0]);
    const selected = new Set(lastReco.valueCols.length ? lastReco.valueCols : []);
    fillChecklist(valueCols, colNames, selected);
    chartTitle.value = tabName.value.trim() || 'กราฟใหม่';

    chartPanel.hidden = false;
    dashMeta.textContent = `แหล่งข้อมูล: ${currentData.rows.length} แถว · Tab: ${tabName.value.trim() || 'tab แรก'}`;
    renderPreview();
  }

  function renderPreview() {
    const cols = currentData.columns;
    const rows = currentData.rows;
    previewMeta.textContent = `${rows.length} แถว × ${cols.length} คอลัมน์ · Tab: ${tabName.value.trim() || 'tab แรก'}`;

    const head = '<tr>' + cols.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('') + '</tr>';
    const body = rows.slice(0, 5).map((r) =>
      '<tr>' + cols.map((c) => `<td>${escapeHtml(formatLabel(r[c.label]))}</td>`).join('') + '</tr>'
    ).join('');
    previewTable.innerHTML = head + body;
    previewBox.hidden = false;
  }

  function escapeHtml(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function applyReco() {
    if (!lastReco) return;
    chartType.value = lastReco.type;
    const colNames = currentData.columns.map((c) => c.label);
    fillSelect(labelCol, colNames, lastReco.labelCol || colNames[0]);
    fillChecklist(valueCols, colNames, new Set(lastReco.valueCols));
  }

  // ---------- สร้างกราฟบน Dashboard ----------
  function renderChart() {
    if (!currentData) return;
    const type = chartType.value;
    const xCol = labelCol.value;
    const yCols = getCheckedValues(valueCols);

    if (!yCols.length) {
      setStatus('เลือกอย่างน้อย 1 ค่า (Values) ที่จะแสดง', 'error');
      return;
    }

    const rows = currentData.rows;
    const labels = rows.map((r) => formatLabel(r[xCol]));

    let datasets;
    if (type === 'scatter') {
      datasets = yCols.map((yc, i) => ({
        label: yc,
        data: rows.map((r) => ({ x: toNumber(r[xCol]), y: toNumber(r[yc]) })),
        backgroundColor: PALETTE[i % PALETTE.length],
      }));
    } else if (type === 'pie' || type === 'doughnut' || type === 'polarArea') {
      // กราฟสัดส่วน ใช้ค่าชุดแรก
      const yc = yCols[0];
      datasets = [{
        label: yc,
        data: rows.map((r) => toNumber(r[yc])),
        backgroundColor: rows.map((_, i) => PALETTE[i % PALETTE.length]),
        borderColor: '#1c2029',
        borderWidth: 2,
      }];
    } else {
      datasets = yCols.map((yc, i) => ({
        label: yc,
        data: rows.map((r) => toNumber(r[yc])),
        backgroundColor: hexToRgba(PALETTE[i % PALETTE.length], type === 'line' ? 0.15 : 0.8),
        borderColor: PALETTE[i % PALETTE.length],
        borderWidth: 2,
        fill: type === 'line',
        tension: 0.3,
        pointRadius: type === 'line' ? 3 : 0,
      }));
    }

    const title = chartTitle.value.trim() || 'กราฟ';
    createCard(title, { type, labels, datasets });
    setStatus('เพิ่มกราฟลง Dashboard แล้ว', 'success');
  }

  function createCard(title, config) {
    emptyState.hidden = true;
    const id = 'card-' + ++cardCounter;

    const card = document.createElement('div');
    card.className = 'card';
    card.id = id;
    card.innerHTML = `
      <div class="card-head">
        <h3></h3>
        <button class="card-remove" title="ลบกราฟ">×</button>
      </div>
      <div class="card-canvas-wrap"><canvas></canvas></div>
    `;
    card.querySelector('h3').textContent = title;
    cards.appendChild(card);

    const canvas = card.querySelector('canvas');
    const isCircular = ['pie', 'doughnut', 'polarArea', 'radar'].includes(config.type);

    const chart = new Chart(canvas.getContext('2d'), {
      type: config.type,
      data: { labels: config.labels, datasets: config.datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: config.datasets.length > 1 || isCircular,
            labels: { color: '#e6e8ee', boxWidth: 14 },
          },
        },
        scales: isCircular ? {} : {
          x: { ticks: { color: '#9aa2b1' }, grid: { color: '#2c313d' } },
          y: { ticks: { color: '#9aa2b1' }, grid: { color: '#2c313d' } },
        },
      },
    });
    charts.set(id, chart);

    card.querySelector('.card-remove').addEventListener('click', () => {
      chart.destroy();
      charts.delete(id);
      card.remove();
      if (!charts.size) emptyState.hidden = false;
    });
  }

  // ---------- utils ----------
  function toNumber(v) {
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'number') return v;
    if (v === null || v === undefined || v === '') return null;
    const n = parseFloat(String(v).replace(/,/g, ''));
    return isNaN(n) ? null : n;
  }

  function formatLabel(v) {
    if (v instanceof Date) {
      return v.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
    }
    return v === null || v === undefined ? '' : String(v);
  }

  function hexToRgba(hex, alpha) {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // ---------- events ----------
  fetchDataBtn.addEventListener('click', fetchData);
  renderBtn.addEventListener('click', renderChart);
  applyRecoBtn.addEventListener('click', applyReco);
  sheetUrl.addEventListener('keydown', (e) => { if (e.key === 'Enter') fetchData(); });
  tabName.addEventListener('keydown', (e) => { if (e.key === 'Enter') fetchData(); });
})();
