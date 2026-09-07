// ============================================
// CONFIG — Supabase
// ============================================
const SUPABASE_URL = "https://koepcdgnwqyovshhbigv.supabase.co";
const SUPABASE_KEY = "sb_publishable_fNzGT4FQjjaNwoCmYWZSig_6sSWSLVk";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const ROMAN_MONTHS = ["I","II","III","IV","V","VI","VII","VIII","IX","X","XI","XII"];

// ============================================
// STATE
// ============================================
let dormitories = [];
let invoices = [];

// ============================================
// UTIL
// ============================================
function toast(msg, isError=false){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.toggle('error', isError);
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 2600);
}

function formatRupiah(n){
  n = Number(n)||0;
  return "Rp" + n.toLocaleString('id-ID');
}

function formatDateLong(dateStr){
  const d = new Date(dateStr + "T00:00:00");
  const days = ["Minggu","Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"];
  const months = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
  return `${days[d.getDay()]}, ${d.getDate().toString().padStart(2,'0')} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function nightsBetween(inStr, outStr){
  if(!inStr || !outStr) return 0;
  const d1 = new Date(inStr + "T00:00:00");
  const d2 = new Date(outStr + "T00:00:00");
  const diff = Math.round((d2 - d1) / (1000*60*60*24));
  return diff > 0 ? diff : 0;
}

// ============================================
// TAB NAVIGATION
// ============================================
document.querySelectorAll('.tab-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.view).classList.add('active');
    if(btn.dataset.view === 'historyView') loadHistory();
    if(btn.dataset.view === 'adminView') renderAdminDorms();
  });
});

// ============================================
// LOAD MASTER DATA
// ============================================
async function loadMasterData(){
  const { data, error } = await sb.from('dormitories').select('*').order('name');
  if(error){ toast('Gagal memuat dormitory: '+error.message, true); return; }
  dormitories = data;
  populateDormSelect();
}

function populateDormSelect(){
  const sel = document.getElementById('selDorm');
  sel.innerHTML = '<option value="">Pilih dormitory...</option>';
  dormitories.forEach(d=>{
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = d.name;
    sel.appendChild(opt);
  });
}

// ============================================
// FORM ELEMENTS (Create Invoice)
// ============================================
const selDorm = document.getElementById('selDorm');
const selFloor = document.getElementById('selFloor');
const roomInput = document.getElementById('roomInput');

// ============================================
// DATE & PRICE CALCULATION
// ============================================
const checkInEl = document.getElementById('checkIn');
const checkOutEl = document.getElementById('checkOut');
const priceEl = document.getElementById('pricePerNight');
const nightsOut = document.getElementById('nightsOut');
const totalOut = document.getElementById('totalOut');

function recalc(){
  const nights = nightsBetween(checkInEl.value, checkOutEl.value);
  nightsOut.textContent = nights > 0 ? (nights + " malam") : "—";
  const price = Number(priceEl.value) || 0;
  const total = nights * price;
  totalOut.textContent = formatRupiah(total);
}
checkInEl.addEventListener('change', recalc);
checkOutEl.addEventListener('change', recalc);
priceEl.addEventListener('input', recalc);

// ============================================
// INVOICE NUMBER GENERATION (monthly reset)
// ============================================
async function getNextInvoiceNumber(dateForInvoice){
  const d = new Date(dateForInvoice + "T00:00:00");
  const year = d.getFullYear();
  const month = d.getMonth() + 1; // 1-12

  // Try to fetch existing counter
  const { data: existing, error: fetchErr } = await sb
    .from('invoice_counters')
    .select('*')
    .eq('year', year)
    .eq('month', month)
    .maybeSingle();

  if(fetchErr){ throw new Error('Gagal cek nomor invoice: ' + fetchErr.message); }

  let nextNumber;
  if(existing){
    nextNumber = existing.last_number + 1;
    const { error: updateErr } = await sb
      .from('invoice_counters')
      .update({ last_number: nextNumber })
      .eq('id', existing.id);
    if(updateErr){ throw new Error('Gagal update nomor invoice: ' + updateErr.message); }
  } else {
    nextNumber = 1;
    const { error: insertErr } = await sb
      .from('invoice_counters')
      .insert({ year, month, last_number: nextNumber });
    if(insertErr){ throw new Error('Gagal buat nomor invoice: ' + insertErr.message); }
  }

  const numStr = String(nextNumber).padStart(3, '0');
  const roman = ROMAN_MONTHS[month - 1];
  return `${numStr}/RC-P/${roman}/${year}`;
}

// ============================================
// GENERATE INVOICE
// ============================================
document.getElementById('btnGenerate').addEventListener('click', async ()=>{
  const guestName = document.getElementById('guestName').value.trim();
  const dormId = selDorm.value;
  const floorName = selFloor.value;
  const roomNumber = roomInput.value.trim();
  const checkIn = checkInEl.value;
  const checkOut = checkOutEl.value;
  const price = Number(priceEl.value) || 0;
  const dp = Number(document.getElementById('downPayment').value) || 0;
  const notes = document.getElementById('notes').value.trim();

  if(!guestName){ toast('Nama tamu wajib diisi', true); return; }
  if(!dormId){ toast('Pilih dormitory', true); return; }
  if(!floorName){ toast('Pilih lantai', true); return; }
  if(!roomNumber){ toast('Isi nomor kamar', true); return; }
  if(!checkIn || !checkOut){ toast('Isi tanggal check-in dan check-out', true); return; }
  const nights = nightsBetween(checkIn, checkOut);
  if(nights <= 0){ toast('Check-out harus setelah check-in', true); return; }
  if(price <= 0){ toast('Isi harga per malam', true); return; }

  const btn = document.getElementById('btnGenerate');
  btn.disabled = true;
  btn.textContent = 'Memproses...';

  try{
    const dormName = dormitories.find(d=>d.id===dormId)?.name || '';
    const total = nights * price;

    const invoiceNumber = await getNextInvoiceNumber(checkIn);

    const { data: inserted, error: insertErr } = await sb.from('invoices').insert({
      invoice_number: invoiceNumber,
      guest_name: guestName,
      dormitory_name: dormName,
      floor_name: floorName,
      room_number: roomNumber,
      check_in: checkIn,
      check_out: checkOut,
      nights: nights,
      price_per_night: price,
      total: total,
      down_payment: dp,
      notes: notes
    }).select().single();

    if(insertErr){ throw new Error(insertErr.message); }

    renderInvoiceSheet(inserted);
    document.getElementById('invoiceModal').classList.add('show');
    toast('Invoice ' + invoiceNumber + ' berhasil dibuat');
  }catch(e){
    toast('Gagal membuat invoice: ' + e.message, true);
  }finally{
    btn.disabled = false;
    btn.textContent = 'Generate Invoice';
  }
});

document.getElementById('btnResetForm').addEventListener('click', ()=>{
  document.getElementById('guestName').value = '';
  selDorm.value = '';
  selFloor.value = '';
  roomInput.value = '';
  checkInEl.value = '';
  checkOutEl.value = '';
  priceEl.value = '';
  document.getElementById('downPayment').value = '';
  document.getElementById('notes').value = '';
  recalc();
});

// ============================================
// RENDER INVOICE SHEET (used for both new + reprint)
// ============================================
function renderInvoiceSheet(inv){
  const sheet = document.getElementById('invoiceSheet');
  const dpAmount = Number(inv.down_payment) || 0;
  const total = Number(inv.total) || 0;
  const isPaid = dpAmount >= total && total > 0;
  const statusBadge = isPaid
    ? '<span class="badge-status badge-paid">LUNAS</span>'
    : (dpAmount > 0 ? '<span class="badge-status badge-dp">DP DITERIMA</span>' : '');

  sheet.innerHTML = `
    <div class="inv-head">
      <img src="logo-rifa.jpg" alt="logo">
      <div>
        <h1>RIFA CORPORATION</h1>
        <p>Jalan Muhammad No.8, Pamoyanan, Cicendo, Kota Bandung</p>
        <p>Phone: 0822-9897-0998</p>
      </div>
    </div>
    <div class="inv-title">Invoice</div>
    <div class="inv-title-rule"></div>

    <div class="inv-meta">
      <div>
        <label>Invoice #</label>
        <p>${inv.invoice_number}</p>
      </div>
      <div>
        <label>Dormitory</label>
        <p>${inv.dormitory_name}</p>
      </div>
      <div>
        <label>Check-In</label>
        <p>${formatDateLong(inv.check_in)}</p>
      </div>
      <div>
        <label>Invoice untuk</label>
        <p>${inv.guest_name}</p>
      </div>
      <div>
        <label>Kamar</label>
        <p>${inv.floor_name}<br>Kamar ${inv.room_number}</p>
      </div>
      <div>
        <label>Check-Out</label>
        <p>${formatDateLong(inv.check_out)}</p>
      </div>
    </div>

    <table class="inv-table">
      <thead>
        <tr>
          <th>Deskripsi</th>
          <th class="ta-c">Qty</th>
          <th class="ta-r">Harga Satuan</th>
          <th class="ta-r">Total</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Penginapan Harian</td>
          <td class="ta-c">1 Kamar x ${inv.nights} Malam</td>
          <td class="ta-r">${formatRupiah(inv.price_per_night)}</td>
          <td class="ta-r">${formatRupiah(total)}</td>
        </tr>
        <tr class="inv-total-row">
          <td colspan="3" class="ta-r">TOTAL</td>
          <td class="ta-r">${formatRupiah(total)}</td>
        </tr>
      </tbody>
    </table>

    ${inv.notes ? `<p style="font-family:'Helvetica Neue',Arial,sans-serif;font-size:12.5px;color:#8a7a7a;">Catatan: ${inv.notes}</p>` : ''}

    <div class="inv-bottom">
      <div class="pay-box">
        <h3>Pembayaran dapat dilakukan melalui:</h3>
        <div class="pay-methods">
          <div class="pay-method">
            <p class="bank-name">Bank BNI</p>
            <p>an. Ai Mardhiyah</p>
            <p>0725520787</p>
          </div>
          <div class="pay-method">
            <p class="bank-name">QRIS</p>
            <img src="qris-rifa.jpeg" alt="QRIS">
          </div>
        </div>
      </div>
      <div class="dp-box">
        <label>DP / Terbayar</label>
        <div class="amt">${formatRupiah(dpAmount)}</div>
        <div style="margin-top:8px;">${statusBadge}</div>
      </div>
    </div>

    <div class="sign-area">
      <p>Best Regards,<br>Owner CV. Rifa Corporation</p>
      <img src="signature-ai-mardhiyah.png" alt="Tanda tangan" style="height:60px; margin-top:20px; display:block;">
      <div class="sig-name" style="margin-top:6px;">Hj. Ai Mardhiyah, SKp.,Mkes, Ph.D</div>
    </div>
  `;
}

document.getElementById('btnCloseModal').addEventListener('click', ()=>{
  document.getElementById('invoiceModal').classList.remove('show');
});

document.getElementById('btnPrintInvoice').addEventListener('click', ()=>{
  window.print();
});

document.getElementById('btnDownloadPdf').addEventListener('click', async ()=>{
  const sheet = document.getElementById('invoiceSheet');
  const btn = document.getElementById('btnDownloadPdf');
  btn.disabled = true;
  btn.textContent = 'Membuat PDF...';
  try{
    const canvas = await html2canvas(sheet, { scale: 2, backgroundColor: '#ffffff' });
    const imgData = canvas.toDataURL('image/png');
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageWidth = pdf.internal.pageSize.getWidth();
    const imgWidth = pageWidth - 20;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    pdf.addImage(imgData, 'PNG', 10, 10, imgWidth, imgHeight);
    pdf.save('invoice-rifa.pdf');
  }catch(e){
    toast('Gagal membuat PDF: ' + e.message, true);
  }finally{
    btn.disabled = false;
    btn.textContent = 'Download PDF';
  }
});

// ============================================
// HISTORY VIEW
// ============================================
async function loadHistory(){
  const wrap = document.getElementById('histTableWrap');
  wrap.innerHTML = '<div class="empty-state">Memuat riwayat...</div>';
  const { data, error } = await sb.from('invoices').select('*').order('created_at', { ascending: false });
  if(error){
    wrap.innerHTML = '<div class="empty-state">Gagal memuat riwayat: ' + error.message + '</div>';
    return;
  }
  invoices = data;
  renderHistoryTable(invoices);
}

function renderHistoryTable(list){
  const wrap = document.getElementById('histTableWrap');
  if(list.length === 0){
    wrap.innerHTML = '<div class="empty-state">Belum ada invoice yang dibuat.</div>';
    return;
  }
  let rows = list.map(inv => `
    <tr data-id="${inv.id}">
      <td>${inv.invoice_number}</td>
      <td>${inv.guest_name}</td>
      <td>${inv.dormitory_name} — ${inv.floor_name}, Kamar ${inv.room_number}</td>
      <td>${formatDateLong(inv.check_in)}</td>
      <td>${formatDateLong(inv.check_out)}</td>
      <td class="ta-r">${formatRupiah(inv.total)}</td>
      <td class="ta-c no-print">
        <button class="btn-outline btn-sm" data-action="edit" data-id="${inv.id}" style="margin-right:6px;">Edit</button>
        <button class="btn-danger" data-action="delete" data-id="${inv.id}">Hapus</button>
      </td>
    </tr>
  `).join('');
  wrap.innerHTML = `
    <table class="hist-table">
      <thead>
        <tr>
          <th>No. Invoice</th>
          <th>Tamu</th>
          <th>Kamar</th>
          <th>Check-In</th>
          <th>Check-Out</th>
          <th class="ta-r">Total</th>
          <th class="no-print">Aksi</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
  wrap.querySelectorAll('[data-action="edit"]').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      e.stopPropagation();
      const inv = invoices.find(i=>i.id === btn.dataset.id);
      if(inv) openEditModal(inv);
    });
  });
  wrap.querySelectorAll('[data-action="delete"]').forEach(btn=>{
    btn.addEventListener('click', async (e)=>{
      e.stopPropagation();
      const inv = invoices.find(i=>i.id === btn.dataset.id);
      if(!confirm(`Hapus invoice ${inv?.invoice_number} atas nama ${inv?.guest_name}? Tindakan ini tidak bisa dibatalkan.`)) return;
      const { error } = await sb.from('invoices').delete().eq('id', btn.dataset.id);
      if(error){ toast('Gagal menghapus: ' + error.message, true); return; }
      toast('Invoice dihapus');
      loadHistory();
    });
  });
  wrap.querySelectorAll('tbody tr').forEach(tr=>{
    tr.addEventListener('click', (e)=>{
      if(e.target.dataset.action) return;
      const inv = invoices.find(i=>i.id === tr.dataset.id);
      if(inv){
        renderInvoiceSheet(inv);
        document.getElementById('invoiceModal').classList.add('show');
      }
    });
  });
}

document.getElementById('searchHist').addEventListener('input', (e)=>{
  const q = e.target.value.toLowerCase().trim();
  if(!q){ renderHistoryTable(invoices); return; }
  const filtered = invoices.filter(inv =>
    inv.guest_name.toLowerCase().includes(q) ||
    inv.invoice_number.toLowerCase().includes(q)
  );
  renderHistoryTable(filtered);
});

// ============================================
// ADMIN VIEW — Dormitories CRUD
// ============================================
function renderAdminDorms(){
  const listEl = document.getElementById('listDorm');
  if(dormitories.length === 0){
    listEl.innerHTML = '<div class="list-empty">Belum ada dormitory</div>';
  } else {
    listEl.innerHTML = dormitories.map(d => `
      <div class="list-item" data-id="${d.id}">
        <span>${d.name}</span>
        <button class="btn-danger" data-action="delete-dorm" data-id="${d.id}">Hapus</button>
      </div>
    `).join('');
  }
  listEl.querySelectorAll('[data-action="delete-dorm"]').forEach(btn=>{
    btn.addEventListener('click', async (e)=>{
      e.stopPropagation();
      if(!confirm('Hapus dormitory ini?')) return;
      const { error } = await sb.from('dormitories').delete().eq('id', btn.dataset.id);
      if(error){ toast('Gagal menghapus: ' + error.message, true); return; }
      await loadMasterData();
      renderAdminDorms();
      toast('Dormitory dihapus');
    });
  });
}

document.getElementById('btnAddDorm').addEventListener('click', async ()=>{
  const input = document.getElementById('newDormName');
  const name = input.value.trim();
  if(!name){ toast('Isi nama dormitory', true); return; }
  const { error } = await sb.from('dormitories').insert({ name });
  if(error){ toast('Gagal menambah: ' + error.message, true); return; }
  input.value = '';
  await loadMasterData();
  renderAdminDorms();
  toast('Dormitory ditambahkan');
});

// ============================================
// EDIT INVOICE MODAL
// ============================================
let editingInvoiceId = null;

function openEditModal(inv){
  editingInvoiceId = inv.id;
  document.getElementById('editGuestName').value = inv.guest_name;
  document.getElementById('editDormName').value = inv.dormitory_name;
  document.getElementById('editFloorName').value = inv.floor_name;
  document.getElementById('editRoomNumber').value = inv.room_number;
  document.getElementById('editCheckIn').value = inv.check_in;
  document.getElementById('editCheckOut').value = inv.check_out;
  document.getElementById('editPrice').value = inv.price_per_night;
  document.getElementById('editDp').value = inv.down_payment || 0;
  document.getElementById('editNotes').value = inv.notes || '';
  recalcEdit();
  document.getElementById('editModal').classList.add('show');
}

function recalcEdit(){
  const nights = nightsBetween(document.getElementById('editCheckIn').value, document.getElementById('editCheckOut').value);
  document.getElementById('editNightsOut').textContent = nights > 0 ? (nights + " malam") : "—";
  const price = Number(document.getElementById('editPrice').value) || 0;
  document.getElementById('editTotalOut').textContent = formatRupiah(nights * price);
}
document.getElementById('editCheckIn').addEventListener('change', recalcEdit);
document.getElementById('editCheckOut').addEventListener('change', recalcEdit);
document.getElementById('editPrice').addEventListener('input', recalcEdit);

document.getElementById('btnCloseEditModal').addEventListener('click', ()=>{
  document.getElementById('editModal').classList.remove('show');
  editingInvoiceId = null;
});

document.getElementById('btnSaveEdit').addEventListener('click', async ()=>{
  if(!editingInvoiceId) return;
  const guestName = document.getElementById('editGuestName').value.trim();
  const dormName = document.getElementById('editDormName').value.trim();
  const floorName = document.getElementById('editFloorName').value.trim();
  const roomNumber = document.getElementById('editRoomNumber').value.trim();
  const checkIn = document.getElementById('editCheckIn').value;
  const checkOut = document.getElementById('editCheckOut').value;
  const price = Number(document.getElementById('editPrice').value) || 0;
  const dp = Number(document.getElementById('editDp').value) || 0;
  const notes = document.getElementById('editNotes').value.trim();

  if(!guestName || !dormName || !floorName || !roomNumber){ toast('Semua data wajib diisi', true); return; }
  const nights = nightsBetween(checkIn, checkOut);
  if(nights <= 0){ toast('Check-out harus setelah check-in', true); return; }
  if(price <= 0){ toast('Isi harga per malam', true); return; }

  const btn = document.getElementById('btnSaveEdit');
  btn.disabled = true;
  btn.textContent = 'Menyimpan...';

  const total = nights * price;
  const { error } = await sb.from('invoices').update({
    guest_name: guestName,
    dormitory_name: dormName,
    floor_name: floorName,
    room_number: roomNumber,
    check_in: checkIn,
    check_out: checkOut,
    nights: nights,
    price_per_night: price,
    total: total,
    down_payment: dp,
    notes: notes
  }).eq('id', editingInvoiceId);

  btn.disabled = false;
  btn.textContent = 'Simpan Perubahan';

  if(error){ toast('Gagal menyimpan: ' + error.message, true); return; }

  toast('Invoice berhasil diupdate');
  document.getElementById('editModal').classList.remove('show');
  editingInvoiceId = null;
  loadHistory();
});

// ============================================
// INIT
// ============================================
loadMasterData();
