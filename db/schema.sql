-- Esquema de base de datos (PostgreSQL).
-- El servidor lo ejecuta automáticamente al arrancar; es seguro repetirlo.

CREATE TABLE IF NOT EXISTS usuarios (
  id             BIGSERIAL PRIMARY KEY,
  email          VARCHAR(254) NOT NULL,
  password_hash  VARCHAR(100) NOT NULL,
  creado_en      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Un correo = una persona (sin distinguir mayúsculas/minúsculas).
CREATE UNIQUE INDEX IF NOT EXISTS usuarios_email_unico ON usuarios (LOWER(email));
