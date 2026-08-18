"""Servicio del dominio espacial. Solo lectura.

Lo que corresponde a esta capa: construir y validar cursores, decidir cuándo se
paga un `count`, y traducir «no hay fila» a 404. Las reglas de forma están en la
base (CHECK, guardianes) y los agregados en las vistas.
"""

from __future__ import annotations

import base64
import binascii
import re
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any
from uuid import UUID, uuid4

from olo.core.errors import BusinessRuleError, ForbiddenError, NotFoundError
from olo.domain.inspeccion import clasificar_cambio
from olo.domain.perception.media import BUCKET as BUCKET_PERCEPCION
from olo.domain.spatial_assets import (
    BUCKET_FIGURAS,
    CATEGORIAS,
    ruta_de_figura,
    validar_figura,
    validar_medidas,
)
from olo.repositories.spatial import SpatialRepository
from olo.security.authorization import can_access_warehouse, is_platform_owner
from olo.storage.supabase_storage import StorageClient, StorageError

if TYPE_CHECKING:
    from collections.abc import Sequence

    from sqlalchemy.ext.asyncio import AsyncSession

    from olo.core.config import Settings
    from olo.core.context import TenantContext

MAX_PAGE_SIZE = 200
DEFAULT_PAGE_SIZE = 50

# Profundidad máxima del árbol que se puede pedir de una vez. 4 cubre
# site → rack → bay → (hoja) con margen; pedir más de golpe devolvería los 2.701
# cuerpos del almacén real, que es justo lo que la navegación por niveles evita.
MAX_TREE_DEPTH = 6
DEFAULT_TREE_DEPTH = 2

# Tope de `page` para el modo por número de página. Sin él, `page=1000000` con
# `page_size=200` produce un `OFFSET 200000000` que la base intenta ejecutar.
MAX_PAGE = 10_000


# Lo que se devuelve cuando una ubicacion no tiene extras. Antes estaba escrito dos
# veces en el modulo, y anadir `world_x_m` habria dejado uno de los dos caminos
# —lista y detalle— devolviendo un campo menos que el otro sin que nada fallara.
_EXTRAS_VACIO: dict[str, Any] = {
    "capacity_declared_unlimited": False,
    "logical_column": None,
    "world_x_m": None,
    "world_y_m": None,
    "world_z_m": None,
}


@dataclass(frozen=True, slots=True)
class Page:
    items: Sequence[dict[str, Any]]
    next_cursor: str | None
    total: int | None
    page: int | None
    total_pages: int | None


def _encode_cursor(code: str, entity_id: UUID) -> str:
    raw = f"{code}\x00{entity_id}".encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _decode_cursor(cursor: str) -> tuple[str, UUID]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        code, _, raw_id = base64.urlsafe_b64decode(padded).decode().partition("\x00")
        return code, UUID(raw_id)
    except (ValueError, binascii.Error, UnicodeDecodeError) as exc:
        raise BusinessRuleError("El cursor de paginación no es válido") from exc


def _encode_code_cursor(code: str) -> str:
    return base64.urlsafe_b64encode(code.encode()).decode().rstrip("=")


def _decode_code_cursor(cursor: str) -> str:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        return base64.urlsafe_b64decode(padded).decode()
    except (ValueError, binascii.Error, UnicodeDecodeError) as exc:
        raise BusinessRuleError("El cursor de paginación no es válido") from exc


#: Las columnas de la lectura que llevan RUTAS de recortes. Salen de la base y no pueden
#: salir por la API: lo que viaja son las URLs firmadas, y `ApiModel` prohibe los campos
#: de mas para que una deriva asi no pase inadvertida.
RUTAS_DE_RECORTE = ("crop_location_path", "crop_content_path", "crop_pallet_path")


#: El instante va en el NOMBRE del recorte: `recorte_<ms>_<indice>_<clase>.jpg`. Lo pone el
#: worker y la ruta la genera el servidor, asi que leerlo aqui no es adivinar un formato
#: ajeno — es leer lo que este mismo sistema escribio—.
_MS_DEL_RECORTE = re.compile(r"/recorte_(\d+)_")


def _instante(ruta: Any) -> int | None:
    """El milisegundo del que salio ese recorte, o `None`.

    ── POR QUE HACE FALTA ────────────────────────────────────────────────────────

    Los tres recortes de una lectura NO son del mismo fotograma. Cada eje elige su mejor
    deteccion por separado dentro de la escena, y una escena abarca varios fotogramas.
    Medido en el recorrido real de dataset7.2, una misma lectura tenia la etiqueta en el
    ms 233, el contenido en el 1.167 y el QR del pallet en el 700: casi un segundo de
    diferencia, y a la velocidad a la que va el dron eso es otro sitio del rack.

    Sin el instante, las tres imagenes se leen como una foto del mismo momento y no lo son
    — reportado tal cual: «la del pallet no es correcta»—. Con el instante, quien mira ve
    que son tres momentos y puede juzgar cual vale.
    """
    if not ruta:
        return None
    m = _MS_DEL_RECORTE.search(str(ruta))
    return int(m.group(1)) if m else None


def _con_firmas(fila: dict[str, Any], firmadas: dict[str, Any]) -> dict[str, Any]:
    """La lectura con las URLs firmadas EN LUGAR de las rutas, no ademas de ellas.

    ── LO QUE COSTO NO HACER ESTO ────────────────────────────────────────────────

    `{**fila, **firmadas}` anadia las URLs y dejaba las rutas. `LocationInspectionOut` no
    las declara —y no debe—, asi que Pydantic rechazaba CADA fila con «extra inputs are
    not permitted» y el endpoint respondia 500 a toda peticion.

    El efecto no se leia como un error: la capa «Inspeccion» del visor salia vacia, los
    huecos del plano 3D sin color, y en la pantalla no habia ningun mensaje de fallo. Se
    reconciliaba, se veian las ocho lecturas en la tabla, y el mapa seguia en blanco.
    Reportado como «lo que reconcilia no se ve en Spatial».
    """
    instantes = {
        "crop_location_ms": _instante(fila.get("crop_location_path")),
        "crop_content_ms": _instante(fila.get("crop_content_path")),
        "crop_pallet_ms": _instante(fila.get("crop_pallet_path")),
    }
    return (
        {k: v for k, v in fila.items() if k not in RUTAS_DE_RECORTE} | firmadas | instantes
    )


class SpatialService:
    def __init__(
        self,
        session: AsyncSession,
        ctx: TenantContext,
        settings: Settings | None = None,
        access_token: str | None = None,
    ) -> None:
        """`settings` y `access_token` solo hacen falta para FIRMAR los recortes.

        Opcionales porque casi nada de este servicio toca Storage: el arbol, el alzado y
        las ubicaciones no. Exigirlos obligaria a los sitios que solo consultan catalogo a
        pasar dos cosas que no usan — y sin ellos la capa de inspeccion sigue funcionando,
        solo que sin imagenes.
        """
        self._session = session
        self._ctx = ctx
        self._repo = SpatialRepository(session)
        self._storage = (
            StorageClient(settings, access_token)
            if settings is not None and access_token is not None
            else None
        )

    # ── Resumen ───────────────────────────────────────────────────────────
    async def list_summaries(self) -> list[dict[str, Any]]:
        return await self._repo.summaries()

    async def get_summary(self, warehouse_id: UUID) -> dict[str, Any]:
        row = await self._repo.summary(warehouse_id)
        if row is None:
            # Un almacén de otro tenant es invisible por RLS y llega aquí como
            # «no existe». 404, no 403: un 403 confirmaría que existe.
            raise NotFoundError(f"No existe el almacén {warehouse_id}")
        return row

    # ── Árbol ─────────────────────────────────────────────────────────────
    async def get_tree(
        self,
        warehouse_id: UUID,
        *,
        depth: int = DEFAULT_TREE_DEPTH,
        parent_id: UUID | None = None,
    ) -> list[dict[str, Any]]:
        # El almacén debe existir y ser accesible ANTES de recorrer el árbol: si
        # no, un almacén inexistente devolvería una lista vacía y el cliente no
        # podría distinguirlo de un almacén sin nodos.
        await self.get_summary(warehouse_id)
        profundidad = max(0, min(depth, MAX_TREE_DEPTH))
        return await self._repo.tree(
            warehouse_id, max_depth=profundidad, parent_id=parent_id
        )

    async def get_node(self, node_id: UUID) -> dict[str, Any]:
        row = await self._repo.node(node_id)
        if row is None:
            raise NotFoundError(f"No existe el nodo {node_id}")
        return row

    async def get_children(
        self,
        node_id: UUID,
        *,
        limit: int = DEFAULT_PAGE_SIZE,
        cursor: str | None = None,
        with_total: bool = False,
    ) -> Page:
        await self.get_node(node_id)
        size = max(1, min(limit, MAX_PAGE_SIZE))
        code = _decode_code_cursor(cursor) if cursor else None

        rows = await self._repo.children(node_id, limit=size + 1, cursor_code=code)
        items, siguiente = self._recortar_por_codigo(rows, size, "node_code")
        total = await self._repo.count_children(node_id) if with_total else None
        return Page(
            items=items,
            next_cursor=siguiente,
            total=total,
            page=None,
            total_pages=self._paginas(total, size),
        )

    # ── Plano de planta ───────────────────────────────────────────────────
    async def get_floor_plan(
        self,
        warehouse_id: UUID,
        *,
        limit: int = DEFAULT_PAGE_SIZE,
        cursor: str | None = None,
        node_function: str | None = None,
        search: str | None = None,
        with_total: bool = False,
    ) -> Page:
        await self.get_summary(warehouse_id)
        size = max(1, min(limit, MAX_PAGE_SIZE))
        code = _decode_code_cursor(cursor) if cursor else None

        rows = await self._repo.floor_plan(
            warehouse_id,
            limit=size + 1,
            cursor_code=code,
            node_function=node_function,
            search=search,
        )
        items, siguiente = self._recortar_por_codigo(rows, size, "rack_code")
        # El total de racks es un `count` sobre 3.048 nodos, no sobre 29.310
        # ubicaciones: 4,7 ms medidos. Aquí sí se puede pagar siempre... pero no
        # se paga, porque el cliente que dibuja el plano no lo usa y el que
        # pagina sí. Se pide.
        total = await self._repo.count_floor_plan(warehouse_id) if with_total else None
        return Page(
            items=items,
            next_cursor=siguiente,
            total=total,
            page=None,
            total_pages=self._paginas(total, size),
        )

    # ── Alzado ────────────────────────────────────────────────────────────
    async def get_rack_front_view(self, rack_id: UUID) -> dict[str, Any]:
        nodo = await self.get_node(rack_id)
        celdas = await self._repo.rack_front_view(rack_id)

        # Las dimensiones se calculan aquí, una vez, en lugar de dejar que el
        # cliente haga `max()` sobre las celdas para dimensionar la rejilla.
        niveles = [c["level"] for c in celdas if c["level"] is not None]
        posiciones = [c["position"] for c in celdas if c["position"] is not None]
        cuerpos = {c["bay_id"] for c in celdas}

        return {
            "rack_id": nodo["node_id"],
            "rack_code": nodo["node_code"],
            "rack_external_code": nodo["external_code"],
            "node_function": nodo["node_function"],
            "function_label": nodo["function_label"],
            "bay_count": len(cuerpos),
            "max_level": max(niveles) if niveles else None,
            "max_position": max(posiciones) if posiciones else None,
            "cells": celdas,
        }

    # ── La capa «Inspección» del visor ────────────────────────────────────
    async def get_estado_observado(
        self, warehouse_id: UUID, rack_id: UUID | None = None
    ) -> list[dict[str, Any]]:
        """Lo último que se vio en cada hueco, frente a lo que el WMS declara.

        Es lo que le faltaba al mapa. El visor pintaba el catálogo y la ocupación
        DECLARADA; lo que la cámara había visto se quedaba en la pantalla de
        reconciliación, en una tabla, sin llegar nunca al sitio donde se mira el almacén.

        Que el almacén exista se comprueba antes de consultar: sin eso, un almacén de otro
        tenant —invisible por RLS— devolvería una lista vacía y el cliente lo leería como
        «aquí no se ha inspeccionado nada», que es una conclusión muy distinta.
        """
        await self.get_summary(warehouse_id)
        if rack_id is not None:
            await self.get_node(rack_id)
        filas = await self._repo.estado_observado(warehouse_id, rack_id)
        return await self._firmar_pruebas(filas)

    async def _firmar_pruebas(
        self, filas: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """Cambia las RUTAS de los recortes por URLs firmadas de una hora.

        ── POR QUE SE FIRMA AQUI Y NO SE GUARDA FIRMADO ──────────────────────────

        Una firma caduca en una hora. Guardarla en la base seria guardar basura con fecha:
        a la segunda vez que alguien abriera el hueco, la imagen daria 403 sin decir por
        que. La ruta es permanente; la firma se pide cuando hace falta.

        Sin credenciales de Storage no se firma y se devuelven las filas tal cual, con las
        URLs a `None`: la lectura sigue siendo util —el estado, los codigos, las fechas— y
        perderla entera por no poder enseñar una foto seria un mal cambio.
        """
        if self._storage is None:
            return [
                _con_firmas(
                    f,
                    {"crop_location_url": None, "crop_content_url": None,
                     "crop_pallet_url": None},
                )
                for f in filas
            ]
        salida: list[dict[str, Any]] = []
        for f in filas:
            firmadas: dict[str, Any] = {}
            for campo, destino in (
                ("crop_location_path", "crop_location_url"),
                ("crop_content_path", "crop_content_url"),
                ("crop_pallet_path", "crop_pallet_url"),
            ):
                ruta = f.get(campo)
                url = None
                if ruta:
                    try:
                        url = await self._storage.sign_download(BUCKET_PERCEPCION, ruta, 3600)
                    except StorageError:
                        #  Un objeto que ya no esta —borrado con la inspeccion— no puede
                        #  tumbar la consulta del mapa entero. Se queda sin imagen y el
                        #  resto de la lectura sigue.
                        url = None
                firmadas[destino] = url
            salida.append(_con_firmas(f, firmadas))
        return salida

    async def get_cobertura_inspeccion(self, warehouse_id: UUID) -> dict[str, Any]:
        """Cuanto del almacen se ha mirado, y cuando.

        Sin este numero, «cero discrepancias» significa dos cosas a la vez —«todo cuadra»
        y «no has mirado»— y son la conclusion contraria. Medido hoy: 4 huecos con lectura
        de 29.312.
        """
        await self.get_summary(warehouse_id)
        return await self._repo.cobertura_inspeccion(warehouse_id)

    async def get_cambios_inspeccion(
        self, warehouse_id: UUID, rack_id: UUID | None = None
    ) -> list[dict[str, Any]]:
        """Que cambio entre el ultimo recorrido y el anterior, hueco a hueco.

        ── LOS CUATRO VEREDICTOS, Y POR QUE IMPORTAN ─────────────────────────────

            resuelto     antes no cuadraba y ahora si    → el trabajo sirvio
            persiste     no cuadraba y sigue igual       → nadie lo esta arreglando
            nuevo        cuadraba y ahora no             → paso algo desde el ultimo vuelo
            cambio       el pallet observado es otro     → se movio mercancia

        El segundo es el que nadie mide y el que mas dice: una discrepancia que aguanta
        tres vuelos no es un hallazgo, es un proceso roto.

        Lo que sigue cuadrando NO sale. Un listado de «cambios» donde la mayoria de las
        filas dicen «igual que antes» es una tabla que nadie lee dos veces.
        """
        await self.get_summary(warehouse_id)
        if rack_id is not None:
            await self.get_node(rack_id)

        filas = await self._repo.cambios_entre_recorridos(warehouse_id, rack_id)
        salida: list[dict[str, Any]] = []
        for f in filas:
            #  La clasificacion vive en el dominio, con la MISMA lista de estados que decide
            #  que abre incidencia. Escribirla aqui otra vez es como se separan las dos y
            #  como el mapa acaba diciendo «resuelto» de algo abierto en la bandeja.
            veredicto = clasificar_cambio(
                estado_antes=f["status_before"],
                estado_ahora=f["status_now"],
                pallet_antes=f["pallet_before"],
                pallet_ahora=f["pallet_now"],
            )
            if veredicto is None:
                #  Igual que antes y bien. No sale: una lista de cambios donde casi todo
                #  dice «igual» deja de leerse, y entonces tampoco se leen los que importan.
                continue
            salida.append({**f, "verdict": veredicto})
        return salida

    # ── Las medidas del almacen (0092) ────────────────────────────────────
    async def get_medidas(self, warehouse_id: UUID) -> list[dict[str, Any]]:
        """Las medidas de un almacen: la fila por defecto y las excepciones por familia."""
        await self.get_summary(warehouse_id)
        return await self._repo.medidas(warehouse_id)

    async def guardar_medidas(
        self, warehouse_id: UUID, familia: str | None, valores: dict[str, Any]
    ) -> dict[str, Any]:
        """Crea o corrige la fila de ese ambito.

        La familia se normaliza a mayusculas y se recorta: `rcl`, `RCL ` y `RCL` son el
        mismo prefijo, y tres filas distintas serian tres verdades sobre los mismos racks.
        Vacia se guarda como `None`, que es «las medidas por defecto del almacen».
        """
        await self.get_summary(warehouse_id)
        fam = (familia or "").strip().upper() or None
        if not valores:
            raise BusinessRuleError(
                "No se mando ninguna medida. Guardar una fila vacia no la crea: hasta que "
                "alguien mida algo, el visor sigue con sus convenciones."
            )
        return await self._repo.guardar_medidas(
            tenant_id=self._ctx.tenant_id,
            warehouse_id=warehouse_id,
            familia=fam,
            valores=valores,
        )

    # ── Ubicaciones ───────────────────────────────────────────────────────
    async def list_locations(
        self,
        *,
        limit: int = DEFAULT_PAGE_SIZE,
        cursor: str | None = None,
        page: int | None = None,
        warehouse_id: UUID | None = None,
        rack_id: UUID | None = None,
        bay_id: UUID | None = None,
        status: str | None = None,
        situation: str | None = None,
        code_form: str | None = None,
        level: int | None = None,
        search: str | None = None,
        with_total: bool = False,
    ) -> Page:
        size = max(1, min(limit, MAX_PAGE_SIZE))

        if cursor and page:
            # Los dos a la vez es ambiguo: ¿la página 5 desde el cursor, o la 5
            # absoluta? Se rechaza en lugar de elegir en silencio.
            raise BusinessRuleError(
                "Use `cursor` o `page`, no los dos: son dos formas de decir dónde "
                "empezar y juntas no significan nada"
            )
        if page is not None and page > MAX_PAGE:
            raise BusinessRuleError(
                f"`page` no puede pasar de {MAX_PAGE}: use `cursor` para recorridos "
                "profundos, cuyo coste no crece con la profundidad"
            )

        cursor_code: str | None = None
        cursor_id: UUID | None = None
        if cursor:
            cursor_code, cursor_id = _decode_cursor(cursor)

        offset = (page - 1) * size if page and page > 1 else None

        rows = await self._repo.locations(
            limit=size + 1,
            cursor_code=cursor_code,
            cursor_id=cursor_id,
            offset=offset,
            warehouse_id=warehouse_id,
            rack_id=rack_id,
            bay_id=bay_id,
            status=status,
            situation=situation,
            code_form=code_form,
            level=level,
            search=search,
        )

        hay_mas = len(rows) > size
        items = list(rows[:size])
        siguiente = (
            _encode_cursor(items[-1]["full_code"], items[-1]["location_id"])
            if hay_mas and items
            else None
        )

        # Los dos campos que la vista no expone, en UNA consulta por página y no
        # una por fila: con `page_size=200` la diferencia son 200 viajes al
        # pooler, y cada viaje son 260 ms medidos.
        extras = await self._repo.location_extras([i["location_id"] for i in items])
        vacio = _EXTRAS_VACIO
        enriquecidas = [{**dict(i), **extras.get(i["location_id"], vacio)} for i in items]

        total = None
        if with_total:
            total = await self._repo.count_locations(
                warehouse_id=warehouse_id,
                rack_id=rack_id,
                bay_id=bay_id,
                status=status,
                situation=situation,
                code_form=code_form,
                level=level,
                search=search,
            )

        return Page(
            items=enriquecidas,
            next_cursor=siguiente,
            total=total,
            page=page,
            total_pages=self._paginas(total, size),
        )

    async def get_location(self, location_id: UUID) -> dict[str, Any]:
        row = await self._repo.location(location_id)
        if row is None:
            raise NotFoundError(f"No existe la ubicación {location_id}")
        extras = await self._repo.location_extras([row["location_id"]])
        return {
            **dict(row),
            **extras.get(
                row["location_id"],
                _EXTRAS_VACIO,
            ),
        }

    # ── Auxiliares ────────────────────────────────────────────────────────
    @staticmethod
    def _recortar_por_codigo(
        rows: Sequence[dict[str, Any]], size: int, campo: str
    ) -> tuple[list[dict[str, Any]], str | None]:
        """Recorta la fila extra y devuelve el cursor de la siguiente página.

        Se pide `size + 1` fila para saber si hay más SIN un `count`. La fila
        extra no se devuelve: es solo la respuesta a «¿hay más?».
        """
        hay_mas = len(rows) > size
        items = list(rows[:size])
        siguiente = _encode_code_cursor(items[-1][campo]) if hay_mas and items else None
        return items, siguiente

    @staticmethod
    def _paginas(total: int | None, size: int) -> int | None:
        if total is None:
            return None
        return max(1, -(-total // size))

    # ══════════════════════════════════════════════════════════════════════
    # FIGURAS 3D (0093)
    # ══════════════════════════════════════════════════════════════════════

    def _exige_storage(self) -> StorageClient:
        """El cliente de Storage, o un error que dice QUE falta.

        El servicio se puede construir sin credenciales —el arbol, el alzado y las
        ubicaciones no tocan Storage— pero las figuras si: sin esto, un `None` reventaria
        mas adentro con un `AttributeError` que no explica nada.
        """
        if self._storage is None:
            raise BusinessRuleError(
                "Esta operacion necesita credenciales de Storage y el servicio se "
                "construyo sin ellas."
            )
        return self._storage

    async def preparar_figura(
        self,
        *,
        original_filename: str,
        content_type: str,
        byte_count: int,
        para_plataforma: bool = False,
    ) -> dict[str, Any]:
        """Paso 1 de 3: reservar sitio en el bucket y decir donde subir.

        ── POR QUE TRES PASOS Y NO UNO ───────────────────────────────────────────

        El mismo patron que la subida de un video, y por el mismo motivo: el binario NO
        atraviesa el backend. Un `.glb` de 60 MB pasando por el proceso web solo para
        reenviarlo gastaria memoria del servidor sin añadir nada.

        Y no se escribe ninguna fila todavia. Una fila de catalogo sin bytes es una figura
        que aparece en el selector y no se puede dibujar; si la subida se abandona a medias
        —y se abandona—, lo que queda es nada en vez de una entrada rota.

        El `model_id` se genera AQUI y viaja al cliente porque la ruta se deriva de el. Al
        registrar, el servidor recalcula la ruta con el mismo id: asi no hay forma de subir
        a un sitio y reclamar otro.
        """
        motivo = validar_figura(content_type, byte_count)
        if motivo:
            raise BusinessRuleError(motivo)

        #  La biblioteca COMUN solo la escribe la plataforma. Se comprueba aqui ademas de en
        #  la politica del bucket: sin esto, quien lo intente recibiria un fallo de subida
        #  opaco en vez de un 403 que dice de quien es esa biblioteca.
        if para_plataforma and not await is_platform_owner(self._session):
            raise ForbiddenError(
                "La biblioteca comun es de la plataforma. Sube la figura a la tuya."
            )

        model_id = uuid4()
        duenyo = None if para_plataforma else self._ctx.tenant_id
        ruta = ruta_de_figura(duenyo, model_id, original_filename, content_type)
        return {
            "model_id": model_id,
            "bucket": BUCKET_FIGURAS,
            "object_path": ruta,
            "upload_url": self._exige_storage().upload_endpoint(BUCKET_FIGURAS, ruta),
        }

    async def registrar_figura(
        self,
        *,
        model_id: UUID,
        original_filename: str,
        content_type: str,
        datos: dict[str, Any],
        para_plataforma: bool = False,
    ) -> dict[str, Any]:
        """Paso 3 de 3: el modelo ya esta subido; se registra en el catalogo.

        ── SE COMPRUEBA QUE EL ARCHIVO ESTE ──────────────────────────────────────

        Con un `head` al bucket, antes de escribir la fila. Es lo que evita el caso peor: una
        figura en el selector que al abrirse no descarga nada, y nadie sabe si el problema es
        el modelo, la red o el permiso.

        La ruta se RECALCULA con el mismo id, nombre y tipo. No se acepta la que mande el
        cliente: es la frontera del aislamiento entre operadores.
        """
        motivo = validar_medidas(
            datos.get("size_x_m"), datos.get("size_y_m"), datos.get("size_z_m")
        )
        if motivo:
            raise BusinessRuleError(motivo)

        if str(datos.get("kind")) not in CATEGORIAS:
            raise BusinessRuleError(
                f"La categoria {datos.get('kind')!r} no existe. Las validas son: "
                f"{', '.join(sorted(CATEGORIAS))}."
            )

        if para_plataforma and not await is_platform_owner(self._session):
            raise ForbiddenError("La biblioteca comun es de la plataforma.")

        duenyo = None if para_plataforma else self._ctx.tenant_id
        ruta = ruta_de_figura(duenyo, model_id, original_filename, content_type)

        almacen = self._exige_storage()
        if await almacen.head(BUCKET_FIGURAS, ruta) is None:
            raise BusinessRuleError(
                "El archivo no esta en el bucket. Sube el modelo antes de registrarlo: "
                "una figura del catalogo que no se puede descargar es peor que ninguna."
            )

        valores = {k: v for k, v in datos.items() if k != "kind"}
        valores["kind"] = datos["kind"]
        valores["glb_path"] = ruta
        fila = await self._repo.crear_figura(
            model_id=model_id, tenant_id=duenyo, valores=valores
        )
        #  FIRMADA, como el resto. Devolver la fila cruda dejaba `glb_path` y `thumb_path`
        #  dentro, y `AssetOut` no los declara: 500 en la peticion que acaba de registrar
        #  bien la figura. Es la tercera vez que este defecto aparece —los recortes de las
        #  lecturas dos veces— y siempre con el mismo sintoma: todo funciona y la respuesta
        #  falla.
        return await self._firmar_figura(fila)

    async def ocupacion_por_hueco(self, warehouse_id: UUID) -> dict[str, Any]:
        """Lo que el WMS declaro de cada hueco, listo para pintar y COMPACTADO.

        ── DONDE SE COMPACTA Y POR QUE AQUI ──────────────────────────────────────

        La consulta devuelve una fila por celda con su palabra: `OCUP` aparece 7.090 veces en
        30 racks. Mandarla 7.090 veces es la diferencia entre 4,4 MB y 350 KB, asi que se
        construye un diccionario de palabras y cada celda lleva su INDICE.

        Se hace en el servicio y no en la consulta porque es una decision de transporte, no
        del dato: la vista sigue sirviendo la palabra entera para quien la necesite tal cual.

        ── LA FECHA VIAJA CON LOS DATOS ──────────────────────────────────────────

        Y no en otra peticion. Un plano pintado de verde y rojo se lee como el estado de
        ahora mismo; si el dato tiene veinte dias, la pantalla tiene que poder decirlo sin
        pedir nada mas — y con dos peticiones habria un instante en que el color esta y la
        fecha no—.
        """
        if not await can_access_warehouse(self._session, warehouse_id):
            raise ForbiddenError("No tienes acceso a ese almacen")

        filas = await self._repo.ocupacion_por_hueco(warehouse_id)

        sin_celda = 0
        vocabulario: dict[str, int] = {}
        por_rack: dict[str, list[list[int]]] = {}
        conflictos = 0
        for f in filas:
            #  Sin cuerpo o sin nivel no hay celda que pintar —un muelle, una zona de bulto—.
            #  Se cuentan y se apartan: un plano con menos huecos pintados de los que declara
            #  el resumen tiene que poder explicar la diferencia.
            if f["bay_index"] is None or f["level"] is None:
                sin_celda += 1
                continue
            palabra = f["situation"] or "(sin declarar)"
            if palabra not in vocabulario:
                vocabulario[palabra] = len(vocabulario)
            conflicto = 1 if f["conflict"] else 0
            conflictos += conflicto
            por_rack.setdefault(str(f["rack_node_id"]), []).append(
                [
                    int(f["bay_index"]),
                    int(f["level"]),
                    #  La posicion puede faltar en un hueco de una sola: se cuenta como la 1,
                    #  que es lo que hace el resto del modulo — `posicionesDe` reparte igual—.
                    int(f["position"] or 1),
                    vocabulario[palabra],
                    conflicto,
                ]
            )

        #  La fecha de la importacion sale del MISMO resumen que ya lee la cabecera de la
        #  pantalla, para que las dos digan lo mismo.
        resumen = await self._repo.summary(warehouse_id)
        return {
            "imported_at": (resumen or {}).get("last_import_at"),
            "situations": list(vocabulario),
            "racks": [{"rack_node_id": r, "cells": c} for r, c in por_rack.items()],
            "cells": len(filas) - sin_celda,
            "conflicts": conflictos,
            "without_cell": sin_celda,
        }

    async def catalogo_de_figuras(self) -> list[dict[str, Any]]:
        """El catalogo con las URLs firmadas para poder dibujar cada modelo.

        Se firma al pedirlo y no se guarda: una firma dura una hora, y guardarla seria
        guardar basura con fecha — a la segunda visita, 403 sin decir por que—.
        """
        filas = await self._repo.figuras_catalogo()
        return [await self._firmar_figura(f) for f in filas]

    async def figuras_de_almacen(self, warehouse_id: UUID) -> list[dict[str, Any]]:
        """Las figuras COLOCADAS en ese plano, listas para dibujar."""
        if not await can_access_warehouse(self._session, warehouse_id):
            raise ForbiddenError("No tienes acceso a ese almacen")
        filas = await self._repo.figuras_colocadas(warehouse_id)
        return [await self._firmar_figura(f) for f in filas]

    async def _firmar_figura(self, fila: dict[str, Any]) -> dict[str, Any]:
        """Cambia las RUTAS por URLs firmadas de una hora, y no las deja ademas.

        Sustituir y no sumar: `ApiModel` prohibe los campos de mas, y dejar `glb_path` junto
        a `glb_url` haria que el endpoint respondiera 500 en TODA peticion. Paso exactamente
        eso con los recortes de las lecturas y el sintoma fue «no se ve nada».
        """
        salida = {k: v for k, v in fila.items() if k not in ("glb_path", "thumb_path")}
        for origen, destino in (("glb_path", "glb_url"), ("thumb_path", "thumb_url")):
            ruta = fila.get(origen)
            url = None
            if ruta and self._storage is not None:
                try:
                    url = await self._storage.sign_download(BUCKET_FIGURAS, str(ruta), 3600)
                except StorageError:
                    #  Un objeto que ya no esta no puede tumbar el catalogo entero: esa
                    #  figura se queda sin dibujar y el resto sigue.
                    url = None
            salida[destino] = url
        return salida

    async def colocar_figura(
        self, *, warehouse_id: UUID, model_id: UUID, valores: dict[str, Any]
    ) -> dict[str, Any]:
        if not await can_access_warehouse(self._session, warehouse_id):
            raise ForbiddenError("No tienes acceso a ese almacen")
        if await self._repo.figura(model_id) is None:
            #  404 y no 403: un modelo de otro operador es invisible por RLS y llega aqui
            #  como «no existe». Decir 403 confirmaria que existe.
            raise NotFoundError(f"No existe la figura {model_id}")
        fila = await self._repo.colocar_figura(
            tenant_id=self._ctx.tenant_id,
            warehouse_id=warehouse_id,
            model_id=model_id,
            valores=valores,
        )
        return await self._firmar_figura(fila)

    async def mover_figura(self, *, instance_id: UUID, valores: dict[str, Any]) -> dict[str, Any]:
        fila = await self._repo.mover_figura(instance_id=instance_id, valores=valores)
        if fila is None:
            raise NotFoundError(f"No existe la figura colocada {instance_id}")
        return await self._firmar_figura(fila)

    async def quitar_figura(self, instance_id: UUID) -> None:
        if not await self._repo.quitar_figura(instance_id):
            raise NotFoundError(f"No existe la figura colocada {instance_id}")

    async def borrar_del_catalogo(self, model_id: UUID) -> None:
        """Baja del catalogo. Las apariciones ya colocadas dejan de verse tambien.

        Es baja LOGICA: la consulta del plano cruza con `m.deleted_at IS NULL`, asi que una
        figura retirada desaparece de los planos sin dejar apariciones apuntando a nada. No
        se borran sus filas para que se pueda deshacer.
        """
        if not await self._repo.borrar_figura(model_id):
            raise NotFoundError(f"No existe la figura {model_id}")

    # ══════════════════════════════════════════════════════════════════════
    # RECORRIDOS (0094)
    # ══════════════════════════════════════════════════════════════════════

    async def recorridos(self, warehouse_id: UUID) -> list[dict[str, Any]]:
        if not await can_access_warehouse(self._session, warehouse_id):
            raise ForbiddenError("No tienes acceso a ese almacen")
        return await self._repo.recorridos(warehouse_id)

    async def recorrido_con_paradas(self, trip_id: UUID) -> dict[str, Any]:
        """El recorrido y sus paradas juntos.

        Juntos y no en dos peticiones porque nunca se necesita uno sin el otro: un recorrido
        sin paradas no se puede medir ni dibujar. Pedirlos aparte serian dos idas y vueltas
        para una sola pregunta.
        """
        trip = await self._repo.recorrido(trip_id)
        if trip is None:
            #  404 y no 403: un recorrido de otro operador es invisible por RLS y llega aqui
            #  como «no existe». Decir 403 confirmaria que existe.
            raise NotFoundError(f"No existe el recorrido {trip_id}")
        return {**trip, "stops": await self._repo.paradas(trip_id)}

    async def crear_recorrido(
        self, *, warehouse_id: UUID, valores: dict[str, Any]
    ) -> dict[str, Any]:
        if not await can_access_warehouse(self._session, warehouse_id):
            raise ForbiddenError("No tienes acceso a ese almacen")
        trip = await self._repo.crear_recorrido(
            tenant_id=self._ctx.tenant_id, warehouse_id=warehouse_id, valores=valores
        )
        return {**trip, "stops": []}

    async def actualizar_recorrido(
        self, *, trip_id: UUID, valores: dict[str, Any]
    ) -> dict[str, Any]:
        trip = await self._repo.actualizar_recorrido(trip_id=trip_id, valores=valores)
        if trip is None:
            raise NotFoundError(f"No existe el recorrido {trip_id}")
        return {**trip, "stops": await self._repo.paradas(trip_id)}

    async def guardar_paradas(
        self, *, trip_id: UUID, paradas: list[dict[str, Any]]
    ) -> dict[str, Any]:
        """Reemplaza la lista entera de paradas.

        Se comprueba que el recorrido exista ANTES de tocar nada: sin eso, guardar en un
        recorrido borrado daria de baja unas paradas que ya no lo estaban y luego insertaria
        otras huerfanas, sin que nada fallara.
        """
        trip = await self._repo.recorrido(trip_id)
        if trip is None:
            raise NotFoundError(f"No existe el recorrido {trip_id}")
        stops = await self._repo.guardar_paradas(
            tenant_id=self._ctx.tenant_id, trip_id=trip_id, paradas=paradas
        )
        return {**trip, "stops": stops}

    async def borrar_recorrido(self, trip_id: UUID) -> None:
        if not await self._repo.borrar_recorrido(trip_id):
            raise NotFoundError(f"No existe el recorrido {trip_id}")
