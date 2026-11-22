# Mercado inicial

> **Estado: pendiente.** Aquí está el método y las fuentes. No hay cifras: cada `[completar]` se llena con un dato verificable y su fuente.

## Segmento inicial

Importadoras pequeñas que venden **bajo pedido por WhatsApp** (tecnología, telefonía, ropa, belleza y similares) en La Paz, El Alto, Cochabamba y Santa Cruz. Sus clientes pagan por adelantado.

## Fórmula

```text
Mercado inicial (USD/año) = importadoras activas × pedidos por mes × 12 × ticket promedio (USD) × comisión aceptada (%)
```

Además conviene reportar el **volumen protegible** (lo que pasaría por el escrow), sin aplicar la comisión:

```text
Volumen protegible (USD/año) = importadoras activas × pedidos por mes × 12 × ticket promedio (USD)
```

## Datos y de dónde salen

| Dato | Valor | Fuente a consultar | Cómo obtenerlo |
|---|---|---|---|
| Empresas de comercio o importación registradas en las 4 ciudades | [completar] | **SEPREC** (Servicio Plurinacional de Registro de Comercio): estadísticas de empresas por actividad y departamento | Filtrar por actividades de comercio al por menor e importación |
| Personas que hacen compras por internet o al exterior | [completar] | **INE** (Instituto Nacional de Estadística): encuestas de hogares y uso de TIC, si las hay | Usar el dato más reciente publicado y citar la encuesta y el año |
| Volumen de importaciones de bienes de consumo y por courier | [completar] | **Aduana Nacional de Bolivia** e **INE**: estadísticas de comercio exterior por tipo de bien y régimen (incluido courier o envíos de entrega rápida, si se publica) | Tomar el valor anual y el desglose por categoría |
| Contexto del sector comercio | [completar] | **Cámara Nacional de Comercio** y cámaras departamentales | Informes o notas de prensa sobre comercio e importaciones |
| Importadoras informales activas por WhatsApp o redes | [completar] | Conteo propio: páginas o grupos de Facebook e Instagram de "importaciones bajo pedido" por ciudad | Contar en una muestra y anotar método y fecha. Muchas no están en SEPREC |
| Pedidos por mes por importadora | [completar] | Entrevistas (`docs/validacion.md`, pregunta I1) | Mediana de las respuestas |
| Ticket promedio por pedido (USD) | [completar] | Entrevistas (I2, C1) | Mediana; anotar el tipo de cambio usado y su fecha |
| Comisión que aceptarían (%) | [completar] | Entrevistas (I7, C6) | Rango y mediana |

## Cálculo

| Variable | Valor |
|---|---|
| Importadoras activas (A) | [completar] |
| Pedidos por mes por importadora (P) | [completar] |
| Ticket promedio en USD (T) | [completar] |
| Comisión (c) | [completar] |
| **Volumen protegible = A × P × 12 × T** | [completar] |
| **Mercado inicial = A × P × 12 × T × c** | [completar] |

## Reglas

- Cada número lleva su fuente y su fecha. Si un dato es una estimación propia, se marca como tal y se explica el método.
- No mezclar el mercado total de importaciones con el segmento de WhatsApp: el segundo es una fracción y se estima con el conteo propio y las entrevistas.
- Hasta tener los datos, el formulario debe decir "en medición (método en docs/mercado.md)" y no dar una cifra.
