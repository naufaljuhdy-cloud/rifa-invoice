-- Tambah kolom untuk menyimpan item biaya tambahan (breakfast, extra bed, dll)
-- Disimpan sebagai JSON array, contoh: [{"description":"Extra Bed","amount":50000}]
alter table invoices add column additional_items jsonb default '[]'::jsonb;
