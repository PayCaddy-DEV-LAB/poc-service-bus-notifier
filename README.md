# Event Bus PoC — Webhook Notification System

> **English** | [Español ↓](#sistema-de-notificaciones-event-bus---poc)

---

## What this is

A proof of concept showing how Azure Service Bus can replace fire-and-forget webhook delivery with a routable, trackable, retry-aware notification pipeline.

**The problem being solved:** when a client says they didn't receive a webhook, there is currently no per-client visibility into what was sent, when, and whether it was acknowledged. This PoC proves out the solution.

---

## Architecture

```
company-api  ──or──  api-client mock (:3003)
    │                   │
    │   POST /v2/SR/EndUserSRs  →  real PayCaddy staging  →  publishes enduser.created
    │   POST /mock/:eventType   →  publishes directly (no upstream call)
    │
    └─► Topic: webhook-events
            │
            ├─► Subscription: client-acme       [filter: clientId = 'acme']       ─► DLQ
            ├─► Subscription: client-firstbank  [filter: clientId = 'firstbank']  ─► DLQ
            └─► Subscription: client-<poc-uuid> [filter: clientId = '<poc-uuid>'] ─► DLQ
                    │
                    └─► Consumer Worker
                            │
                            ├─► Regular clients  →  POST + X-Api-Key   (:3001)
                            ├─► JIT/Bank clients →  POST + HMAC-SHA256 (:3002)  (mTLS, OAuth: TODO)
                            └─► SQLite tracking table  (delivery_log)
                                        │
                                        └─► Dashboard  http://localhost:3000
```

**Key rules:**
- `clientId` is set as a Service Bus *application property* on every message (not in the body — filters can't inspect the body).
- Each subscription has its own Dead-Letter Queue (DLQ). After 3 failed delivery attempts, Service Bus auto-moves the message there — no application code needed.
- The consumer uses **PeekLock** mode: if the process crashes mid-delivery, the lock expires and the message is redelivered. No silent message loss.

---

## Local Setup

### Prerequisites

- Docker Desktop
- Node.js 20+
- `npm`

### Steps

```bash
# 1. Clone and install
npm install

# 2. Copy env file (defaults work for local emulator)
cp .env.example .env

# 3. Start infrastructure (Service Bus emulator + SQL Edge sidecar)
npm run infra:up
# Wait ~30 seconds. Watch logs until you see:
# "Emulator Service is Successfully Up!"
docker logs -f $(docker ps -q --filter ancestor=mcr.microsoft.com/azure-messaging/servicebus-emulator)
```

### Running the full flow (4 terminals)

```bash
# Terminal 1 — regular client mock (port 3001)
npm run mock:regular

# Terminal 2 — JIT/bank client mock (port 3002)
npm run mock:jit

# Terminal 3 — consumer worker
npm run consume

# Terminal 4 — publish test events
npm run produce -- --clientId acme --eventType payment.completed --count 2
npm run produce -- --clientId firstbank --eventType payment.completed --count 2

# Check tracking
npm run query
```

---

## Tracking & Observability

Every delivery attempt (success or failure) writes a row to `data/tracking.db`.

```bash
# All records
npm run query

# Filter by client
npm run query -- --clientId acme

# Filter by status
npm run query -- --clientId acme --status FAILED

# Inspect dead-lettered messages for a client
npm run check-dlq -- --clientId acme
```

**Status values:**

| Status      | Meaning                                                         |
|-------------|---------------------------------------------------------------- |
| `DELIVERED` | HTTP 2xx received from client endpoint                          |
| `FAILED`    | Delivery attempt failed (non-2xx or network error). Will retry. |
| `DLQ`       | All retries exhausted. Message in dead-letter queue.            |

---

## Operational Runbook

### Adding a new client to production

In the PoC, subscriptions are pre-declared in `docker/servicebus-config.json` and the emulator must be restarted to pick them up. **In production on Azure**, use the Service Bus Administration API instead — no restart required.

**PoC (local emulator):**

1. Add the client to `src/config.ts` → `CLIENT_REGISTRY`:
   ```typescript
   newbank: {
     clientId: "newbank",
     type: "jit",
     webhookUrl: "https://newbank.example.com/webhooks/paycaddy",
     jitAuth: { method: "hmac", secret: "newbank-secret-from-vault" },
   }
   ```
2. Add the subscription to `docker/servicebus-config.json`:
   ```json
   {
     "Name": "client-newbank",
     "Properties": { "MaxDeliveryCount": 3, "LockDuration": "PT30S" },
     "Rules": [{
       "Name": "clientIdFilter",
       "Properties": { "FilterType": "SqlFilter", "SqlExpression": "clientId = 'newbank'" }
     }]
   }
   ```
3. Restart infrastructure: `npm run infra:down && npm run infra:up`
4. Restart the consumer: `npm run consume`

**Production (Azure):**

Call `ServiceBusAdministrationClient` once during client onboarding:
```typescript
const admin = new ServiceBusAdministrationClient(connectionString);
await admin.createSubscription("webhook-events", `client-${clientId}`, {
  maxDeliveryCount: 3,
  lockDuration: "PT30S",
  defaultRuleOptions: {
    name: "clientIdFilter",
    filter: { sqlExpression: `clientId = '${clientId}'` },
  },
});
```

> ⚠️ Sanitize `clientId` before interpolating into the SQL expression. Only allow alphanumeric characters and hyphens.

**Edge cases:**
- If `company-api` publishes messages for a clientId whose subscription doesn't exist yet, those messages are silently dropped by the broker (no subscription = no delivery). Create the subscription **before** activating the client in `company-api`.
- If two subscriptions share the same SQL filter expression by mistake, both will receive the message. Filters must be unique per clientId.

---

### Deactivating a client from production

Deactivation means stopping delivery to a client without losing messages already in flight.

**Step 1 — Stop the consumer from processing this client.**

In the PoC, remove the client from `CLIENT_REGISTRY` and restart the consumer. The subscription stays alive on the broker; messages keep accumulating but are not delivered.

In production, a feature flag per clientId in the consumer is cleaner:
```typescript
if (config.active === false) {
  await receiver.abandonMessage(msg); // return to queue, don't deliver
  return;
}
```

**Step 2 — Decide what happens to queued messages.**

| Scenario | Action |
|----------|--------|
| Client is temporarily suspended (will resume) | Leave messages in the subscription. They will be delivered when the client is reactivated. Service Bus TTL is 1 hour by default — extend it if the suspension may last longer. |
| Client is permanently offboarded | Delete the subscription. In-flight messages are discarded. Log them first via `check-dlq` if needed. |
| Client needs time to catch up | Reduce `maxConcurrentCalls` to 1 and add a delivery delay in the consumer. |

**To delete a subscription (production):**
```typescript
await admin.deleteSubscription("webhook-events", `client-${clientId}`);
```

**Edge cases:**
- Messages already locked by the consumer when deactivation happens will be abandoned when the lock expires (30 seconds). They will reappear in the subscription queue.
- If the client has messages in DLQ at deactivation time, those are not automatically cleaned up. Run `check-dlq` to drain and log them before deleting the subscription.
- If `company-api` keeps publishing after deactivation but the subscription still exists, messages will accumulate and eventually expire (per TTL). Monitor subscription message count to detect this.

---

### Changing a client's webhook URL

Webhook URL changes are safe — they only affect the consumer, not the broker. No messages are lost.

**PoC:**

1. Update `webhookUrl` in `CLIENT_REGISTRY` in `src/config.ts`.
2. Restart the consumer: `npm run consume`
   - Messages being processed at the moment of restart will be abandoned by the old consumer and redelivered to the new one.

**Production:**

Store `webhookUrl` (and auth config) in a database, not hardcoded. The consumer reads config per-message or refreshes on a short TTL (e.g., every 60 seconds). This way, a URL change takes effect without any restart.

```typescript
// Consumer: refresh client config every 60 seconds
async function getConfig(clientId: string): Promise<ClientConfig> {
  const cached = configCache.get(clientId);
  if (cached && Date.now() - cached.fetchedAt < 60_000) return cached.config;
  const fresh = await db.query("SELECT * FROM client_configs WHERE client_id = $1", [clientId]);
  configCache.set(clientId, { config: fresh, fetchedAt: Date.now() });
  return fresh;
}
```

**Edge cases:**
- If the old URL returns 4xx or 5xx during the window between when the client updates their endpoint and when you update your config, the consumer will retry up to 3 times before dead-lettering. Coordinate the URL change with the client to minimize this window, or temporarily pause delivery during the switch.
- If the new URL is unreachable (DNS propagation lag, deployment window), messages will retry and may hit DLQ. Drain the DLQ and republish after the new URL is stable.
- Auth credentials (API key, HMAC secret) should be rotated separately from URL changes. Rotate the secret in your config first, then let the client start accepting the new one, before the client revokes the old one.

---

## PoC vs Production Differences

| Concern | PoC (this repo) | Production |
|---------|----------------|-----------|
| Client registry | Hardcoded in `src/config.ts` | Database table, refreshed per-message |
| Subscription creation | Pre-declared in JSON, emulator restart required | `ServiceBusAdministrationClient` at onboarding |
| Tracking storage | SQLite (`data/tracking.db`) | Postgres / Azure SQL |
| DLQ monitoring | Manual `npm run check-dlq` | Continuous DLQ processor + alerting |
| Auth secrets | Hardcoded strings | Azure Key Vault |
| JIT: mTLS | Stubbed (TODO) | `https.Agent` with client cert per bank |
| JIT: OAuth | Stubbed (TODO) | Client credentials grant with token caching |
| Message TTL | 1 hour | Per-client SLA |

---

---

# Sistema de Notificaciones Event Bus — PoC

> [English ↑](#event-bus-poc--webhook-notification-system) | **Español**

---

## Qué es esto

Una prueba de concepto que demuestra cómo Azure Service Bus puede reemplazar el envío de webhooks tipo "dispara y olvida" con un pipeline de notificaciones enrutable, trazable y con reintentos.

**El problema que resuelve:** cuando un cliente dice que no recibió un webhook, actualmente no hay visibilidad por cliente sobre qué se envió, cuándo, y si fue confirmado. Este PoC prueba la solución.

---

## Arquitectura

```
company-api
    │
    └─► Topic: webhook-events
            │
            ├─► Subscription: client-acme       [filtro: clientId = 'acme']       ─► DLQ
            └─► Subscription: client-firstbank  [filtro: clientId = 'firstbank']  ─► DLQ
                    │
                    └─► Consumer Worker
                            │
                            ├─► Clientes regulares  →  POST + X-Api-Key
                            ├─► Clientes JIT/Banco  →  POST + HMAC-SHA256 (mTLS, OAuth: TODO)
                            └─► Tabla de tracking SQLite  (delivery_log)
```

**Reglas clave:**
- `clientId` se establece como *application property* en cada mensaje de Service Bus (no en el body — los filtros no pueden leer el body).
- Cada subscription tiene su propia Dead-Letter Queue (DLQ). Después de 3 intentos fallidos de entrega, Service Bus mueve el mensaje automáticamente — sin código adicional en la aplicación.
- El consumer usa modo **PeekLock**: si el proceso cae a mitad de una entrega, el lock expira y el mensaje es reenviado. No hay pérdida silenciosa de mensajes.

---

## Setup Local

### Requisitos

- Docker Desktop
- Node.js 20+
- `npm`

### Pasos

```bash
# 1. Clonar e instalar
npm install

# 2. Copiar archivo de entorno (los defaults funcionan para el emulador local)
cp .env.example .env

# 3. Levantar infraestructura (emulador de Service Bus + SQL Edge)
npm run infra:up
# Esperar ~30 segundos. Ver los logs hasta encontrar:
# "Emulator Service is Successfully Up!"
docker logs -f $(docker ps -q --filter ancestor=mcr.microsoft.com/azure-messaging/servicebus-emulator)
```

### Correr el flujo completo (4 terminales)

```bash
# Terminal 1 — mock cliente regular (puerto 3001)
npm run mock:regular

# Terminal 2 — mock cliente JIT/banco (puerto 3002)
npm run mock:jit

# Terminal 3 — consumer worker
npm run consume

# Terminal 4 — publicar eventos de prueba
npm run produce -- --clientId acme --eventType payment.completed --count 2
npm run produce -- --clientId firstbank --eventType payment.completed --count 2

# Ver el tracking
npm run query
```

---

## Tracking y Observabilidad

Cada intento de entrega (exitoso o fallido) escribe una fila en `data/tracking.db`.

```bash
# Todos los registros
npm run query

# Filtrar por cliente
npm run query -- --clientId acme

# Filtrar por estado
npm run query -- --clientId acme --status FAILED

# Inspeccionar mensajes en dead-letter de un cliente
npm run check-dlq -- --clientId acme
```

**Valores de estado:**

| Estado      | Significado                                                              |
|-------------|-------------------------------------------------------------------------|
| `DELIVERED` | Se recibió HTTP 2xx del endpoint del cliente                            |
| `FAILED`    | El intento de entrega falló (non-2xx o error de red). Se reintentará.   |
| `DLQ`       | Se agotaron todos los reintentos. Mensaje en dead-letter queue.          |

---

## Runbook Operativo

### Agregar un nuevo cliente a producción

En el PoC, las subscriptions se pre-declaran en `docker/servicebus-config.json` y el emulador debe reiniciarse para tomarlas. **En producción sobre Azure**, se usa la API de administración de Service Bus — sin necesidad de reiniciar.

**PoC (emulador local):**

1. Agregar el cliente en `src/config.ts` → `CLIENT_REGISTRY`:
   ```typescript
   newbank: {
     clientId: "newbank",
     type: "jit",
     webhookUrl: "https://newbank.ejemplo.com/webhooks/paycaddy",
     jitAuth: { method: "hmac", secret: "secret-del-banco-desde-vault" },
   }
   ```
2. Agregar la subscription en `docker/servicebus-config.json`:
   ```json
   {
     "Name": "client-newbank",
     "Properties": { "MaxDeliveryCount": 3, "LockDuration": "PT30S" },
     "Rules": [{
       "Name": "clientIdFilter",
       "Properties": { "FilterType": "SqlFilter", "SqlExpression": "clientId = 'newbank'" }
     }]
   }
   ```
3. Reiniciar la infraestructura: `npm run infra:down && npm run infra:up`
4. Reiniciar el consumer: `npm run consume`

**Producción (Azure):**

Llamar a `ServiceBusAdministrationClient` una vez durante el onboarding del cliente:
```typescript
const admin = new ServiceBusAdministrationClient(connectionString);
await admin.createSubscription("webhook-events", `client-${clientId}`, {
  maxDeliveryCount: 3,
  lockDuration: "PT30S",
  defaultRuleOptions: {
    name: "clientIdFilter",
    filter: { sqlExpression: `clientId = '${clientId}'` },
  },
});
```

> ⚠️ Sanitizar `clientId` antes de interpolarlo en la expresión SQL. Permitir solo caracteres alfanuméricos y guiones.

**Casos borde:**
- Si `company-api` publica mensajes para un `clientId` cuya subscription no existe todavía, esos mensajes son descartados silenciosamente por el broker (sin subscription = sin entrega). Crear la subscription **antes** de activar el cliente en `company-api`.
- Si dos subscriptions comparten por error la misma expresión de filtro, ambas recibirán el mensaje. Los filtros deben ser únicos por clientId.

---

### Desactivar un cliente de producción

Desactivar significa detener la entrega a un cliente sin perder los mensajes que ya están en vuelo.

**Paso 1 — Detener al consumer para ese cliente.**

En el PoC, eliminar el cliente de `CLIENT_REGISTRY` y reiniciar el consumer. La subscription queda activa en el broker; los mensajes se acumulan pero no se entregan.

En producción, un feature flag por clientId en el consumer es más limpio:
```typescript
if (config.active === false) {
  await receiver.abandonMessage(msg); // devolver a la cola, no entregar
  return;
}
```

**Paso 2 — Decidir qué pasa con los mensajes en cola.**

| Escenario | Acción |
|-----------|--------|
| Cliente suspendido temporalmente (va a volver) | Dejar los mensajes en la subscription. Se entregarán cuando el cliente se reactive. El TTL de Service Bus es 1 hora por defecto — extenderlo si la suspensión puede durar más. |
| Cliente dado de baja definitivamente | Eliminar la subscription. Los mensajes en vuelo se descartan. Drenarlo con `check-dlq` antes si es necesario. |
| Cliente necesita tiempo para ponerse al día | Reducir `maxConcurrentCalls` a 1 y agregar delay de entrega en el consumer. |

**Para eliminar una subscription (producción):**
```typescript
await admin.deleteSubscription("webhook-events", `client-${clientId}`);
```

**Casos borde:**
- Los mensajes ya bloqueados por el consumer cuando se desactiva el cliente serán abandonados cuando expire el lock (30 segundos). Volverán a aparecer en la subscription.
- Si el cliente tiene mensajes en DLQ al momento de la baja, esos no se limpian automáticamente. Correr `check-dlq` para drenalos y registrarlos antes de eliminar la subscription.
- Si `company-api` sigue publicando después de la desactivación pero la subscription sigue existiendo, los mensajes se acumulan y eventualmente expiran (según TTL). Monitorear el conteo de mensajes de la subscription para detectar esto.

---

### Cambiar la URL del webhook de un cliente

Los cambios de URL son seguros — solo afectan al consumer, no al broker. No se pierde ningún mensaje.

**PoC:**

1. Actualizar `webhookUrl` en `CLIENT_REGISTRY` en `src/config.ts`.
2. Reiniciar el consumer: `npm run consume`
   - Los mensajes que se estaban procesando al momento del reinicio serán abandonados por el consumer viejo y reenviados al nuevo.

**Producción:**

Guardar `webhookUrl` (y la config de auth) en una base de datos, no hardcodeado. El consumer lee la config por mensaje o la refresca con un TTL corto (ej: cada 60 segundos). Así, un cambio de URL tiene efecto sin ningún reinicio.

```typescript
// Consumer: refrescar config de cliente cada 60 segundos
async function getConfig(clientId: string): Promise<ClientConfig> {
  const cached = configCache.get(clientId);
  if (cached && Date.now() - cached.fetchedAt < 60_000) return cached.config;
  const fresh = await db.query("SELECT * FROM client_configs WHERE client_id = $1", [clientId]);
  configCache.set(clientId, { config: fresh, fetchedAt: Date.now() });
  return fresh;
}
```

**Casos borde:**
- Si la URL vieja devuelve 4xx o 5xx durante la ventana entre que el cliente actualiza su endpoint y vos actualizas tu config, el consumer reintentará hasta 3 veces antes de mandar el mensaje a DLQ. Coordinar el cambio de URL con el cliente para minimizar esa ventana, o pausar temporalmente la entrega durante el switch.
- Si la nueva URL no está disponible (propagación DNS, ventana de deploy), los mensajes van a reintentar y pueden llegar a DLQ. Drenar el DLQ y republicar después de que la nueva URL esté estable.
- Las credenciales de auth (API key, secret HMAC) deben rotarse por separado del cambio de URL. Rotar el secret en tu config primero, luego dejar que el cliente empiece a aceptar el nuevo, antes de que el cliente revoque el viejo.

---

## Diferencias PoC vs Producción

| Aspecto | PoC (este repo) | Producción |
|---------|----------------|-----------|
| Registro de clientes | Hardcodeado en `src/config.ts` | Tabla en base de datos, refrescada por mensaje |
| Creación de subscriptions | Pre-declaradas en JSON, requiere reinicio del emulador | `ServiceBusAdministrationClient` en el onboarding |
| Storage de tracking | SQLite (`data/tracking.db`) | Postgres / Azure SQL |
| Monitoreo de DLQ | Manual con `npm run check-dlq` | Procesador continuo de DLQ + alertas |
| Secrets de auth | Strings hardcodeados | Azure Key Vault |
| JIT: mTLS | Stub (TODO) | `https.Agent` con certificado de cliente por banco |
| JIT: OAuth | Stub (TODO) | Client credentials grant con caché de tokens |
| TTL de mensajes | 1 hora | Según SLA por cliente |
