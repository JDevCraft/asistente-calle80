-- Quita la IP cruda del registro de búsquedas (privacidad: sin IP, retención 30 días).
-- Ejecutar una sola vez en Neon. Irreversible: la columna y sus datos se pierden.
ALTER TABLE busquedas DROP COLUMN IF EXISTS ip;
