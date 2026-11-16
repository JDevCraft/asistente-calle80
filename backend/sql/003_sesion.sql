-- Agrupa búsquedas por sesión del navegador y guarda el motivo opcional del «No» en la micro-encuesta.
-- Ejecutar una sola vez en Neon. sesion_id es un UUID aleatorio de sessionStorage (sin IP ni identidad).
ALTER TABLE busquedas
  ADD COLUMN IF NOT EXISTS sesion_id uuid,
  ADD COLUMN IF NOT EXISTS motivo text CHECK (motivo IN ('no_era','no_encontre','ruta_confusa','otro')),
  ADD COLUMN IF NOT EXISTS comentario text CHECK (char_length(comentario) <= 140);
CREATE INDEX IF NOT EXISTS busquedas_sesion_idx ON busquedas (sesion_id, creado_en);
