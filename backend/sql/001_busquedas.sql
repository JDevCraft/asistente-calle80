CREATE TABLE busquedas (
  id uuid PRIMARY KEY,
  creado_en timestamptz NOT NULL DEFAULT now(),
  texto text NOT NULL,
  canal text NOT NULL CHECK (canal IN ('voz','texto')),
  resultado text NOT NULL CHECK (resultado IN ('indice','modelo','respaldo','error')),
  proveedor text CHECK (proveedor IN ('nvidia','gemini')),
  motivo_respaldo text,
  tiempo_respuesta_ms integer,
  ip text,
  util boolean
);
