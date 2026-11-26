-- Analítica: columnas nuevas en busquedas (lo que el servidor sabe de cada búsqueda) y tabla eventos (acciones del cliente).
-- Ejecutar una sola vez en Neon ANTES de desplegar el código. Es aditivo: el código anterior sigue funcionando.
-- Sin IP, sin texto libre en eventos (detalle = vocabulario corto y controlado), retención de 30 días (api/purgar.js).
ALTER TABLE busquedas
  DROP CONSTRAINT IF EXISTS busquedas_resultado_check,
  ADD CONSTRAINT busquedas_resultado_check CHECK (resultado IN ('indice','modelo','respaldo','error','bloqueado')),
  ADD COLUMN IF NOT EXISTS alcance text CHECK (alcance IN ('basura','dano','ilegal','fraude','inyeccion','tienda')),
  ADD COLUMN IF NOT EXISTS destino text CHECK (char_length(destino) <= 40),
  ADD COLUMN IF NOT EXISTS decision text CHECK (decision IN ('directo','preguntar','generico','sin_destino')),
  ADD COLUMN IF NOT EXISTS cache boolean,
  ADD COLUMN IF NOT EXISTS n_respuestas smallint,
  ADD COLUMN IF NOT EXISTS plataforma text CHECK (plataforma IN ('ios','android','escritorio','otro')),
  ADD COLUMN IF NOT EXISTS version text CHECK (char_length(version) <= 12);

CREATE TABLE IF NOT EXISTS eventos (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  creado_en timestamptz NOT NULL DEFAULT now(),
  sesion_id uuid NOT NULL,
  busqueda_id uuid, -- sin FK a propósito: un evento nunca debe perderse porque la búsqueda no se haya registrado
  tipo text NOT NULL CHECK (tipo IN ('ver_pasillos','ubicacion_abrir','ubicacion_elegida','ubicacion_deshacer','recorrido_inicio','recorrido_fin','recorrido_detener','recorrido_repetir','paso_manual','opcion_elegida','pregunta_respondida','pago_click','voz_error')),
  detalle text CHECK (char_length(detalle) <= 40),
  plataforma text CHECK (plataforma IN ('ios','android','escritorio','otro')),
  version text CHECK (char_length(version) <= 12)
);
CREATE INDEX IF NOT EXISTS eventos_sesion_idx ON eventos (sesion_id, creado_en);
CREATE INDEX IF NOT EXISTS eventos_tipo_idx ON eventos (tipo, creado_en);
