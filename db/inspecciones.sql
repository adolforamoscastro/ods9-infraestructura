-- Inspecciones térmicas por usuario (se crea sola al arrancar el servidor).
CREATE TABLE IF NOT EXISTS inspecciones (
  id BIGSERIAL PRIMARY KEY,
  usuario_id BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  titulo VARCHAR(80) NOT NULL,
  ubicacion VARCHAR(120),                       -- ej. 'Habitación 2, muro norte'
  paleta VARCHAR(10) NOT NULL CHECK (paleta IN ('hierro','arcoiris')),
  porcentaje_afectado NUMERIC(5,2) NOT NULL CHECK (porcentaje_afectado BETWEEN 0 AND 100),
  zonas INT NOT NULL CHECK (zonas >= 0),
  severidad VARCHAR(8) NOT NULL CHECK (severidad IN ('verde','amarillo','rojo')),
  imagen_original BYTEA NOT NULL,
  imagen_procesada BYTEA NOT NULL,
  inspeccion_previa_id BIGINT REFERENCES inspecciones(id) ON DELETE SET NULL,
  creada_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_insp_usuario ON inspecciones (usuario_id, creada_en DESC);
