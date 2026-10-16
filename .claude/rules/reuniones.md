---
paths:
  - "lib/calendar.ts"
  - "lib/meeting-notes.ts"
  - "**/reuniones/**"
---

# Reuniones

(Movido desde CLAUDE.md: se carga solo al trabajar con estos archivos.)
- Pestaña Reuniones (`/clientes/[slug]/reuniones` y `/mi-empresa/reuniones`, misma
  `ReunionesView`, área `clientes`): reuniones de Google Calendar reconocidas por la
  nomenclatura `"<Cliente> & Qualita <motivo>"` (el nombre se compara con
  `client.name`, sin distinguir mayúsculas ni tildes). Se leen **en vivo** los
  calendarios de todo el equipo con una **cuenta de servicio con delegación de
  dominio** (env `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_KEY`; scope
  `calendar.events.readonly`, autorizado por un super admin en la consola de
  Workspace). `lib/calendar.ts`: como con Notion, se cachea solo la consulta de todo
  el estudio (`unstable_cache` 5 min, tag `calendar-meetings`) y el filtro por cliente
  va afuera. Ventana: 90 días atrás, 60 adelante. La cuenta del cliente no ve la
  descripción del evento; sin env, la solapa no aparece en `/mi-empresa`. La vista es
  mitad y mitad (`meetings-calendar.tsx`): el mes con las reuniones escritas en cada
  día y, a la derecha, las próximas como cards separadas por semana (fotos de Google
  del equipo cruzadas por mail con `getTeam`; los de afuera, iniciales). Tocando un
  día se ven sus reuniones; las pasadas llevan una descripción que escribe el equipo
  y la cuenta del cliente solo lee (además, en el Portal el roadmap suma una solapa
  "Reuniones" al lado de Calendario y Etapas, con un calendario solo de reuniones:
  van en `db.extraEvents` y `buildCalendar(…, "extra")` lo arma; el Calendario las
  muestra mezcladas con las etapas, y la solapa no aparece si no hay reuniones; se
  ven aunque la solapa Reuniones del cliente esté desactivada, pedido): `intranet_meeting_notes` (clave = `Meeting.key`,
  `docs/sql/2026-09-30-reuniones-notas.sql`), `lib/meeting-notes.ts`,
  `saveMeetingNote` valida que la clave sea de una reunión pasada del cliente.
- Reuniones, solo equipo con el área `tareas`: al abrir en el calendario un día con
  una reunión que viene (`meetings-calendar.tsx`), su card muestra, ya desplegadas,
  las tareas abiertas del cliente (`getTasksResult()`: tickets de Notion + propias)
  que vencen ese día o antes, incluidas las vencidas. En la lista "Próximas
  reuniones" no aparecen. `ReunionesView` las manda todas en
  `prep` y cada card filtra por su día. Las abiertas sin vencimiento solo se cuentan.
  No depende de `SHOW_TASKS`. La cuenta del cliente no recibe `prep`.
- Pantalla **Reuniones del sidebar** (`/reuniones`, `app/(app)/reuniones/page.tsx`,
  pedido del usuario): las reuniones con clientes en las que participa quien entra
  (invitado u organizador, `getMemberMeetings` de `lib/calendar.ts`), de todos los
  clientes, con el mismo `MeetingsCalendar`; cada reunión lleva el nombre del cliente
  (`CalMeeting.client`, en la celda del mes y arriba de la card). Como el foro, no es
  de un área (cuenta activa alcanza); las descripciones se editan con el área
  `clientes` y las tareas para la próxima reunión salen con el área `tareas`, filtradas
  por el cliente de cada reunión. El cliente se cruza por nombre contra `getClients()`
  (RLS): si no lo ve, la reunión aparece sin notas ni tareas. La lógica que arma
  reuniones y tareas está en `clientes/[id]/reuniones/build.ts` (`buildMeetings`) y
  la comparten las dos pantallas; `saveMeetingNote` revalida también `/reuniones`.
- La pantalla del sidebar usa `view="week"` de `MeetingsCalendar` (pedido del usuario: semanal, no mensual): la semana de lunes a domingo con cada reunión entera (hora, cliente, motivo), navegable dentro de la ventana de Calendar; la solapa del cliente sigue mensual.
