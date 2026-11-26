-- Guarda el «consejo» que escribió el modelo, para auditar qué le respondió a consultas límite (sin IP ni identidad).
-- Ejecutar una sola vez en Neon ANTES de desplegar el código que lo escribe.
ALTER TABLE busquedas ADD COLUMN IF NOT EXISTS consejo text CHECK (char_length(consejo) <= 300);
