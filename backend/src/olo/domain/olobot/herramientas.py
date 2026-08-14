"""EL CATÁLOGO DE HERRAMIENTAS DE OLOBOT.

─────────────────────────────────────────────────────────────────────────────
POR QUÉ TODO PASA POR AQUÍ

OLOBOT no responde de memoria. No sabe cuántos pallets hay en el CD de San José y no
debe inventárselo: lo consulta. Este archivo es la lista COMPLETA de cosas que puede
consultar y de cosas que puede proponer, y no hay ninguna otra vía.

Eso es lo que hace cumplible el «nunca dando información que no sea de la app». No se
consigue pidiéndoselo al modelo en el prompt —un prompt es una petición, no una
garantía—: se consigue porque la única forma que tiene de saber algo del almacén es
llamar a una de estas funciones, y todas leen la base de datos de este operador con
la sesión de este usuario.

─────────────────────────────────────────────────────────────────────────────
CADA HERRAMIENTA DECLARA TRES COSAS, Y LAS TRES SE COMPRUEBAN

    capacidad   qué nivel de bot hace falta para que se le OFREZCA
    permiso     qué permiso hace falta para que se EJECUTE
    escribe     si cambia algo, y entonces exige confirmación del usuario

La distinción entre las dos primeras es la que evita que el asistente sea una puerta
lateral. El nivel decide qué ve el modelo; el permiso decide qué ocurre de verdad, y
lo comprueba el mismo `require_permission` que la API. Ver `level.py`.

─────────────────────────────────────────────────────────────────────────────
LO QUE DELIBERADAMENTE NO ESTÁ

**Ninguna herramienta que amplíe accesos.** No hay «dar permiso», ni «asignar rol»,
ni «cambiar el nivel de OLOBOT de alguien». Un asistente que puede ampliar privilegios
convierte cualquier frase mal entendida en una escalada, y convierte el registro de
auditoría en algo que el propio bot puede preparar. Esas operaciones existen en la
pantalla de Configuración, con un humano leyendo la matriz.

**Ninguna herramienta de borrado.** Dar de baja un cliente o una entidad legal
arrastra dependencias y el backend responde 409 con las cifras; esa conversación se
tiene mirando la tabla, no de oído. El bot puede LLEVARTE a la fila —para eso está
`navegar`— y ahí decides tú.

**Ninguna consulta libre.** No hay `ejecutar_sql`. Sería la herramienta más potente y
la que haría inútil todo lo anterior: con SQL libre, el catálogo, el nivel y la
capacidad dejan de significar nada. RLS seguiría protegiendo el aislamiento entre
operadores, pero no el resto.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from olo.domain.olobot.level import Capacidad, Nivel, puede


@dataclass(frozen=True)
class Herramienta:
    """Una herramienta que se le ofrece al modelo.

    `parametros` es un JSON Schema, que es lo que la API del modelo espera. Se escribe
    a mano y no se genera de un modelo de Pydantic porque las descripciones son parte
    del contrato con el modelo: «el código del almacén, como OLO-CR» hace que acierte,
    y «string» hace que pregunte.
    """

    nombre: str
    descripcion: str
    capacidad: Capacidad
    #: El permiso que la ejecución exige. `None` solo en `navegar`, que no toca datos.
    permiso: str | None
    parametros: dict[str, Any] = field(default_factory=dict)
    escribe: bool = False

    def para_el_modelo(self) -> dict[str, Any]:
        """La forma que espera la API de OpenAI en `tools`."""
        return {
            "type": "function",
            "function": {
                "name": self.nombre,
                "description": self.descripcion,
                "parameters": self.parametros or {"type": "object", "properties": {}},
            },
        }


def _obj(propiedades: dict[str, Any], requeridos: list[str] | None = None) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": propiedades,
        "required": requeridos or [],
        "additionalProperties": False,
    }


_CODIGO_ALMACEN = {
    "type": "string",
    "description": (
        "Código del almacén, como OLO-CR. Si el usuario no lo dice y solo tiene "
        "acceso a uno, omítelo y se usa ese."
    ),
}


# ═══════════════════════════════════════════════════════════════════════════
# RUTAS DE LA APLICACIÓN
#
# La lista es cerrada A PROPÓSITO. `navegar` no acepta una ruta libre: acepta una de
# estas claves y el servidor la traduce. Con rutas libres, el modelo podría mandar al
# usuario a una URL que no existe —una pantalla en blanco— o a una externa, que es
# justo lo que «nunca información que no sea de la app» tiene que impedir.
#
# Salen de `frontend/src/shell/navigation.ts`. Si allí se añade una pantalla y aquí
# no, el bot simplemente no sabe llevarte: es un olvido visible, no un fallo.
# ═══════════════════════════════════════════════════════════════════════════
RUTAS: dict[str, tuple[str, str]] = {
    "inicio": ("/", "El panel de inicio, con el estado general del almacén"),
    "espacial": ("/spatial", "El catálogo espacial y el visor 3D de racks y ubicaciones"),
    "inventario": ("/inventory", "Inventario: existencias, ocupación y discrepancias"),
    "incidencias": ("/incidents", "Incidencias abiertas y su seguimiento"),
    "analitica": ("/analytics", "Analítica e indicadores"),
    "ia": ("/ai/projects", "Proyectos de IA: conjuntos de datos, anotación y entrenamiento"),
    "percepcion": ("/perception", "Percepción: trabajos de inferencia y sus detecciones"),
    "gemelo": ("/twin", "El gemelo digital del almacén"),
    "flota": ("/fleet", "Flota y nodos edge"),
    "configuracion": ("/admin", "Configuración del sistema: estructura, usuarios y permisos"),
    "auditoria": ("/audit", "Registro de auditoría"),
    "salud": ("/vitals", "Salud del sistema"),
    "integracion": ("/integration", "Integraciones con sistemas externos"),
}


# ═══════════════════════════════════════════════════════════════════════════
# EL CATÁLOGO
# ═══════════════════════════════════════════════════════════════════════════
CATALOGO: tuple[Herramienta, ...] = (
    # ── Navegación ─────────────────────────────────────────────────────────
    Herramienta(
        nombre="navegar",
        descripcion=(
            "Lleva al usuario a una pantalla de la aplicación. Úsalo cuando lo que "
            "pide se ve mejor en su pantalla que descrito en texto, o cuando pide "
            "explícitamente ir a algún sitio. No inventes rutas: solo estas claves."
        ),
        capacidad=Capacidad.NAVEGAR,
        permiso=None,
        parametros=_obj(
            {
                "destino": {
                    "type": "string",
                    "enum": list(RUTAS),
                    "description": "La pantalla a la que llevar al usuario",
                },
                "porque": {
                    "type": "string",
                    "description": (
                        "Una frase corta que se le enseña al usuario explicando por qué ahí"
                    ),
                },
            },
            ["destino"],
        ),
    ),
    # ── Lectura: estructura ────────────────────────────────────────────────
    Herramienta(
        nombre="listar_almacenes",
        descripcion=(
            "Los almacenes a los que este usuario tiene acceso, con su código, "
            "nombre, estado y cuántas ubicaciones tiene su catálogo espacial. "
            "Empieza por aquí cuando no sepas de qué almacén se habla."
        ),
        capacidad=Capacidad.LEER,
        permiso="warehouses:read",
        parametros=_obj({}),
    ),
    Herramienta(
        nombre="resumen_ocupacion",
        descripcion=(
            "Cuántas ubicaciones tiene un almacén, cuántas están ocupadas y el "
            "porcentaje, más el total de pallets y unidades. Es la respuesta a "
            "«¿cómo está de lleno el almacén?»."
        ),
        capacidad=Capacidad.LEER,
        permiso="inventory:read",
        parametros=_obj({"almacen": _CODIGO_ALMACEN}),
    ),
    Herramienta(
        nombre="racks_mas_llenos",
        descripcion=(
            "Los racks con más ocupación de un almacén, con su porcentaje, pallets "
            "y cuántas ubicaciones tienen bloqueadas. Para «¿qué rack está saturado?»."
        ),
        capacidad=Capacidad.LEER,
        permiso="inventory:read",
        parametros=_obj(
            {
                "almacen": _CODIGO_ALMACEN,
                "cuantos": {
                    "type": "integer",
                    "description": "Cuántos devolver, de 1 a 20. Por omisión 10",
                },
            }
        ),
    ),
    Herramienta(
        nombre="buscar_ubicacion",
        descripcion=(
            "Qué hay en una ubicación concreta por su código: si está ocupada, "
            "cuántos pallets y unidades, de qué clientes y la primera caducidad."
        ),
        capacidad=Capacidad.LEER,
        permiso="inventory:read",
        parametros=_obj(
            {
                "codigo": {
                    "type": "string",
                    "description": "Código de la ubicación, tal como aparece en el catálogo",
                },
                "almacen": _CODIGO_ALMACEN,
            },
            ["codigo"],
        ),
    ),
    Herramienta(
        nombre="discrepancias_inventario",
        descripcion=(
            "Ubicaciones donde el catálogo espacial y el WMS se contradicen: el WMS "
            "dice que hay algo y el catálogo dice que está libre, o al revés. Es la "
            "respuesta a «¿donde hay descuadres de inventario?»."
        ),
        capacidad=Capacidad.LEER,
        permiso="inventory:read",
        parametros=_obj(
            {
                "almacen": _CODIGO_ALMACEN,
                "cuantos": {
                    "type": "integer",
                    "description": "Cuántas devolver, de 1 a 50. Por omisión 20",
                },
            }
        ),
    ),
    # ── Lectura: percepción e IA ───────────────────────────────────────────
    Herramienta(
        nombre="trabajos_percepcion",
        descripcion=(
            "Los últimos trabajos de inferencia: su estado, el modelo que usaron y "
            "cuántas detecciones produjeron. Para «¿cómo va el análisis del vídeo?»."
        ),
        capacidad=Capacidad.LEER,
        permiso="perception:read",
        parametros=_obj(
            {
                "estado": {
                    "type": "string",
                    "description": "Filtrar por estado, si el usuario lo pide",
                    "enum": ["queued", "running", "succeeded", "failed", "cancelled"],
                },
                "cuantos": {"type": "integer", "description": "De 1 a 20. Por omisión 10"},
            }
        ),
    ),
    Herramienta(
        nombre="modelos_publicados",
        descripcion=(
            "Los modelos de visión publicados y listos para usar, con su versión y "
            "sus métricas. Para «¿qué modelo tenemos para contar pallets?»."
        ),
        capacidad=Capacidad.LEER,
        permiso="perception:read",
        parametros=_obj({}),
    ),
    # ── Lectura: configuración ─────────────────────────────────────────────
    Herramienta(
        nombre="estructura_operador",
        descripcion=(
            "La estructura del operador: países en operación, entidades legales, "
            "clientes, almacenes y usuarios, con sus recuentos. Todo filtrado por "
            "lo que este usuario puede ver."
        ),
        capacidad=Capacidad.LEER,
        permiso="clients:read",
        parametros=_obj({}),
    ),
    Herramienta(
        nombre="quien_soy",
        descripcion=(
            "Quién es el usuario con el que hablas: su nombre, su operador, sus "
            "roles, su nivel de OLOBOT y a qué almacenes tiene acceso. Úsalo cuando "
            "pregunte por sus propios permisos o por qué no puede hacer algo."
        ),
        capacidad=Capacidad.LEER,
        permiso=None,
        parametros=_obj({}),
    ),
    Herramienta(
        nombre="quien_usa_olobot",
        descripcion=(
            "Qué nivel de OLOBOT tiene cada usuario del operador. Solo informativo: "
            "cambiarlo se hace en Configuración, no desde aquí."
        ),
        capacidad=Capacidad.LEER,
        permiso="olobot:admin",
        parametros=_obj({}),
    ),
    # ── Escritura de operación ─────────────────────────────────────────────
    Herramienta(
        nombre="marcar_ubicacion_bloqueada",
        descripcion=(
            "Marca una ubicación como bloqueada o la desbloquea, con un motivo. "
            "Bloqueada significa que no se debe almacenar ahí. Exige que el usuario "
            "confirme antes de aplicarse."
        ),
        capacidad=Capacidad.ESCRIBIR_OPERACION,
        #  `locations:write`, no un «spatial:write» que no existe: el catálogo de
        #  permisos separa ubicaciones, áreas y observaciones, y bloquear un hueco es
        #  editar la ubicación.
        permiso="locations:write",
        parametros=_obj(
            {
                "codigo": {"type": "string", "description": "Código de la ubicación"},
                "bloqueada": {
                    "type": "boolean",
                    "description": "true para bloquear, false para desbloquear",
                },
                "motivo": {
                    "type": "string",
                    "description": "Por qué. Queda en el registro de auditoría",
                },
                "almacen": _CODIGO_ALMACEN,
            },
            ["codigo", "bloqueada", "motivo"],
        ),
        escribe=True,
    ),
    # ── Escritura de configuración ─────────────────────────────────────────
    Herramienta(
        nombre="renombrar_cliente",
        descripcion=(
            "Corrige el nombre de un cliente. Para errores de escritura, no para "
            "cambiar de cliente. Exige que el usuario confirme antes de aplicarse."
        ),
        capacidad=Capacidad.ESCRIBIR_CONFIGURACION,
        permiso="clients:update",
        parametros=_obj(
            {
                "codigo": {"type": "string", "description": "Código del cliente, como COFERSA"},
                "nombre": {"type": "string", "description": "El nombre correcto"},
            },
            ["codigo", "nombre"],
        ),
        escribe=True,
    ),
    Herramienta(
        nombre="cambiar_estado_almacen",
        descripcion=(
            "Activa o desactiva un almacén. Desactivarlo lo saca de la operación "
            "para todo el equipo. Exige que el usuario confirme antes de aplicarse."
        ),
        capacidad=Capacidad.ESCRIBIR_CONFIGURACION,
        permiso="warehouses:update",
        parametros=_obj(
            {
                "almacen": {"type": "string", "description": "Código del almacén"},
                "estado": {"type": "string", "enum": ["active", "inactive"]},
            },
            ["almacen", "estado"],
        ),
        escribe=True,
    ),
)

_POR_NOMBRE: dict[str, Herramienta] = {h.nombre: h for h in CATALOGO}


def por_nombre(nombre: str) -> Herramienta | None:
    """La herramienta, o `None` si el modelo se inventó el nombre.

    Que pueda inventárselo no es hipotético: pasa. Devolver `None` y contestarle «esa
    herramienta no existe» lo corrige en el turno siguiente; lanzar una excepción
    rompería la conversación por un error del que el usuario no tiene ni noticia.
    """
    return _POR_NOMBRE.get(nombre)


def herramientas_para(nivel: Nivel | str, permisos: frozenset[str]) -> tuple[Herramienta, ...]:
    """Las herramientas que este usuario, con este nivel, puede llegar a usar.

    Se filtra por las DOS cosas a la vez, y aquí está el porqué de que se filtre
    también por permiso y no solo por nivel: ofrecerle al modelo una herramienta que
    va a recibir 403 le hace intentarla y contarle al usuario que «hubo un error». Con
    la herramienta fuera, dice lo que es cierto: que eso no está a su alcance.

    El filtro NO sustituye a la comprobación en la ejecución. Un catálogo es una
    sugerencia para el modelo; la autoridad sigue estando en `require_permission`.
    """
    return tuple(
        h
        for h in CATALOGO
        if puede(nivel, h.capacidad) and (h.permiso is None or h.permiso in permisos)
    )
