CREATE TABLE email_templates (
  id          serial primary key,
  name        text not null,
  subject     text not null default '',
  body_html   text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
