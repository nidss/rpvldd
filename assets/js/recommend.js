/* recommend.js — วิเคราะห์ข้อมูลแล้วแนะนำประเภทกราฟที่เหมาะสม */

const Recommend = (() => {
  /** จัดหมวดคอลัมน์: number, date, category */
  function classify(columns, rows) {
    return columns.map((col) => {
      const values = rows.map((r) => r[col.label]).filter((v) => v !== null && v !== undefined && v !== '');
      const uniqueCount = new Set(values.map((v) => (v instanceof Date ? v.getTime() : v))).size;

      let kind;
      if (col.type === 'number') kind = 'number';
      else if (col.type === 'date' || col.type === 'datetime') kind = 'date';
      else kind = 'category';

      return {
        ...col,
        kind,
        uniqueCount,
        count: values.length,
      };
    });
  }

  /**
   * แนะนำการตั้งค่ากราฟจากโครงสร้างข้อมูล
   * คืนค่า { type, labelCol, valueCols, reason }
   */
  function suggest(columns, rows) {
    const cols = classify(columns, rows);
    const numbers = cols.filter((c) => c.kind === 'number');
    const dates = cols.filter((c) => c.kind === 'date');
    const categories = cols.filter((c) => c.kind === 'category');

    // ไม่มีคอลัมน์ตัวเลข — แนะนำ bar แบบนับจำนวน (แต่เราต้องมีค่าตัวเลข)
    if (numbers.length === 0) {
      const label = categories[0] || cols[0];
      return {
        type: 'bar',
        labelCol: label ? label.label : null,
        valueCols: [],
        reason: 'ไม่พบคอลัมน์ตัวเลข ลองเลือกค่าที่จะแสดงเอง หรือปรับข้อมูลใน Sheet',
      };
    }

    // 1) มีคอลัมน์วันที่ → อนุกรมเวลา → Line
    if (dates.length >= 1) {
      return {
        type: 'line',
        labelCol: dates[0].label,
        valueCols: numbers.slice(0, 3).map((c) => c.label),
        reason: `พบคอลัมน์วันที่ "${dates[0].label}" — เหมาะกับกราฟเส้น (Line) เพื่อดูแนวโน้มตามเวลา`,
      };
    }

    // 2) มีหมวดหมู่ + ตัวเลข
    if (categories.length >= 1) {
      const cat = categories.reduce((a, b) => (a.uniqueCount <= b.uniqueCount ? a : b));

      // หมวดหมู่น้อย + ตัวเลขเดียว → สัดส่วน → Pie/Doughnut
      if (cat.uniqueCount <= 6 && numbers.length === 1) {
        return {
          type: 'doughnut',
          labelCol: cat.label,
          valueCols: [numbers[0].label],
          reason: `"${cat.label}" มี ${cat.uniqueCount} กลุ่ม และมีค่าตัวเลขเดียว — เหมาะกับกราฟสัดส่วน (Doughnut)`,
        };
      }

      // ทั่วไป → Bar
      return {
        type: 'bar',
        labelCol: cat.label,
        valueCols: numbers.slice(0, 3).map((c) => c.label),
        reason: `เปรียบเทียบค่าตามหมวด "${cat.label}" — เหมาะกับกราฟแท่ง (Bar)`,
      };
    }

    // 3) มีแต่ตัวเลขหลายคอลัมน์ → Scatter (ถ้า 2 คอลัมน์) ไม่งั้น Bar
    if (numbers.length >= 2) {
      return {
        type: 'scatter',
        labelCol: numbers[0].label,
        valueCols: [numbers[1].label],
        reason: `มีคอลัมน์ตัวเลขหลายคอลัมน์ — เหมาะกับกราฟกระจาย (Scatter) เพื่อดูความสัมพันธ์`,
      };
    }

    // fallback
    return {
      type: 'bar',
      labelCol: cols[0] ? cols[0].label : null,
      valueCols: numbers.slice(0, 1).map((c) => c.label),
      reason: 'แนะนำกราฟแท่ง (Bar) เป็นค่าเริ่มต้น',
    };
  }

  return { classify, suggest };
})();
