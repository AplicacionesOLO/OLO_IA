"""LOS CUATRO NIVELES DE OLOBOT.

─────────────────────────────────────────────────────────────────────────────
EL NIVEL NUNCA CONCEDE. SOLO RECORTA.

Esta es la frase que hay que tener delante al leer el resto del archivo, y la razón
de que este módulo no sepa nada de permisos.

El bot no tiene credenciales. Habla por la sesión del usuario: sus consultas pasan
por su RLS y sus escrituras pasan por el mismo `require_permission` que la API. Un
`viewer` con nivel `owner` sigue recibiendo 403 al intentar escribir, porque el 403
lo pone el permiso.

Lo que el nivel decide es qué herramientas se le OFRECEN al modelo. Y eso importa
por una razón concreta: un modelo al que se le ofrece una herramienta que va a
fallar la intenta, falla, y le cuenta al usuario que «no se pudo». Con la
herramienta fuera del catálogo, dice lo que es verdad: que eso no está a su alcance.

La comprobación final es SIEMPRE la doble: nivel Y permiso. Ninguna de las dos
sustituye a la otra.

    nivel sin permiso  →  403 del backend, como cualquier otra llamada
    permiso sin nivel  →  la herramienta no existe para este usuario

─────────────────────────────────────────────────────────────────────────────
POR QUÉ CUATRO Y NO UN INTERRUPTOR

Podría ser un booleano «el bot escribe / no escribe». Se eligió una escala porque
las escrituras del sistema no son todas del mismo tamaño:

    corregir el conteo de un pallet          se deshace en el siguiente inventario
    cambiar el estado de un almacén          afecta a lo que ve todo el equipo
    dar de baja una entidad legal            arrastra almacenes y clientes

Un jefe de turno necesita la primera y no debería tener la tercera al alcance de una
frase mal entendida. Con un interruptor único, dársela para lo uno es dársela para
lo otro.
"""

from __future__ import annotations

from enum import StrEnum


class Nivel(StrEnum):
    """El nivel de OLOBOT de un usuario, tal como se guarda en `olobot.access`."""

    USUARIO = "user"
    SUPERVISOR = "supervisor"
    ADMIN = "admin"
    OWNER = "owner"


#: En orden, de menos a más. El orden es parte del dato: `puede()` compara posiciones.
NIVELES: tuple[Nivel, ...] = (Nivel.USUARIO, Nivel.SUPERVISOR, Nivel.ADMIN, Nivel.OWNER)

#: Cómo se le llama a cada nivel en la interfaz, y qué significa en una frase.
ETIQUETAS: dict[Nivel, tuple[str, str]] = {
    Nivel.USUARIO: (
        "Usuario",
        "Consulta datos y navega por la aplicación. No propone ningún cambio.",
    ),
    Nivel.SUPERVISOR: (
        "Supervisor",
        "Además propone cambios en datos de operación, siempre con confirmación.",
    ),
    Nivel.ADMIN: (
        "Administrador",
        "Además propone cambios en la configuración del operador, con confirmación.",
    ),
    Nivel.OWNER: (
        "Owner",
        "Todo lo que el usuario ya puede hacer por sí mismo. Sigue sin poder ampliar accesos.",
    ),
}


class Capacidad(StrEnum):
    """Lo que una herramienta necesita del nivel para siquiera ofrecerse.

    No son permisos: son categorías de riesgo. El permiso dice si esta PERSONA puede
    hacer la operación; la capacidad dice si su BOT tiene esa clase de operación a su
    alcance.
    """

    #: Consultar datos. Lo que el usuario ya ve, dicho de otra forma.
    LEER = "leer"
    #: Llevar al usuario a una pantalla de la aplicación.
    NAVEGAR = "navegar"
    #: Escribir en datos de operación: conteos, observaciones, estados de trabajo.
    ESCRIBIR_OPERACION = "escribir_operacion"
    #: Escribir en la configuración del operador: clientes, almacenes, usuarios.
    ESCRIBIR_CONFIGURACION = "escribir_configuracion"


#: Qué capacidades trae cada nivel. Acumulativo por construcción, no por herencia:
#: escribirlo entero deja ver de un vistazo qué gana cada escalón, y una herencia
#: implícita obliga a leer cuatro entradas para responder «¿puede un supervisor
#: cambiar un cliente?».
_CAPACIDADES: dict[Nivel, frozenset[Capacidad]] = {
    Nivel.USUARIO: frozenset({Capacidad.LEER, Capacidad.NAVEGAR}),
    Nivel.SUPERVISOR: frozenset(
        {Capacidad.LEER, Capacidad.NAVEGAR, Capacidad.ESCRIBIR_OPERACION}
    ),
    Nivel.ADMIN: frozenset(
        {
            Capacidad.LEER,
            Capacidad.NAVEGAR,
            Capacidad.ESCRIBIR_OPERACION,
            Capacidad.ESCRIBIR_CONFIGURACION,
        }
    ),
    Nivel.OWNER: frozenset(
        {
            Capacidad.LEER,
            Capacidad.NAVEGAR,
            Capacidad.ESCRIBIR_OPERACION,
            Capacidad.ESCRIBIR_CONFIGURACION,
        }
    ),
}


def capacidades_de(nivel: Nivel | str) -> frozenset[Capacidad]:
    """Las capacidades de un nivel. Un nivel desconocido no da ninguna.

    Devolver el conjunto vacío y no lanzar es deliberado: si un día alguien mete a
    mano un nivel que este código no conoce, el bot se queda sin herramientas en vez
    de reventar la conversación. Lo primero se nota y se arregla; lo segundo también,
    pero rompiendo la pantalla de alguien que no tiene culpa.
    """
    try:
        return _CAPACIDADES[Nivel(nivel)]
    except ValueError:
        return frozenset()


def puede(nivel: Nivel | str, capacidad: Capacidad) -> bool:
    """Si este nivel tiene esta capacidad."""
    return capacidad in capacidades_de(nivel)


def nivel_valido(valor: str) -> bool:
    """Si la cadena es uno de los cuatro niveles.

    Existe para que la API pueda rechazar un nivel inventado con un 422 que dice
    cuáles hay, en vez de dejar que lo rechace el CHECK de la base con un 500.
    """
    return valor in {n.value for n in NIVELES}


#: OWNER y ADMIN tienen las mismas capacidades HOY, y eso es a propósito.
#:
#: La diferencia entre los dos no está en lo que el bot puede hacer, sino en quién es
#: el usuario: el owner de la plataforma tiene permisos que un `tenant_admin` no
#: tiene, y esos permisos ya gobiernan el resultado. Duplicar la distinción aquí sería
#: escribir dos veces la misma regla, en dos sitios que se pueden contradecir.
#:
#: Se conservan como niveles distintos porque el usuario los pidió distintos y porque
#: la asimetría llegará: la primera capacidad que solo tenga sentido para el owner
#: —tocar varios operadores a la vez, por ejemplo— entra aquí sin cambiar el modelo.
LOS_DOS_ALTOS_SON_IGUALES_HOY = True
