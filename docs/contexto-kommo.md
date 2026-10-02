# Contexto del CRM Kommo de Arteplac
 
Usá este contexto para interpretar los datos que leés de la cuenta de Kommo de Arteplac por API. Describe cómo se implementó el CRM, qué significa cada campo y etapa, qué datos son confiables y cuáles no, y cómo calcular las métricas sin distorsiones. Cuando un dato de la API contradiga lo que dice este documento, priorizá el dato y avisá la diferencia.
 
---
 
## 1. El negocio
 
Arteplac fabrica muebles a medida (cocinas, vestidores, placards, baños, proyectos integrales). Tiene dos sucursales en zona sur del Gran Buenos Aires: **Lomas** y **Canning**, cada una con su propio número de WhatsApp. También atiende en el local (showroom) y trabaja con arquitectos y estudios que traen obras.
 
Vendedores:
- **Lomas:** Cecilia y Mariano.
- **Canning:** Belén y Ailín. Ailín no registra cotizaciones en la planilla desde el 03/09/2026; hay que confirmar si sigue en la empresa.
---
 
## 2. Cronología de implementación del CRM
 
Esta es la información más importante para interpretar cualquier dato histórico.
 
| Fecha | Qué pasó | Efecto en los datos |
|---|---|---|
| Agosto 2026 | Se crea la cuenta de Kommo | — |
| **01/08/2026** | Se conecta el WhatsApp de **Canning** | Desde acá Kommo puede recibir mensajes de Canning |
| **20/08/2026** | Se conecta el WhatsApp de **Lomas** | Antes de esta fecha no hay ningún dato de Lomas |
| **08/09/2026** | Los **vendedores empiezan a usar Kommo** | Recién desde acá el registro de leads es completo |
 
Consecuencias:
 
- **Entre el 01/08 y el 07/09 el CRM está muy incompleto.** Aunque los números estaban conectados, los vendedores atendían desde el celular. La mayoría de las conversaciones de WhatsApp de ese período nunca quedó registrada en Kommo, y no se puede recuperar por API porque esos mensajes no existen en Kommo. Ejemplo: entre el 20/08 y el 07/09 Kommo registró solo 31 leads de WhatsApp directo (1,6 por día); desde el 08/09 registra unos 10 por día.
- **La fecha de creación de un lead no es la fecha real del primer contacto** para clientes que venían hablando por WhatsApp antes de que Kommo viera la conversación. Kommo crea el lead cuando ve el primer mensaje, que puede ser semanas o meses después del contacto real.
- **No compares agosto contra septiembre con leads de Kommo.** Agosto aparece con muchos menos leads por cómo se implementó el CRM, no porque haya habido menos demanda.
- **Las etapas de los leads de agosto son retroactivas:** se clasificaron cuando los vendedores empezaron a usar Kommo, después del 08/09.
- **El único período con registro completo empieza el 08/09/2026.** Para cualquier métrica de proceso (tiempos de respuesta, conversión por etapa, ciclo de venta), usá solo leads cuyo primer mensaje sea desde esa fecha.
---
 
## 3. Usuarios y responsables
 
Los leads se asignan a la **sucursal**, no al vendedor individual:
 
| responsible_user_id | Usuario | Uso |
|---|---|---|
| 15681815 | Arteplac Canning | Leads de WhatsApp Canning |
| 15681827 | Arteplac Lomas | Leads de WhatsApp Lomas |
| 15619795 | Administrador | Pruebas, configuración y algunos leads mal asignados |
 
- No se puede medir desempeño por vendedor con el responsable de Kommo. El vendedor aparece, cuando aparece, como **etiqueta** (Cecilia, Mariano, Belen, Ailin). Solo una parte chica de los leads tiene vendedor etiquetado (120 de 549 al 01/10/2026).
- Un lead asignado a "Administrador" que tiene etiquetas de una sucursal probablemente está mal asignado.
---
 
## 4. Fuentes de los leads
 
### 4.1 Formulario web (automatización)
Hay una automatización: el visitante completa un formulario en la web → el lead se carga solo en Kommo **con sus UTMs** → se abre el chat de WhatsApp con la sucursal.
 
- Estos leads **tienen `utm_source` cargado**. Valores usados: `meta`, `google`, `Orgánico`, `ig`.
- `utm_campaign` de Meta llega como **ID numérico** de campaña (por ejemplo `120250309596220004`) y no con el nombre. Hubo al menos un caso con la macro sin reemplazar (`{{campaign.id}}`), que es un error de configuración del UTM.
- El campo **"Anuncio"** guarda el nombre del anuncio de Meta (por ejemplo `ATP_COC_A01_D07_TESTIMONIAL_VID_V01_WEB02`) o el ID del anuncio de Google. El valor "Sin anuncio" indica orgánico.
- Son los **únicos leads válidos para atribución** de pauta.
### 4.2 WhatsApp directo
Clientes que escriben directo al WhatsApp de una sucursal, sin pasar por el formulario.
 
- **No tienen UTMs.** Se excluyen de cualquier análisis de atribución.
- Incluyen consultas nuevas, clientes existentes, proveedores y mensajes que no son consultas (estos suelen terminar en "Filtrados").
### 4.3 Plataformas vs Kommo
Meta y Google reportan más leads que los que llegan a Kommo por el formulario. En septiembre 2026 reportaron 174 contra 120 registrados en Kommo. Para leads reales de pauta, tomá Kommo (UTM) como fuente; para costos, las plataformas.
 
---
 
## 5. Etapas del embudo ("Embudo de ventas")
 
| Etapa | Significado |
|---|---|
| Incoming leads | Entrante sin tomar |
| Primer contacto | Se hizo el primer contacto |
| Contactado | El vendedor respondió |
| 1ER SEGUIMIENTO / 2DO SEGUIMIENTO | Seguimientos sin respuesta o sin avance |
| NO CONTESTA | El cliente dejó de responder |
| Primera reunión / SEGUNDA REUNIÓN | Reuniones con el cliente |
| Listo para cotizar | Pendiente de cotización |
| CONFIRMADO | Se usa como "venta confirmada" (ver advertencias) |
| RECHAZADA | El cliente rechazó |
| Filtrados | Descartado: no es consulta, no aplica, duplicado, proveedor, etc. |
| ARQUITECTOS | Leads de arquitectos y estudios (canal profesional) |
| Equipo interno | Pruebas del equipo. **Excluir siempre** de cualquier métrica |
 
Agrupaciones útiles:
- **Avanzaron:** Primera reunión, SEGUNDA REUNIÓN, Listo para cotizar, CONFIRMADO.
- **Perdidos:** Filtrados, RECHAZADA, NO CONTESTA.
- **Activos:** Incoming leads, Primer contacto, Contactado, 1ER y 2DO SEGUIMIENTO, Primera reunión, SEGUNDA REUNIÓN, Listo para cotizar.
El campo "Cerrado el" figura como "no cerrado" en todos los leads: no se usan los estados de cierre nativos de Kommo (ganado/perdido).
 
---
 
## 6. Campos personalizados y etiquetas
 
- **Presupuesto $**: monto en pesos. **No es confiable como venta:** a veces suma varios proyectos o cotizaciones del mismo cliente, y la mayoría de los leads no lo tiene cargado. Ejemplo: un lead figura con $32,6M y en la planilla tiene dos proyectos por $1,5M y $5,1M.
- **Presupuesto USD**: inconsistente con el monto en pesos y con varios valores en 0. No usar.
- **Cantidad de proyectos**, **Tipo cliente**: poco cargados.
- **Etiquetas**: se mezclan tres tipos.
  - Ambiente: Cocinas, Vestidores y placards, Proyecto integral, Baños.
  - Sucursal: Lomas, Canning.
  - Vendedor: Cecilia, Mariano, Belen, Ailin.
  - Cerca del 40% de los leads no tiene ninguna etiqueta.
- **Nombre del lead**: casi siempre "Lead #ID". El nombre real está en el contacto y muchas veces es solo un nombre de pila o un apodo (por ejemplo "Majo" para María José Crespillo). Para identificar clientes, usá el **teléfono**, no el nombre.
---
 
## 7. Problemas conocidos de los datos
 
1. **Clientes viejos cargados como leads nuevos.** Al conectar los WhatsApp, cada cliente anterior que escribió quedó como lead nuevo de agosto o septiembre. Al 01/10/2026 se identificaron 51 leads así, que concentraban $502,3M de los $508,4M de "Presupuesto $" de toda la cuenta. Para detectarlos: cruzar el teléfono con la planilla y ver si hay una cotización anterior a la fecha del lead.
2. **CONFIRMADO no equivale a venta del período.** Mezcla ventas nuevas con clientes que ya habían comprado antes de entrar a Kommo. De 31 leads en CONFIRMADO al 01/10/2026, solo 4 nacieron en el CRM y se confirmaron después. A la vez, hay ventas confirmadas en la planilla que en Kommo siguen en otra etapa (por ejemplo en ARQUITECTOS o en SEGUNDA REUNIÓN).
3. **Leads duplicados.** Un mismo contacto puede tener 3 o 4 leads (casos detectados: Ricardo Anez, Ludmila Ojagnan, Rocío Castiñeira). Muchos terminan en Filtrados. Al contar leads, deduplicá por contacto o por teléfono.
4. **Mensajes salientes sin usuario.** Las respuestas enviadas desde el celular se sincronizan con `created_by = 0`. En los eventos `outgoing_chat_message`, `created_by = 0` **no significa bot**: son respuestas humanas desde el teléfono. No hay respuestas automáticas configuradas (ninguna respuesta llega en menos de 5 segundos).
5. **Responsable mal asignado.** Algunos leads de sucursal quedaron en "Administrador".
---
 
## 8. Relación con la planilla de proyectos (Google Sheets)
 
La planilla que carga Arteplac es la **fuente oficial de ventas y facturación**. Pestañas relevantes:
- **Cotizaciones:** fecha, cliente, vía de contacto (WA Lomas, WA Canning, Local), tipo de mueble, vendedor, si se confirmó ("Sí", "Rechazado" o vacío), fecha de confirmación y número de proyecto.
- **Proyectos:** total en pesos y en USD, teléfono, zona y tipo de proyecto (Simple, Regular, Complejo).
- **Clientes:** número de cliente y teléfono.
Para unir Kommo con la planilla:
- **Clave:** teléfono normalizado (últimos 10 dígitos). Kommo guarda el formato `+5491131899549`; la planilla, por ejemplo, `11 3189-9549`.
- **Cobertura baja:** solo el 19% de las cotizaciones tiene teléfono, así que muchos cruces fallan. El nombre sirve como respaldo, con cuidado por los apodos.
- **No hay ID en común:** ni número de cotización en Kommo ni número de lead en la planilla.
Valores de referencia de la planilla:
- **Cotización → confirmación:** mediana de 9 días, 88% dentro de los 30 días.
- **Facturación agosto 2026:** $364,7M, el mejor mes registrado.
- **Facturación septiembre 2026:** $68,5M, con 76 de 90 cotizaciones todavía abiertas al 01/10.
---
 
## 9. Cómo calcular las métricas
 
- **Base de leads nuevos:** excluir "Equipo interno", clientes con una cotización previa en la planilla y duplicados.
- **Fecha del lead:** usar la del primer mensaje entrante (evento `incoming_chat_message`) si es anterior a la fecha de creación.
- **Atribución:** solo leads con UTM (formulario web). Nunca atribuir leads de WhatsApp directo.
- **Ventas y facturación:** siempre desde la planilla, por fecha de confirmación. Nunca desde "Presupuesto $" ni desde la etapa CONFIRMADO.
- **Tiempo de primera respuesta:**
  - Definición: primer mensaje saliente después del primer mensaje entrante, cualquiera sea su `created_by`.
  - Período: solo leads desde el 08/09/2026.
  - Por sucursal: según `responsible_user_id`.
  - Horario laboral: se asumió lunes a viernes de 9 a 18 h; está pendiente de confirmar con Arteplac.
  - Referencia septiembre 2026: mediana de 67 minutos en general; unos 10 minutos en horario laboral y unas 13 horas fuera de horario.
- **Leads de períodos anteriores al 08/09:** no se pueden contar con Kommo. Si hace falta un número, estimarlo con las cotizaciones de la planilla. Referencia: 3,1 leads por cotización, medido del 08/09 al 30/09/2026 sin contar Filtrados. Presentarlo siempre como estimación.
- **Conversión por sucursal:** usar la planilla (cotizaciones confirmadas sobre cotizaciones emitidas, según vía de contacto). En Kommo no es confiable.
---
 
## 10. Prácticas acordadas para que los datos mejoren
 
- Pasar a CONFIRMADO solo cuando el proyecto está en la planilla, y cargar el número de cotización o proyecto en el lead.
- Que "Presupuesto $" refleje el monto de un solo proyecto.
- Asignar siempre el lead a la sucursal correcta y etiquetar el ambiente y el vendedor.
- Etiquetar a los clientes existentes que vuelven a escribir, o moverlos a un pipeline de postventa.
- Revisar la configuración de duplicados para que un contacto que vuelve a escribir no genere un lead nuevo.
- En la planilla, completar el teléfono y el origen (formulario web, WhatsApp directo, local) en cada cotización.
Desde octubre 2026 los datos de Kommo deberían ser completos para todo el mes. Cualquier análisis que incluya fechas anteriores al 08/09/2026 tiene que aclarar estas limitaciones.