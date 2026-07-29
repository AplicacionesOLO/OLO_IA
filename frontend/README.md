# OLO IA — Frontend

**Capa 1**: React + TypeScript + Vite + Tailwind 4 + Framer Motion + SVG.
Sin Canvas, sin WebGL, sin Three.js.

## Puesta en marcha

```bash
cd frontend
npm install
npm approve-scripts esbuild     # una vez: esbuild necesita su postinstall
cp .env.example .env.local
npm run dev                     # http://localhost:3000
```

Arranca **sin configurar nada**: sin credenciales de Supabase entra en modo mock.

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Build de producción |
| `npm run typecheck` | TypeScript strict |
| `npm run lint` | ESLint |

## Modo mock

Con `VITE_SUPABASE_URL` vacía, `MockAuthGateway` fabrica un JWT con la **misma
forma** que produce el Auth Hook real (migración 0016).

| Credencial | Resultado |
|---|---|
| Cualquier email con `@` + 4 caracteres de clave | Sesión con `tenant_id` |
| `sin-membresia@olo.test` | Reproduce el fail-secure del Hook → pantalla `NO_ACTIVE_MEMBERSHIP` |

El modo mock **falla al arrancar en producción** (`lib/env.ts`): acepta cualquier
credencial, así que dejarlo activo sería un agujero total.

## Lo que hay

| Área | Estado |
|---|---|
| Sistema de tokens (3 temas + 8 acentos) | Completo |
| Sistema de movimiento + `AmbientClock` | Completo |
| `Surface` (5 planos Z), `MeshLayer` SVG, `FocusContext` | Completo |
| Primitivos: Button, Input, Badge, StatusIndicator, Kbd, ScanLine | Completo |
| Login cinematográfico con degradación | Completo |
| Shell: Vitals + Spine + Canvas + Stream | Completo |
| Cliente HTTP con el contrato real del backend | Completo |
| Overview | Retícula + hueco del Twin reservado. **Sin estaciones de datos** |
| Módulos funcionales | No incluidos en esta entrega |

## Las cuatro decisiones estructurales

### 1. `LayerContext` — las capas son aditivas, nunca requisito

Ningún componente importa la tecnología de renderizado. Pide una superficie por
nombre y recibe la implementación de capa más alta registrada.

```ts
const Mesh = useRenderer('mesh');   // MeshSvg (L1) → MeshCanvas (L2)
const Twin = useRenderer('twin');   // Placeholder (L1) → Twin2D (L2) → Twin3D (L5)
```

Añadir la Capa 2 es crear `design/capability/layer2.ts` y concatenarlo al array.
**Cero cambios en consumidores.**

`VITE_VISUAL_LAYER=1` fuerza un techo de capa para comparar rendimiento sin
desinstalar dependencias.

### 2. `AmbientClock` — un solo rAF, cero re-renders

El latido afecta a decenas de elementos. Con estado de React serían decenas de
re-renders a 60 Hz.

En su lugar, **un** `requestAnimationFrame` escribe dos variables CSS en
`documentElement`. Todo lo ambiental es CSS puro que las lee.

```
1 rAF → --ambient-breath: 0.73  → cientos de elementos reaccionan
        --ambient-pulse:  0.41    0 re-renders de React
```

Se detiene en pestaña oculta y con `prefers-reduced-motion`.

### 3. Contrato real del backend, no el documentado

Tres puntos donde `API_DESIGN.md` no coincidía con lo implementado. **Manda el
backend:**

| Punto | Documentado | Real |
|---|---|---|
| Paginación | `page`/`page_size` | `cursor`/`limit` |
| Login | `POST /v1/auth/login` | No existe: va directo a Supabase Auth |
| Permisos | En el JWT | En `/v1/auth/me`, por petición |

**La trampa crítica**: `NO_ACTIVE_MEMBERSHIP` responde **403, no 401**. Un
interceptor que refresque el token ante cualquier error de autorización entra en
bucle infinito. `shouldAttemptRefresh()` solo devuelve `true` para 401.

### 4. `navigation.ts` — navegación declarativa

El `Spine` renderiza un modelo de datos sin saber qué es "Inventario". Los grupos
son las tres capas cognitivas del ADN (percepción, cognición, acción), que son
estables porque describen cómo piensa el sistema.

Las rutas se generan del mismo modelo: es imposible que el Spine ofrezca un
enlace que lleve a un 404.

## Estados de sesión

La sesión se compone de dos fuentes asíncronas, así que hay seis estados y
**ninguno cae en un caso por defecto silencioso**:

| Estado | Pantalla |
|---|---|
| `restoring` | `BootScreen` |
| `authenticating` | `BootScreen` ("verificando autorización") |
| `anonymous` | `LoginScene` |
| `active` | La aplicación |
| `no-membership` | `NoMembershipScreen` — problema administrativo, con salida |
| `error` | `SessionErrorScreen` — problema técnico, reintentable |

El router **reacciona** al estado: el login no navega manualmente. Así el mismo
camino sirve para login, recarga y cierre de sesión en otra pestaña.

## Presupuestos verificados

| Métrica | Objetivo | Medido |
|---|---|---|
| Bundle inicial (JS gzip) | ≤ 180 KB | **143 KB** |
| CSS (gzip) | — | 12 KB |
| Capas `backdrop-filter` | ≤ 4 | Contador en `useBlurBudget` |
| Animaciones simultáneas | ≤ 24 | Mesh y partículas son CSS: 0 registradas |
| Relojes `rAF` | 1 | 1 |

## Reglas de arquitectura

`design/` **no importa nada** de `shell/`, `features/`, `auth/` ni `lib/`. Es
publicable como paquete independiente. Esa es la garantía de que cualquier módulo
futuro lo reutilice sin arrastrar dominio.

```
scenes/ ─┐
shell/  ─┼─► design/ ─► (nada del proyecto)
features/┘
auth/ ─► lib/ ─► (contratos del backend)
```

## Accesibilidad

- Contraste AA verificado por par color/fondo (`DESIGN_SYSTEM.md` §2.6).
  `--mist-300` solo en ≥16px o peso ≥600: da 3.9:1.
- El color nunca es el único canal: `StatusIndicator` codifica el estado en
  **forma** (círculo, nodo, triángulo, octágono, círculo tachado).
- `prefers-reduced-motion` traduce el lenguaje de movimiento, no lo elimina. Se
  conservan siempre los cambios de color de estado y el foco visible.
- `prefers-reduced-transparency` sustituye Veil por superficie opaca.
- Foco visible con `--halo-focus`. Nunca `outline: none` sin sustituto.

## Por debajo de 1024px

La aplicación entra en **modo consulta**: se ven KPIs y alertas, no se puede
operar. Es una decisión de producto: operar un almacén desde un móvil es un error
que la interfaz no debe facilitar.

---

Documentación de diseño: `docs/design/` (8 documentos).
