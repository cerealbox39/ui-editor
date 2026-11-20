(() => {
  'use strict';
  const orders = [
    ['NL-10432', 'Harbour & Pine', '2026-11-20', 'APAC', 'Pending', 3, 412.5],
    ['NL-10431', 'Mira Okafor', '2026-11-20', 'EMEA', 'Paid', 1, 89],
    ['NL-10430', 'Quayside Coffee', '2026-11-19', 'APAC', 'Shipped', 12, 1320],
    ['NL-10429', 'Tomás Reyes', '2026-11-19', 'AMER', 'Paid', 2, 158.4],
    ['NL-10428', 'Lumen Studio', '2026-11-19', 'EMEA', 'Shipped', 5, 640],
    ['NL-10427', 'Aiko Tanaka', '2026-11-18', 'APAC', 'Refunded', 1, 74.99],
    ['NL-10426', 'Fieldnote Books', '2026-11-18', 'AMER', 'Pending', 8, 952],
    ['NL-10425', 'Priya Raman', '2026-11-18', 'APAC', 'Paid', 2, 210],
    ['NL-10424', 'Brightwell Clinic', '2026-11-17', 'EMEA', 'Shipped', 20, 2480],
    ['NL-10423', 'Jonas Becker', '2026-11-17', 'EMEA', 'Paid', 1, 49.5],
    ['NL-10422', 'Saltmarsh Bakery', '2026-11-16', 'AMER', 'Pending', 6, 318],
    ['NL-10421', 'Chen Wei', '2026-11-16', 'APAC', 'Shipped', 3, 267.3],
    ['NL-10420', 'Oakridge Outfitters', '2026-11-15', 'AMER', 'Paid', 9, 1104],
    ['NL-10419', 'Lena Novak', '2026-11-15', 'EMEA', 'Shipped', 2, 132],
    ['NL-10418', 'Coral Bay Resort', '2026-11-14', 'APAC', 'Paid', 4, -386],
  ];
  const money = value => (value < 0 ? '−$' : '$') + Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const body = document.getElementById('orders'), foot = document.getElementById('table-foot');
  const search = document.getElementById('search'), statusFilter = document.getElementById('status-filter');

  const render = () => {
    const q = search.value.trim().toLowerCase(), status = statusFilter.value;
    const rows = orders.filter(([id, customer, , , s]) => (!status || s === status) && (!q || `${id} ${customer}`.toLowerCase().includes(q)));
    body.replaceChildren(...rows.map(([id, customer, date, region, s, items, total]) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td class="mono"></td><td></td><td></td><td></td><td><span class="pill"></span></td><td class="num"></td><td class="num mono"></td>`;
      const cells = tr.children;
      tr.dataset.testid = `order-${id}`;
      ['id', 'customer', 'date', 'region', 'status', 'items', 'total'].forEach((field, i) => { cells[i].dataset.testid = `order-${id}-${field}`; });
      cells[4].firstChild.dataset.testid = `order-${id}-status-pill`;
      cells[0].textContent = id; cells[1].textContent = customer;
      cells[2].textContent = new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      cells[3].textContent = region; cells[4].firstChild.textContent = s; cells[4].firstChild.dataset.status = s.toLowerCase();
      cells[5].textContent = items; cells[6].textContent = money(total);
      return tr;
    }));
    if (!rows.length) body.innerHTML = '<tr><td colspan="7" class="empty">No orders match these filters.</td></tr>';
    foot.textContent = `Showing ${rows.length} of ${orders.length} orders`;
  };
  search.addEventListener('input', render); statusFilter.addEventListener('change', render); render();

  const revenue = [9.8, 11.2, 10.4, 13.1, 12.6, 8.9, 7.4, 12.2, 14.8, 13.9, 15.6, 16.2, 12.1, 17.4];
  const svg = document.getElementById('chart'), max = Math.max(...revenue), w = 560 / revenue.length;
  svg.innerHTML = revenue.map((v, i) => {
    const h = (v / max) * 150;
    return `<rect x="${i * w + 6}" y="${170 - h}" width="${w - 12}" height="${h}" rx="3"><title>Nov ${7 + i}: $${v.toFixed(1)}k</title></rect>`;
  }).join('') + '<line x1="0" y1="170.5" x2="560" y2="170.5"/>';

  const products = [['Linen tote', 412], ['Ceramic mug', 356], ['Field notebook', 298], ['Wool throw', 187], ['Desk lamp', 142]];
  document.getElementById('top-products').innerHTML = products.map(([name, units]) =>
    `<li><span>${name}</span><span class="mono">${units}</span><i style="width:${(units / products[0][1]) * 100}%"></i></li>`).join('');

  const intro = document.getElementById('intro');
  try { if (localStorage.getItem('demo:intro-hidden')) intro.hidden = true; } catch (_) {}
  document.getElementById('dismiss-intro').addEventListener('click', () => {
    intro.hidden = true;
    try { localStorage.setItem('demo:intro-hidden', '1'); } catch (_) {}
  });
})();
