/**
 * =========================================================================
 * GOOGLE APPS SCRIPT: PUSAT DATABASE DUA ARAH (TWO-WAY SYNC)
 * Sistem Manajemen Invoice & Piutang
 * =========================================================================
 * 
 * CARA PEMASANGAN DI GOOGLE SPREADSHEETS:
 * 1. Buka spreadsheet Anda: https://docs.google.com/spreadsheets/d/1NDsUjM1mr9zFlbexXJZCBzfsnV98aGUJcA-TiMpHJSE/edit?gid=68689000#gid=68689000
 * 2. Di menu atas, klik: Extensions (Ekstensi) -> Apps Script
 * 3. Hapus semua teks yang ada di editor, lalu paste SELURUH isi file ini.
 * 4. Klik tombol "Save" (ikon disket) atau Ctrl + S.
 * 5. Klik tombol biru "Deploy" (di kanan atas) -> Pilih "New deployment".
 * 6. Klik ikon roda gigi (Settings) di samping "Select type" -> Pilih "Web app".
 * 7. Isi konfigurasi:
 *    - Description: Web App Invoice Hub API
 *    - Execute as: Me (email Anda)
 *    - Who has access: Anyone (Siapa saja - penting agar web app bisa membaca/menyimpan)
 * 8. Klik tombol "Deploy". Jika muncul permintaan izin ("Authorize access"), klik "Review permissions" -> pilih akun Google Anda -> klik "Advanced" -> klik "Go to ... (unsafe)" -> klik "Allow".
 * 9. Salin (Copy) "Web app URL" yang muncul (berakhiran /exec).
 * 10. Tempelkan URL tersebut ke dalam Web App Anda pada menu "Hubungkan Google Sheets".
 * =========================================================================
 */

// Nama sheet atau gunakan sheet aktif
function getTargetSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  // Coba cari tab yang sesuai atau tab pertama
  return ss.getActiveSheet();
}

// 1. GET: Mengambil seluruh data invoice dari Spreadsheet
function doGet(e) {
  try {
    const sheet = getTargetSheet();
    ensureHeaderColumns(sheet);

    const values = sheet.getDataRange().getValues();
    if (!values || values.length <= 1) {
      return jsonResponse({ status: "success", data: [] });
    }

    const headers = values[0].map(h => String(h).trim());
    const rows = values.slice(1);

    const data = rows.map((row, idx) => {
      let item = { id: idx + 1 };
      headers.forEach((header, colIdx) => {
        item[header] = row[colIdx];
      });

      // Sanitasi angka saldo
      let saldo = 0;
      if (item["Saldo Konversi"] !== undefined) {
        let sStr = String(item["Saldo Konversi"]).replace(/[^\d.]/g, '');
        saldo = parseFloat(sStr) || 0;
      }

      // Hitung Day (Invoice) dan Status Jatuh Tempo otomatis
      let day = parseInt(item["Day (Invoice)"], 10) || 0;
      let statusJT = day > 30 ? "Jatuh Tempo" : "Belum Jatuh Tempo";

      // Status Pembayaran & Keterangan
      let statusBayar = item["Status Pembayaran"] ? String(item["Status Pembayaran"]).trim() : "Belum Bayar";
      let ket = item["Keterangan"] ? String(item["Keterangan"]).trim() : (statusBayar === "Sudah Bayar" ? "Sudah Bayar" : "Belum Bayar");

      return {
        id: idx + 1,
        rowNumber: idx + 2, // Baris di Excel (1-based, setelah header)
        noInvoice: sanitizeClean(item["No. Invoice"]),
        tanggal: formatDateCell(item["Tanggal"]),
        customer: sanitizeClean(item["Customer"]),
        pelanggan: sanitizeClean(item["Pelanggan"]),
        portofolio: sanitizeClean(item["Portofolio"]) || "Lainnya",
        kegiatan: sanitizeClean(item["Kegiatan"]),
        orderNumber: sanitizeClean(item["Order Number"]),
        saldoKonversi: saldo,
        dayInvoice: day,
        statusJatuhTempo: statusJT,
        pembayaranVia: sanitizeClean(item["Pembayaran Via"]),
        statusPembayaran: statusBayar,
        nominalPelunasan: parseFloat(item["Nominal Pelunasan"]) || (statusBayar === "Sudah Bayar" ? saldo : 0),
        tanggalPelunasan: formatDateCell(item["Tanggal Pelunasan"]),
        keterangan: ket
      };
    }).filter(i => i.noInvoice || i.customer);

    return jsonResponse({
      status: "success",
      total: data.length,
      updatedAt: new Date().toISOString(),
      data: data
    });

  } catch (err) {
    return jsonResponse({ status: "error", message: err.toString() });
  }
}

// 2. POST: Menyimpan / Update data dari Web App ke Spreadsheet
function doPost(e) {
  try {
    let payload = null;
    if (e && e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    } else {
      payload = e.parameter;
    }

    if (!payload || !payload.action) {
      return jsonResponse({ status: "error", message: "Parameter action tidak ditemukan" });
    }

    const sheet = getTargetSheet();
    ensureHeaderColumns(sheet);

    const action = payload.action;

    // Aksi 1: Update Pembayaran (Quick Pay atau Edit Pembayaran)
    if (action === "update_payment" || action === "update_invoice") {
      const invData = payload.data;
      const result = updateRowInSheet(sheet, invData);
      return jsonResponse({ status: "success", message: "Data invoice berhasil diperbarui di Google Sheets!", result: result });
    }

    // Aksi 2: Tambah Invoice Baru
    if (action === "add_invoice") {
      const newInv = payload.data;
      appendRowToSheet(sheet, newInv);
      return jsonResponse({ status: "success", message: "Invoice baru berhasil ditambahkan ke Google Sheets!" });
    }

    // Aksi 3: Hapus Invoice
    if (action === "delete_invoice") {
      const noInvoice = String(payload.noInvoice).trim();
      const deleted = deleteRowByInvoice(sheet, noInvoice);
      return jsonResponse({ status: "success", message: deleted ? "Invoice berhasil dihapus dari Google Sheets" : "Invoice tidak ditemukan" });
    }

    // Aksi 4: Batch Update (Tandai Lunas Massal / Set Metode Bayar)
    if (action === "batch_update") {
      const items = payload.items || [];
      items.forEach(item => updateRowInSheet(sheet, item));
      return jsonResponse({ status: "success", message: items.length + " invoice berhasil diperbarui secara massal!" });
    }

    return jsonResponse({ status: "error", message: "Aksi tidak dikenali: " + action });

  } catch (err) {
    return jsonResponse({ status: "error", message: err.toString() });
  }
}

// Helper: Memastikan 6 kolom tambahan otomatis dibuat di baris 1 spreadsheet jika belum ada
function ensureHeaderColumns(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
  
  const requiredHeaders = [
    "No. Invoice", "Tanggal", "Customer", "Pelanggan", "Portofolio", 
    "Kegiatan", "Order Number", "Saldo Konversi", "Day (Invoice)",
    "Status Jatuh Tempo", "Pembayaran Via", "Status Pembayaran", 
    "Nominal Pelunasan", "Tanggal Pelunasan", "Keterangan"
  ];

  requiredHeaders.forEach(req => {
    if (headers.indexOf(req) === -1) {
      const nextCol = sheet.getLastColumn() + 1;
      sheet.getRange(1, nextCol).setValue(req);
      sheet.getRange(1, nextCol).setFontWeight("bold").setBackground("#e2e8f0");
      headers.push(req);
    }
  });
}

// Helper: Cari baris berdasarkan No. Invoice dan update nilainya
function updateRowInSheet(sheet, inv) {
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(h => String(h).trim());

  const colIdx = {
    noInvoice: headers.indexOf("No. Invoice"),
    tanggal: headers.indexOf("Tanggal"),
    customer: headers.indexOf("Customer"),
    pelanggan: headers.indexOf("Pelanggan"),
    portofolio: headers.indexOf("Portofolio"),
    kegiatan: headers.indexOf("Kegiatan"),
    orderNumber: headers.indexOf("Order Number"),
    saldoKonversi: headers.indexOf("Saldo Konversi"),
    dayInvoice: headers.indexOf("Day (Invoice)"),
    statusJT: headers.indexOf("Status Jatuh Tempo"),
    pembayaranVia: headers.indexOf("Pembayaran Via"),
    statusBayar: headers.indexOf("Status Pembayaran"),
    nominalPelunasan: headers.indexOf("Nominal Pelunasan"),
    tanggalPelunasan: headers.indexOf("Tanggal Pelunasan"),
    keterangan: headers.indexOf("Keterangan")
  };

  const targetInvoice = sanitizeClean(inv.noInvoice);
  for (let r = 1; r < data.length; r++) {
    const currentInv = sanitizeClean(data[r][colIdx.noInvoice]);
    if (currentInv && currentInv.toLowerCase() === targetInvoice.toLowerCase()) {
      const rowNum = r + 1;

      if (inv.customer && colIdx.customer !== -1) sheet.getRange(rowNum, colIdx.customer + 1).setValue(inv.customer);
      if (inv.tanggal && colIdx.tanggal !== -1) sheet.getRange(rowNum, colIdx.tanggal + 1).setValue(inv.tanggal);
      if (inv.pelanggan && colIdx.pelanggan !== -1) sheet.getRange(rowNum, colIdx.pelanggan + 1).setValue(inv.pelanggan);
      if (inv.portofolio && colIdx.portofolio !== -1) sheet.getRange(rowNum, colIdx.portofolio + 1).setValue(inv.portofolio);
      if (inv.kegiatan && colIdx.kegiatan !== -1) sheet.getRange(rowNum, colIdx.kegiatan + 1).setValue(inv.kegiatan);
      if (inv.orderNumber && colIdx.orderNumber !== -1) sheet.getRange(rowNum, colIdx.orderNumber + 1).setValue(inv.orderNumber);
      if (inv.saldoKonversi !== undefined && colIdx.saldoKonversi !== -1) sheet.getRange(rowNum, colIdx.saldoKonversi + 1).setValue(inv.saldoKonversi);
      
      if (inv.dayInvoice !== undefined && colIdx.dayInvoice !== -1) {
        sheet.getRange(rowNum, colIdx.dayInvoice + 1).setValue(inv.dayInvoice);
        const jt = parseInt(inv.dayInvoice, 10) > 30 ? "Jatuh Tempo" : "Belum Jatuh Tempo";
        if (colIdx.statusJT !== -1) sheet.getRange(rowNum, colIdx.statusJT + 1).setValue(jt);
      }

      // Update Kolom Tambahan (User Request)
      if (inv.pembayaranVia !== undefined && colIdx.pembayaranVia !== -1) {
        sheet.getRange(rowNum, colIdx.pembayaranVia + 1).setValue(inv.pembayaranVia);
      }
      if (inv.statusPembayaran !== undefined && colIdx.statusBayar !== -1) {
        sheet.getRange(rowNum, colIdx.statusBayar + 1).setValue(inv.statusPembayaran);
      }
      if (inv.nominalPelunasan !== undefined && colIdx.nominalPelunasan !== -1) {
        sheet.getRange(rowNum, colIdx.nominalPelunasan + 1).setValue(inv.nominalPelunasan);
      }
      if (inv.tanggalPelunasan !== undefined && colIdx.tanggalPelunasan !== -1) {
        sheet.getRange(rowNum, colIdx.tanggalPelunasan + 1).setValue(inv.tanggalPelunasan);
      }
      if (inv.keterangan !== undefined && colIdx.keterangan !== -1) {
        sheet.getRange(rowNum, colIdx.keterangan + 1).setValue(inv.keterangan);
      }

      return { rowNumber: rowNum, noInvoice: targetInvoice, status: "updated" };
    }
  }

  return { status: "not_found" };
}

// Helper: Tambah baris baru ke paling bawah sheet
function appendRowToSheet(sheet, inv) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
  const newRow = new Array(headers.length).fill("");

  const setVal = (headerName, val) => {
    const idx = headers.indexOf(headerName);
    if (idx !== -1) newRow[idx] = val;
  };

  const day = parseInt(inv.dayInvoice, 10) || 0;
  const statusJT = day > 30 ? "Jatuh Tempo" : "Belum Jatuh Tempo";

  setVal("No. Invoice", inv.noInvoice || "");
  setVal("Tanggal", inv.tanggal || "");
  setVal("Customer", inv.customer || "");
  setVal("Pelanggan", inv.pelanggan || "");
  setVal("Portofolio", inv.portofolio || "");
  setVal("Kegiatan", inv.kegiatan || "");
  setVal("Order Number", inv.orderNumber || "");
  setVal("Saldo Konversi", inv.saldoKonversi || 0);
  setVal("Day (Invoice)", day);
  setVal("Status Jatuh Tempo", statusJT);
  setVal("Pembayaran Via", inv.pembayaranVia || "");
  setVal("Status Pembayaran", inv.statusPembayaran || "Belum Bayar");
  setVal("Nominal Pelunasan", inv.nominalPelunasan || 0);
  setVal("Tanggal Pelunasan", inv.tanggalPelunasan || "");
  setVal("Keterangan", inv.keterangan || "Belum Bayar");

  sheet.appendRow(newRow);
}

// Helper: Hapus baris berdasarkan nomor invoice
function deleteRowByInvoice(sheet, noInvoice) {
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(h => String(h).trim());
  const colInv = headers.indexOf("No. Invoice");
  if (colInv === -1) return false;

  const target = sanitizeClean(noInvoice);
  for (let r = 1; r < data.length; r++) {
    const current = sanitizeClean(data[r][colInv]);
    if (current && current.toLowerCase() === target.toLowerCase()) {
      sheet.deleteRow(r + 1);
      return true;
    }
  }
  return false;
}

// Helper: Format tanggal cell
function formatDateCell(cell) {
  if (!cell) return "";
  if (cell instanceof Date) {
    return Utilities.formatDate(cell, "GMT+7", "yyyy-MM-dd");
  }
  return String(cell).trim();
}

// Helper: Membersihkan invisible unicode karakter
function sanitizeClean(val) {
  if (val === null || val === undefined) return "";
  return String(val).replace(/[\u200E\u200F\u202A-\u202E]/g, '').trim();
}

// Response JSON pembantu dengan header CORS
function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
