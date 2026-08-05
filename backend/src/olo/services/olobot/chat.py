"""EL SERVICIO DE CONVERSACIÓN DE OLOBOT.

─────────────────────────────────────────────────────────────────────────────
EL BUCLE, Y POR QUÉ TIENE TOPE

Un turno no es una llamada al modelo: son varias. El usuario pregunta «¿cómo está de
lleno el CD de San José?», el modelo pide `listar_almacenes` para resolver el código,
lee el resultado, pide `resumen_ocupacion`, y solo entonces contesta. Eso es lo que
hace que acierte en vez de adivinar.

El tope (`olobot_max_turnos`) existe porque un modelo confundido encadena llamadas
indefinidamente: pide la misma consulta una y otra vez esperando otro resultado. Sin
tope, eso es una factura y una petición colgada. Al llegar al tope se le pide que
conteste con lo que tenga, que da una respuesta parcial honesta en vez de un timeout.

─────────────────────────────────────────────────────────────────────────────
LAS ESCRITURAS NO SE EJECUTAN EN ESTE CAMINO. NUNCA.

Cuando el modelo pide una herramienta que escribe, aquí NO se escribe. Se registra la
propuesta en `olobot.actions` con un resumen en castellano, y al modelo se le devuelve
«propuesta registrada, esperando confirmación del usuario». La escritura ocurre en
`confirmar()`, en otra petición, después de que una persona haya leído qué va a
cambiar.

Esto tiene una consecuencia que parece un defecto y es lo contrario: el modelo NO sabe
si el cambio se aplicó. No puede decir «ya está hecho», porque cuando termina su turno
todavía no lo está. Es la única forma de que «con confirmación» signifique algo.

─────────────────────────────────────────────────────────────────────────────
LA COMPROBACIÓN DE PERMISO ES DOBLE, Y LAS DOS HACEN FALTA

    al construir el catálogo    filtra por nivel Y por permiso  → el modelo no la ve
    al ejecutar                 `require_permission`            → 403 de verdad

La primera es cortesía con el modelo: no ofrecerle lo que va a fallar. La segunda es
la que manda. Quitar la segunda dejaría la autorización en manos de un filtro pensado
para mejorar las respuestas, y bastaría con que el modelo se inventara un nombre de
herramienta —lo hace— para saltárselo.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any
from uuid import UUID

from olo.core.errors import BusinessRuleError, ForbiddenError, NotFoundError
from olo.core.logging import get_logger
from olo.domain.olobot import (
    RUTAS,
    Herramienta,
    herramientas_para,
    por_nombre,
)
from olo.llm import ChatLLM, LlamadaHerramienta, LLMError
from olo.repositories.olobot import OlobotRepository
from olo.security.authorization import effective_permission_codes, require_permission
from olo.services.olobot import contexto
from olo.services.olobot.acceso import AccesoService

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from olo.core.config import Settings
    from olo.core.context import TenantContext

_log = get_logger(__name__)


class OlobotNoConfiguradoError(BusinessRuleError):
    """No hay clave del modelo. Es configuración ausente, no un fallo del usuario."""


class OlobotSinAccesoError(ForbiddenError):
    """El usuario no tiene nivel de OLOBOT. Sin fila en `olobot.access` no hay bot."""


def _json(valor: Any) -> str:
    """Serializa para el modelo, tolerando lo que la base devuelve.

    `default=str` porque las consultas traen `datetime`, `Decimal` y `UUID`, y el
    modelo los lee igual de bien como texto. Sin esto, cualquier consulta con una
    fecha rompe el turno con un `TypeError` que no tiene nada que ver con la pregunta.
    """
    return json.dumps(valor, ensure_ascii=False, default=str)


class OlobotService:
    def __init__(
        self, session: AsyncSession, ctx: TenantContext, settings: Settings
    ) -> None:
        self._session = session
        self._repo = OlobotRepository(session)
        self._acceso = AccesoService(session, ctx)
        self._ctx = ctx
        self._cfg = settings

    # ══════════════════════════════════════════════════════════════════════
    # ESTADO
    # ══════════════════════════════════════════════════════════════════════

    async def estado(self, user_id: UUID) -> dict[str, Any]:
        """Si el bot está disponible para este usuario, y qué puede hacer.

        Lo pide la interfaz al arrancar para decidir si pinta el botón. Devolver
        `available: false` con un motivo es mejor que esconder el botón sin más: un
        asistente que existe para otros y para ti no, sin explicación, se lee como un
        fallo.
        """
        nivel = await self._acceso.nivel_actual(user_id)
        if self._cfg.olobot_api_key is None:
            return {
                "available": False,
                "reason": "OLOBOT no está configurado en este entorno.",
                "level": nivel.value if nivel else None,
                "tools": [],
            }
        if nivel is None:
            return {
                "available": False,
                "reason": (
                    "No tienes acceso a OLOBOT. Un administrador puede concedértelo "
                    "en Configuración del sistema."
                ),
                "level": None,
                "tools": [],
            }
        permisos = await effective_permission_codes(self._session)
        herramientas = herramientas_para(nivel, permisos)
        return {
            "available": True,
            "reason": None,
            "level": nivel.value,
            "model": self._cfg.olobot_model,
            "tools": [
                {"name": h.nombre, "writes": h.escribe, "description": h.descripcion}
                for h in herramientas
            ],
        }

    # ══════════════════════════════════════════════════════════════════════
    # CONVERSACIONES
    # ══════════════════════════════════════════════════════════════════════

    async def conversaciones(self) -> dict[str, Any]:
        return {"conversations": await self._repo.conversaciones()}

    async def historial(self, conv_id: UUID) -> dict[str, Any]:
        conv = await self._repo.conversacion(conv_id)
        if conv is None:
            # RLS ya impide ver la de otro, así que «no existe» y «no es tuya» son la
            # misma respuesta observable. Distinguirlas confirmaría que existe.
            raise NotFoundError("Conversación no encontrada", resource_id=str(conv_id))
        mensajes = await self._repo.historial(conv_id, self._cfg.olobot_historial)
        return {
            "conversation": conv,
            # Los mensajes de rol `tool` no se le enseñan al usuario: son el resultado
            # crudo de una consulta, en JSON, que ya está resumido en la respuesta.
            "messages": [m for m in mensajes if m["role"] in ("user", "assistant")],
        }

    async def retirar(self, conv_id: UUID) -> None:
        if await self._repo.retirar_conversacion(conv_id) == 0:
            raise NotFoundError("Conversación no encontrada", resource_id=str(conv_id))

    # ══════════════════════════════════════════════════════════════════════
    # EL TURNO
    # ══════════════════════════════════════════════════════════════════════

    async def hablar(
        self,
        *,
        user_id: UUID,
        mensaje: str,
        conversacion_id: UUID | None,
        warehouse_id: UUID | None,
    ) -> dict[str, Any]:
        """Un turno completo: la pregunta del usuario y la respuesta del bot."""
        if self._cfg.olobot_api_key is None:
            raise OlobotNoConfiguradoError(
                "OLOBOT no está configurado en este entorno: falta la clave del modelo."
            )

        nivel = await self._acceso.nivel_actual(user_id)
        if nivel is None:
            raise OlobotSinAccesoError(
                "No tienes acceso a OLOBOT. Un administrador puede concedértelo en "
                "Configuración del sistema."
            )

        permisos = await effective_permission_codes(self._session)
        herramientas = herramientas_para(nivel, permisos)
        perfil = await self._repo.quien_soy(user_id)

        if conversacion_id is None:
            conversacion_id = await self._repo.crear_conversacion(
                tenant_id=self._ctx.tenant_id,
                user_id=user_id,
                warehouse_id=warehouse_id,
                # El título es la primera pregunta, recortada. Pedirle uno al modelo
                # costaría una llamada más por conversación para adornar una lista.
                titulo=mensaje[:80] if mensaje.strip() else "Conversación nueva",
            )
        elif await self._repo.conversacion(conversacion_id) is None:
            raise NotFoundError(
                "Conversación no encontrada", resource_id=str(conversacion_id)
            )

        await self._repo.añadir_mensaje(
            tenant_id=self._ctx.tenant_id,
            conv_id=conversacion_id,
            rol="user",
            contenido=mensaje,
        )

        sistema = contexto.construir(perfil=perfil, nivel=nivel, herramientas=herramientas)
        mensajes = await self._para_el_modelo(conversacion_id, sistema)

        llm = ChatLLM(
            api_key=self._cfg.olobot_api_key.get_secret_value(),
            base_url=self._cfg.olobot_base_url,
            modelo=self._cfg.olobot_model,
            timeout_s=self._cfg.olobot_timeout_s,
        )
        especificaciones = [h.para_el_modelo() for h in herramientas]

        navegacion: dict[str, Any] | None = None
        propuestas: list[dict[str, Any]] = []
        texto: str | None = None

        try:
            for turno in range(self._cfg.olobot_max_turnos):
                # En el último turno se le quitan las herramientas: es la forma de
                # pedirle «contesta con lo que tengas». Dejárselas y descartar la
                # respuesta gastaría una llamada para tirarla.
                ultimo = turno == self._cfg.olobot_max_turnos - 1
                respuesta = await llm.completar(
                    mensajes, None if ultimo else especificaciones
                )

                await self._repo.añadir_mensaje(
                    tenant_id=self._ctx.tenant_id,
                    conv_id=conversacion_id,
                    rol="assistant",
                    contenido=respuesta.texto,
                    tool_calls=respuesta.crudo,
                    tokens_in=respuesta.tokens_in,
                    tokens_out=respuesta.tokens_out,
                    modelo=respuesta.modelo,
                )

                if not respuesta.llamadas:
                    texto = respuesta.texto
                    break

                mensajes.append(
                    {
                        "role": "assistant",
                        "content": respuesta.texto,
                        "tool_calls": respuesta.crudo,
                    }
                )

                for llamada in respuesta.llamadas:
                    resultado, extra = await self._ejecutar(
                        llamada=llamada,
                        herramientas=herramientas,
                        conv_id=conversacion_id,
                        user_id=user_id,
                        warehouse_id=warehouse_id,
                    )
                    if extra.get("navegacion"):
                        navegacion = extra["navegacion"]
                    if extra.get("propuesta"):
                        propuestas.append(extra["propuesta"])

                    texto_resultado = _json(resultado)
                    await self._repo.añadir_mensaje(
                        tenant_id=self._ctx.tenant_id,
                        conv_id=conversacion_id,
                        rol="tool",
                        contenido=texto_resultado,
                        tool_call_id=llamada.id,
                    )
                    mensajes.append(
                        {
                            "role": "tool",
                            "tool_call_id": llamada.id,
                            "content": texto_resultado,
                        }
                    )
            else:
                texto = (
                    "Me he quedado sin pasos para responder esto. Prueba a "
                    "preguntármelo de forma más concreta."
                )
        except LLMError as exc:
            # El fallo del proveedor se guarda en el historial. Una conversación con
            # un hueco donde debería estar la respuesta no se puede diagnosticar
            # después: no habría forma de saber si el bot calló o si se cayó.
            await self._repo.añadir_mensaje(
                tenant_id=self._ctx.tenant_id,
                conv_id=conversacion_id,
                rol="assistant",
                contenido=f"[fallo del modelo] {exc}",
            )
            raise

        return {
            "conversation_id": str(conversacion_id),
            "reply": texto or "",
            "navigate": navegacion,
            "pending_actions": propuestas,
        }

    async def _para_el_modelo(self, conv_id: UUID, sistema: str) -> list[dict[str, Any]]:
        """El historial en el formato de la API, con el mensaje de sistema delante.

        El de sistema se construye en CADA turno y no se guarda en la tabla: contiene
        el nivel y los roles del usuario, y esos cambian. Un prompt de sistema
        guardado seguiría describiendo los permisos que tenía en enero.
        """
        mensajes: list[dict[str, Any]] = [{"role": "system", "content": sistema}]
        #  Solo `user` y `assistant` CON TEXTO. Las llamadas a herramientas de turnos
        #  anteriores y sus resultados no se reenvían, por dos razones.
        #
        #  La primera es de corrección: la API exige que cada `tool_call` tenga su
        #  respuesta `tool` en el mismo historial, y el recorte a los últimos N
        #  mensajes parte esos pares por la mitad. Un par roto es un 400 del
        #  proveedor, y llega justo cuando la conversación se alarga.
        #
        #  La segunda es que no hacen falta: la conclusión de una consulta ya está en
        #  el texto con el que el bot contestó. Reenviar el JSON crudo de las
        #  consultas de hace seis turnos cuesta en cada turno y no añade nada.
        #
        #  Dentro del turno EN CURSO sí se le pasan: el bucle de `hablar` las añade a
        #  esta misma lista, en pares completos.
        for m in await self._repo.historial(conv_id, self._cfg.olobot_historial):
            if m["role"] not in ("user", "assistant") or not m["content"]:
                continue
            mensajes.append({"role": m["role"], "content": m["content"]})
        return mensajes

    # ══════════════════════════════════════════════════════════════════════
    # EJECUCIÓN DE HERRAMIENTAS
    # ══════════════════════════════════════════════════════════════════════

    async def _ejecutar(
        self,
        *,
        llamada: LlamadaHerramienta,
        herramientas: tuple[Herramienta, ...],
        conv_id: UUID,
        user_id: UUID,
        warehouse_id: UUID | None,
    ) -> tuple[Any, dict[str, Any]]:
        """Ejecuta una herramienta. Devuelve (resultado para el modelo, extras).

        Ningún fallo de aquí lanza: todos vuelven como `{"error": ...}` para que el
        modelo lo lea y se lo explique al usuario. Una excepción rompería la
        conversación por algo que el modelo puede corregir en el turno siguiente
        —un código de almacén mal escrito, por ejemplo—.
        """
        if llamada.ilegible:
            return {"error": "Los argumentos no son JSON válido. Vuelve a intentarlo."}, {}

        herramienta = por_nombre(llamada.nombre)
        if herramienta is None:
            return {
                "error": f"No existe ninguna herramienta llamada «{llamada.nombre}»."
            }, {}

        # Que esté en el catálogo no basta: tiene que estar en el catálogo DE ESTE
        # usuario. Un modelo puede pedir una herramienta que vio en otra conversación
        # o que se inventa a partir del nombre de otra.
        if herramienta not in herramientas:
            return {
                "error": (
                    f"«{herramienta.nombre}» no está a tu alcance con el nivel y los "
                    "permisos de este usuario."
                )
            }, {}

        if herramienta.permiso is not None:
            try:
                await require_permission(self._session, self._ctx, herramienta.permiso)
            except Exception:
                return {
                    "error": (
                        f"El usuario no tiene el permiso «{herramienta.permiso}», que "
                        f"«{herramienta.nombre}» necesita."
                    )
                }, {}

        args = llamada.argumentos

        if herramienta.nombre == "navegar":
            return await self._navegar(args)

        if herramienta.escribe:
            return await self._proponer(
                herramienta=herramienta, args=args, conv_id=conv_id, user_id=user_id
            )

        return await self._leer(herramienta, args, warehouse_id, user_id), {}

    async def _navegar(self, args: dict[str, Any]) -> tuple[Any, dict[str, Any]]:
        destino = str(args.get("destino") or "")
        if destino not in RUTAS:
            return {
                "error": (
                    f"«{destino}» no es una pantalla de la aplicación. Las claves "
                    f"válidas son: {', '.join(RUTAS)}."
                )
            }, {}
        ruta, descripcion = RUTAS[destino]
        return (
            {"ok": True, "ruta": ruta, "pantalla": descripcion},
            {
                "navegacion": {
                    "key": destino,
                    "path": ruta,
                    "reason": args.get("porque"),
                }
            },
        )

    async def _proponer(
        self,
        *,
        herramienta: Herramienta,
        args: dict[str, Any],
        conv_id: UUID,
        user_id: UUID,
    ) -> tuple[Any, dict[str, Any]]:
        """Registra la propuesta. NO escribe. Ver la cabecera del módulo."""
        resumen = self._resumir(herramienta.nombre, args)
        accion_id = await self._repo.proponer_accion(
            tenant_id=self._ctx.tenant_id,
            conv_id=conv_id,
            user_id=user_id,
            herramienta=herramienta.nombre,
            argumentos=args,
            resumen=resumen,
        )
        return (
            {
                "estado": "esperando_confirmacion",
                "resumen": resumen,
                "nota": (
                    "El cambio NO está aplicado. El usuario tiene que confirmarlo. "
                    "Dile qué vas a cambiar y espera; no digas que ya está hecho."
                ),
            },
            {
                "propuesta": {
                    "id": str(accion_id),
                    "tool": herramienta.nombre,
                    "summary": resumen,
                    "arguments": args,
                }
            },
        )

    @staticmethod
    def _resumir(herramienta: str, args: dict[str, Any]) -> str:
        """El texto que el usuario lee antes de confirmar.

        Se escribe aquí, en el servidor, y no lo genera el modelo. Si lo generara el
        modelo, lo que se confirma y lo que se ejecuta podrían no ser lo mismo: el
        resumen diría «bloqueo A-01-02» y los argumentos llevarían otro código. Este
        texto sale de los MISMOS argumentos que se van a ejecutar.
        """
        if herramienta == "marcar_ubicacion_bloqueada":
            verbo = "Bloquear" if args.get("bloqueada") else "Desbloquear"
            return (
                f"{verbo} la ubicación {args.get('codigo', '?')}"
                + (f" en {args['almacen']}" if args.get("almacen") else "")
                + f". Motivo: {args.get('motivo', '—')}"
            )
        if herramienta == "renombrar_cliente":
            return (
                f"Cambiar el nombre del cliente {args.get('codigo', '?')} "
                f"a «{args.get('nombre', '?')}»"
            )
        if herramienta == "cambiar_estado_almacen":
            estado = args.get("estado")
            return (
                f"Poner el almacén {args.get('almacen', '?')} como "
                f"{'activo' if estado == 'active' else 'inactivo'}"
                + (
                    ". Un almacén inactivo sale de la operación para todo el equipo"
                    if estado != "active"
                    else ""
                )
            )
        # Nunca debería llegar aquí: son las tres herramientas que escriben. Si un día
        # se añade una cuarta y se olvida su resumen, esto lo dice en la pantalla en
        # vez de enseñar un resumen vacío que el usuario confirmaría sin entender.
        return f"[sin resumen para «{herramienta}»] argumentos: {_json(args)}"

    async def _resolver_almacen(self, codigo: str | None, por_omision: UUID | None) -> UUID | None:
        """El almacén del que se habla: el que dijo el modelo, o el único que hay.

        Si el usuario tiene UN solo almacén, no hace falta que nadie lo nombre. Con
        varios y sin código, devuelve `None` y la herramienta responde que hace falta
        decir cuál: preguntar es mejor que elegir uno y dar una cifra del equivocado.
        """
        if codigo:
            almacen = await self._repo.almacen_por_codigo(codigo)
            return None if almacen is None else UUID(str(almacen["id"]))
        if por_omision is not None:
            return por_omision
        almacenes = await self._repo.almacenes()
        if len(almacenes) == 1:
            return UUID(str(almacenes[0]["id"]))
        return None

    async def _leer(
        self,
        herramienta: Herramienta,
        args: dict[str, Any],
        warehouse_id: UUID | None,
        user_id: UUID,
    ) -> Any:
        nombre = herramienta.nombre

        if nombre == "listar_almacenes":
            return {"almacenes": await self._repo.almacenes()}

        if nombre == "estructura_operador":
            return {
                "recuentos": await self._repo.estructura(),
                "clientes": await self._repo.clientes(),
            }

        if nombre == "quien_soy":
            #  `user_id` viene del turno, no del contexto: `TenantContext` guarda el
            #  `auth_id` del JWT, no el `core.users.id`, y son identificadores
            #  distintos. El del turno lo resolvió `identity.fetch_current_user_id`.
            return await self._repo.quien_soy(user_id)

        if nombre == "quien_usa_olobot":
            return {"usuarios": await self._repo.niveles()}

        if nombre == "modelos_publicados":
            return {"modelos": await self._repo.modelos_publicados()}

        if nombre == "trabajos_percepcion":
            return {
                "trabajos": await self._repo.trabajos_percepcion(
                    args.get("estado"), _entre(args.get("cuantos"), 1, 20, 10)
                )
            }

        # Las que necesitan un almacén.
        wid = await self._resolver_almacen(args.get("almacen"), warehouse_id)
        if wid is None:
            return {
                "error": (
                    "No sé de qué almacén hablas. Llama a `listar_almacenes` y pasa "
                    "el código en `almacen`."
                )
            }

        if nombre == "resumen_ocupacion":
            resumen = await self._repo.resumen_ocupacion(wid)
            if not resumen or not resumen.get("ubicaciones"):
                return {
                    "aviso": (
                        "Ese almacén no tiene catálogo espacial importado, así que no "
                        "hay ocupación que calcular."
                    )
                }
            return resumen

        if nombre == "racks_mas_llenos":
            return {
                "racks": await self._repo.racks_mas_llenos(
                    wid, _entre(args.get("cuantos"), 1, 20, 10)
                )
            }

        if nombre == "buscar_ubicacion":
            codigo = str(args.get("codigo") or "")
            ubicacion = await self._repo.ubicacion(wid, codigo)
            if ubicacion is None:
                return {"error": f"No existe la ubicación «{codigo}» en ese almacén."}
            return ubicacion

        if nombre == "discrepancias_inventario":
            filas = await self._repo.discrepancias(
                wid, _entre(args.get("cuantos"), 1, 50, 20)
            )
            return {"discrepancias": filas, "cuantas": len(filas)}

        return {"error": f"«{nombre}» no está implementada."}

    # ══════════════════════════════════════════════════════════════════════
    # CONFIRMAR O RECHAZAR
    # ══════════════════════════════════════════════════════════════════════

    async def confirmar(self, *, accion_id: UUID, user_id: UUID) -> dict[str, Any]:
        """Ejecuta una propuesta. Aquí, y solo aquí, se escribe."""
        accion = await self._repo.accion(accion_id)
        if accion is None:
            raise NotFoundError("Acción no encontrada", resource_id=str(accion_id))
        if accion["status"] != "proposed":
            raise BusinessRuleError(
                f"Esa acción ya está «{accion['status']}»: no se puede volver a decidir."
            )
        if UUID(str(accion["user_id"])) != user_id:
            # RLS ya lo impide en el UPDATE, pero un 403 explícito es mejor que un
            # «cero filas afectadas» traducido a un error genérico.
            raise ForbiddenError("Esa propuesta es de otra persona.")

        herramienta = por_nombre(str(accion["tool"]))
        if herramienta is None or not herramienta.escribe:
            raise BusinessRuleError(
                "Esa propuesta apunta a una herramienta que ya no existe."
            )

        # El permiso se comprueba OTRA VEZ, aquí. Entre la propuesta y la confirmación
        # pueden pasar minutos, y en esos minutos a alguien le pueden haber retirado
        # el rol. Confiar en la comprobación del turno anterior significaría ejecutar
        # con un permiso caducado.
        assert herramienta.permiso is not None  # las tres que escriben lo tienen
        await require_permission(self._session, self._ctx, herramienta.permiso)

        args = accion["arguments"] or {}
        try:
            resultado = await self._escribir(herramienta.nombre, args, user_id)
        except Exception as exc:
            await self._repo.cerrar_accion(
                accion_id=accion_id,
                estado="failed",
                actor=user_id,
                error=str(exc)[:400],
            )
            _log.exception("olobot: fallo al ejecutar %s", herramienta.nombre)
            raise

        if resultado.get("filas", 0) == 0:
            await self._repo.cerrar_accion(
                accion_id=accion_id,
                estado="failed",
                actor=user_id,
                error="No se encontró lo que había que cambiar.",
            )
            raise NotFoundError(
                "No se encontró lo que había que cambiar. Puede que haya cambiado "
                "desde que se propuso.",
                resource_id=str(accion_id),
            )

        await self._repo.cerrar_accion(
            accion_id=accion_id, estado="executed", actor=user_id, resultado=resultado
        )
        return {"status": "executed", "summary": accion["summary"], **resultado}

    async def rechazar(self, *, accion_id: UUID, user_id: UUID) -> dict[str, Any]:
        """Descarta una propuesta. Queda registrada como rechazada, no se borra."""
        filas = await self._repo.cerrar_accion(
            accion_id=accion_id, estado="rejected", actor=user_id
        )
        if filas == 0:
            raise NotFoundError(
                "Esa propuesta no existe o ya estaba decidida", resource_id=str(accion_id)
            )
        return {"status": "rejected"}

    async def _escribir(
        self, herramienta: str, args: dict[str, Any], actor: UUID
    ) -> dict[str, Any]:
        if herramienta == "renombrar_cliente":
            filas = await self._repo.renombrar_cliente(
                codigo=str(args["codigo"]), nombre=str(args["nombre"]), actor=actor
            )
            return {"filas": filas}

        if herramienta == "cambiar_estado_almacen":
            filas = await self._repo.estado_almacen(
                codigo=str(args["almacen"]), estado=str(args["estado"]), actor=actor
            )
            return {"filas": filas}

        if herramienta == "marcar_ubicacion_bloqueada":
            wid = await self._resolver_almacen(args.get("almacen"), None)
            if wid is None:
                raise BusinessRuleError(
                    "No se pudo resolver el almacén de esa ubicación."
                )
            filas = await self._repo.bloquear_ubicacion(
                warehouse_id=wid,
                codigo=str(args["codigo"]),
                bloqueada=bool(args["bloqueada"]),
                actor=actor,
            )
            return {"filas": filas}

        raise BusinessRuleError(f"«{herramienta}» no sabe escribir.")

    async def registro(self) -> dict[str, Any]:
        """El registro de auditoría. Visible para todo el tenant, a diferencia de los
        mensajes: ver la nota de privacidad de 0073."""
        return {"actions": await self._repo.acciones()}


def _entre(valor: Any, minimo: int, maximo: int, por_omision: int) -> int:
    """Acota un entero que viene del modelo.

    El modelo manda lo que quiere: `"diez"`, `1000`, `-3`. Acotar en silencio es lo
    correcto aquí —un `LIMIT 1000` sobre discrepancias son 300 KB de JSON que nadie
    va a leer—, y devolver un error por un límite mal puesto gastaría un turno en
    algo que no cambia la respuesta.
    """
    try:
        n = int(valor)
    except (TypeError, ValueError):
        return por_omision
    return max(minimo, min(maximo, n))
