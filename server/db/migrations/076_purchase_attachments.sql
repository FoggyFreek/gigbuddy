CREATE TABLE purchase_attachments (
  id                SERIAL PRIMARY KEY,
  purchase_id       INTEGER NOT NULL,
  tenant_id         INTEGER NOT NULL,
  object_key        TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  content_type      TEXT NOT NULL,
  file_size         INTEGER NOT NULL,
  uploaded_at       TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (purchase_id, tenant_id) REFERENCES purchases(id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX ON purchase_attachments(purchase_id, tenant_id);
