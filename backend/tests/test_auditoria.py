"""Pruebas de las migraciones 0085 y 0086 · el registro de auditoría.

    pytest -m integration tests/test_auditoria.py

Lo que se comprueba no es que las tablas existan, sino las cinco propiedades de las que
depende que un registro de auditoría sirva para algo:

  01-03  CAPTURA: un INSERT, un UPDATE con su diff y un DELETE que guarda lo borrado
  04-05  NO MIENTE: el ruido de contabilidad no entra; `db_role` dice quién escribió
  06-08  ES INMUTABLE: `olo_app` no puede insertar, editar ni borrar entradas
  09-10  COBERTURA: las tablas de volumen quedan fuera y las de decisión dentro
  11-12  LA MARCA DE PRUEBAS: funciona en los dos sentidos, y marcar no es borrar
  13     NO FILTRA SECRETOS a un sitio del que nadie borra nada

La 05 existe por un fallo real. La primera versión usaba `current_user` para
`db_role`, y dentro de una función SECURITY DEFINER `current_user` es el DUEÑO de la
función: la columna decía `postgres` en todas las entradas y no distinguía una
escritura de la aplicación de una de una herramienta, que es lo único para lo que
existe. Lo cazó una prueba contra la API, no el ojo.

La 11 comprueba los dos sentidos, y el segundo es el que importa: si la AUSENCIA del
GUC marcara las escrituras como prueba, el registro real entero quedaría escondido
detrás de un interruptor y nadie lo notaría.
"""

from __future__ import annotations

import pytest

from .admin_conn import admin_tx

pytestmark = pytest.mark.integration

#: Tablas cuyo volumen haría inútil el registro. Una importación del WMS son 41.055
#: filas y UNA decisión; auditarla fila a fila enterraría los cambios que sí importan.
DE_VOLUMEN = (
    "inventory.wms_stock",
    "spatial.locations",
    "spatial.nodes",
    "ai.images",
    "ai.annotations",
    "ai.dataset_items",
    "inventory.readings",
    "inventory.scans",
    "spatial.import_row_errors",
)

#: Tablas donde vive una decisión de una persona. Sin estas el módulo no sirve.
DE_DECISION = (
    "core.users",
    "core.role_permissions",
    "core.tenant_memberships",
    "core.user_warehouse_access",
    "core.warehouses",
    "incidents.incidents",
    "inventory.clusters",
    "spatial.warehouse_layouts",
    "ai.model_versions",
)


async def _cliente_de_prueba(c) -> str:
    """Una fila real sobre la que provocar los tres tipos de escritura.

    `core.clients` y no una tabla inventada: el registro se prueba sobre algo que
    está de verdad vigilado, no sobre un caso construido para que salga bien.
    """
    return await c.fetchval(
        "INSERT INTO core.clients (tenant_id, company_id, name, code, status) "
        "SELECT co.tenant_id, co.id, $1, $2, 'active' "
        "  FROM core.companies co ORDER BY co.created_at LIMIT 1 "
        "RETURNING id::text",
        "ZZZ Auditoria pytest",
        "ZZZ-PYTEST",
    )


async def test_01_captura_el_insert() -> None:
    async with admin_tx() as c:
        cid = await _cliente_de_prueba(c)
        fila = await c.fetchrow(
            "SELECT operation, before, after FROM audit.entries "
            " WHERE table_name = 'clients' AND row_id = $1 ORDER BY id DESC LIMIT 1",
            cid,
        )
        assert fila is not None, "el INSERT no dejó entrada"
        assert fila["operation"] == "INSERT"
        assert fila["before"] is None, "un INSERT no tiene estado anterior"
        assert "ZZZ Auditoria pytest" in fila["after"]


async def test_02_captura_el_update_con_su_diff() -> None:
    async with admin_tx() as c:
        cid = await _cliente_de_prueba(c)
        await c.execute("UPDATE core.clients SET name = $1 WHERE id = $2::uuid",
                        "ZZZ Renombrado", cid)
        fila = await c.fetchrow(
            "SELECT changed, before ->> 'name' AS antes, after ->> 'name' AS despues "
            "  FROM audit.entries "
            " WHERE table_name = 'clients' AND row_id = $1 AND operation = 'UPDATE' "
            " ORDER BY id DESC LIMIT 1",
            cid,
        )
        assert fila is not None, "el UPDATE no dejó entrada"
        assert "name" in fila["changed"], f"el diff no dice qué cambió: {fila['changed']}"
        assert fila["antes"] == "ZZZ Auditoria pytest"
        assert fila["despues"] == "ZZZ Renombrado"


async def test_03_el_delete_guarda_lo_borrado() -> None:
    """El registro sobrevive a lo que registra, y es medio sentido de que exista."""
    async with admin_tx() as c:
        cid = await _cliente_de_prueba(c)
        await c.execute("DELETE FROM core.clients WHERE id = $1::uuid", cid)

        existe = await c.fetchval(
            "SELECT count(*) FROM core.clients WHERE id = $1::uuid", cid
        )
        assert existe == 0, "la fila debería estar borrada"

        fila = await c.fetchrow(
            "SELECT operation, before ->> 'name' AS antes, after FROM audit.entries "
            " WHERE table_name = 'clients' AND row_id = $1 AND operation = 'DELETE' "
            " ORDER BY id DESC LIMIT 1",
            cid,
        )
        assert fila is not None, "el DELETE no dejó entrada"
        assert fila["antes"] == "ZZZ Auditoria pytest"
        assert fila["after"] is None, "un DELETE no tiene estado posterior"


async def test_04_un_update_sin_cambios_no_deja_entrada() -> None:
    """Escribir los mismos valores no es un evento.

    Un PATCH que reenvía lo que ya había, o un guardado sin editar, mueven
    `updated_at` y `version` y nada más. Registrarlos llenaría el historial de una
    fila de entradas idénticas entre las que habría que buscar el cambio de verdad.
    """
    async with admin_tx() as c:
        cid = await _cliente_de_prueba(c)
        antes = await c.fetchval(
            "SELECT count(*) FROM audit.entries WHERE row_id = $1", cid
        )
        await c.execute("UPDATE core.clients SET name = name WHERE id = $1::uuid", cid)
        despues = await c.fetchval(
            "SELECT count(*) FROM audit.entries WHERE row_id = $1", cid
        )
        assert despues == antes, "un UPDATE sin cambios dejó entrada: el historial se llena"


async def test_05_db_role_dice_quien_escribio() -> None:
    """`session_user`, no `current_user`.

    Dentro de SECURITY DEFINER, `current_user` es el dueño de la función —`postgres`—
    siempre. Con ella la columna decía `postgres` en TODAS las entradas y no
    distinguía una escritura de la aplicación de una de una herramienta.
    """
    async with admin_tx() as c:
        cid = await _cliente_de_prueba(c)
        registrado, sesion = await c.fetchrow(
            "SELECT (SELECT db_role FROM audit.entries WHERE row_id = $1 "
            "        ORDER BY id DESC LIMIT 1), session_user",
            cid,
        )
        assert registrado == sesion, (
            f"db_role dice {registrado!r} y la sesión es {sesion!r}: la columna no "
            "distingue quién escribió"
        )


async def test_06_olo_app_no_puede_escribir_en_el_registro() -> None:
    """El candado son los PRIVILEGIOS, no las políticas.

    Si la aplicación pudiera insertar entradas podría fabricar rastro; si pudiera
    borrarlas podría taparlo. Las dos cosas convierten el registro en decoración.
    """
    async with admin_tx() as c:
        for accion in ("INSERT", "UPDATE", "DELETE"):
            puede = await c.fetchval(
                "SELECT has_table_privilege('olo_app', 'audit.entries', $1)", accion
            )
            assert puede is False, f"olo_app puede hacer {accion} en el registro"


async def test_07_olo_app_si_puede_leerlo() -> None:
    async with admin_tx() as c:
        assert await c.fetchval(
            "SELECT has_table_privilege('olo_app', 'audit.entries', 'SELECT')"
        ) is True


async def test_08_el_registro_esta_bajo_rls_forzado() -> None:
    """`FORCE` además de `ENABLE`: sin él, el dueño de la tabla se salta las políticas
    y el aislamiento entre tenants dependería de quién ejecute la consulta."""
    async with admin_tx() as c:
        fila = await c.fetchrow(
            "SELECT relrowsecurity, relforcerowsecurity FROM pg_class "
            " WHERE oid = 'audit.entries'::regclass"
        )
        assert fila["relrowsecurity"] is True, "RLS no está activada"
        assert fila["relforcerowsecurity"] is True, "RLS no está forzada"


async def test_09_las_tablas_de_volumen_quedan_fuera() -> None:
    """La decisión que define el módulo, comprobada.

    Si alguien engancha `wms_stock` por comodidad, la siguiente importación mete
    41.055 entradas y el registro deja de poder leerse.
    """
    async with admin_tx() as c:
        vigiladas = {
            f"{r['nspname']}.{r['relname']}"
            for r in await c.fetch(
                "SELECT n.nspname, c.relname FROM pg_trigger t "
                "  JOIN pg_class c ON c.oid = t.tgrelid "
                "  JOIN pg_namespace n ON n.oid = c.relnamespace "
                " WHERE t.tgname = 'trg_auditar' AND NOT t.tgisinternal"
            )
        }
        colados = vigiladas & set(DE_VOLUMEN)
        assert not colados, f"tablas de volumen vigiladas: {sorted(colados)}"


async def test_10_las_tablas_de_decision_estan_dentro() -> None:
    async with admin_tx() as c:
        vigiladas = {
            f"{r['nspname']}.{r['relname']}"
            for r in await c.fetch(
                "SELECT n.nspname, c.relname FROM pg_trigger t "
                "  JOIN pg_class c ON c.oid = t.tgrelid "
                "  JOIN pg_namespace n ON n.oid = c.relnamespace "
                " WHERE t.tgname = 'trg_auditar' AND NOT t.tgisinternal "
                "   AND t.tgenabled <> 'D'"
            )
        }
        faltan = set(DE_DECISION) - vigiladas
        assert not faltan, f"sin vigilar, o con el trigger desactivado: {sorted(faltan)}"


async def test_11_la_marca_de_pruebas_funciona_en_los_dos_sentidos() -> None:
    """La suite escribe en la base de producción y deja ~150 entradas por ejecución.

    Se comprueban los DOS sentidos, y el segundo es el que importa: si la ausencia del
    GUC marcara las escrituras como prueba, el registro entero quedaría escondido detrás
    de un interruptor y nadie lo notaría.
    """
    async with admin_tx() as c:
        await c.execute("SET LOCAL app.is_test = 'on'")
        cid = await _cliente_de_prueba(c)
        marca = await c.fetchval(
            "SELECT is_test FROM audit.entries WHERE row_id = $1 "
            " ORDER BY id DESC LIMIT 1",
            cid,
        )
        assert marca is True, "con `app.is_test` puesto la entrada no quedó marcada"

    async with admin_tx() as c:
        # Sin el GUC, que es el caso que importa. `admin_tx` es una conexión asyncpg
        # directa —no pasa por SQLAlchemy— así que el oyente de `conftest` no la toca y
        # aquí se puede comprobar el comportamiento por defecto de verdad.
        await c.execute("SET LOCAL app.is_test = ''")
        cid = await _cliente_de_prueba(c)
        marca = await c.fetchval(
            "SELECT is_test FROM audit.entries WHERE row_id = $1 "
            " ORDER BY id DESC LIMIT 1",
            cid,
        )
        assert marca is False, (
            "sin `app.is_test` la entrada quedó marcada como prueba: el registro real "
            "quedaría escondido"
        )


async def test_12_marcar_no_es_borrar() -> None:
    """Una entrada marcada sigue estando, completa. Si marcar borrara, el flag sería un
    interruptor de «no cuentes esto» y el registro no valdría nada."""
    async with admin_tx() as c:
        await c.execute("SET LOCAL app.is_test = 'on'")
        cid = await _cliente_de_prueba(c)
        fila = await c.fetchrow(
            "SELECT is_test, after ->> 'name' AS nombre, db_role FROM audit.entries "
            " WHERE row_id = $1 ORDER BY id DESC LIMIT 1",
            cid,
        )
        assert fila is not None, "la entrada marcada no se escribió"
        assert fila["is_test"] is True
        assert fila["nombre"] == "ZZZ Auditoria pytest", "se perdió el contenido"
        assert fila["db_role"], "se perdió el autor"


async def test_13_nada_que_parezca_secreto_entra_en_claro() -> None:
    """Hoy no hay ninguna columna así en los esquemas auditados. Esto es para MAÑANA:
    un registro de auditoría es donde un secreto sobrevive más tiempo, porque nadie
    borra el historial."""
    async with admin_tx() as c:
        limpio = await c.fetchval(
            "SELECT audit.limpiar($1::jsonb)",
            '{"api_token":"abc","refresh_token":"x","name":"visible"}',
        )
        assert '"api_token": "[oculto]"' in limpio or '"api_token":"[oculto]"' in limpio
        assert "abc" not in limpio, "un secreto entró en claro en el registro"
        assert "visible" in limpio, "se ocultó lo que no era secreto"
