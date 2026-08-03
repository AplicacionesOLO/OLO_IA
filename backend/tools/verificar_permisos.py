"""Comprueba que todo `require("x:y")` del código exista en `core.permissions`.

─────────────────────────────────────────────────────────────────────────────
POR QUÉ ESTE GUARDIÁN EXISTE

`require()` resuelve el permiso contra la base en cada petición. Un código que no
existe en el catálogo **no coincide con nada**, así que la dependencia deniega
siempre — y lo hace en silencio, con un 403 idéntico al de un permiso legítimo que el
usuario no tiene.

Es decir: un endpoint con un código mal escrito queda inalcanzable para todo el mundo,
para siempre, y el síntoma es indistinguible de un problema de asignación de roles.

Ya ocurrió: `admin.py` se escribió con `roles:update`, `roles:create`, `roles:delete` y
`settings:write`. Ninguno existe — el catálogo usa `roles:write`, `roles:assign` y
`settings:update`. Las pruebas de servicio no lo detectaron porque llaman al servicio
directamente y se saltan la dependencia.

Uso:
    PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe tools/verificar_permisos.py
"""

from __future__ import annotations

import asyncio
import os
import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ / "src"))

# Variables del backend. No se imprime ninguna.
_ENV = RAIZ.parent / ".env.local"
if _ENV.exists():
    for linea in _ENV.read_text(encoding="utf-8").splitlines():
        if "=" in linea and not linea.lstrip().startswith("#"):
            clave, valor = linea.split("=", 1)
            os.environ.setdefault(clave.strip(), valor.strip().strip('"').strip("'"))

from sqlalchemy import text  # noqa: E402

from olo.db.session import dispose_engine, init_engine  # noqa: E402

#: Captura `require("modulo:accion")` en cualquier archivo del paquete.
_PATRON = re.compile(r'require\(\s*["\']([a-z_]+:[a-z_]+)["\']\s*\)')


def usados() -> dict[str, list[str]]:
    """`{codigo: [archivos]}` de todo lo que el código exige."""
    encontrados: dict[str, list[str]] = {}
    for archivo in (RAIZ / "src" / "olo").rglob("*.py"):
        texto = archivo.read_text(encoding="utf-8")
        for codigo in _PATRON.findall(texto):
            encontrados.setdefault(codigo, []).append(
                str(archivo.relative_to(RAIZ)).replace("\\", "/")
            )
    return encontrados


async def main() -> int:
    codigos = usados()
    if not codigos:
        print("no encontre ninguna llamada a require(): revisa el patron")
        return 1

    init_engine(null_pool=True)
    try:
        # Se lee con el rol de `admin_sql` (postgres): `core.permissions` es un catálogo
        # global sin RLS de tenant, así que aquí el rol no cambia el resultado.
        from olo.db.session import _get_sessionmaker

        maker = _get_sessionmaker()
        async with maker() as s:
            filas = (await s.execute(text("SELECT code FROM core.permissions"))).scalars().all()
        catalogo = set(filas)
    finally:
        await dispose_engine()

    huerfanos = {c: f for c, f in sorted(codigos.items()) if c not in catalogo}

    print(f"codigos usados en el codigo : {len(codigos)}")
    print(f"codigos en el catalogo      : {len(catalogo)}")
    print()

    if huerfanos:
        print(f"*** {len(huerfanos)} CODIGO(S) QUE NO EXISTEN ***")
        print("Estos endpoints denegarian SIEMPRE, en silencio:\n")
        for codigo, archivos in huerfanos.items():
            print(f"  {codigo}")
            for a in sorted(set(archivos)):
                print(f"      {a}")
            # Sugerencia por módulo: lo más probable es que el nombre de la acción sea
            # otro, no que falte el módulo entero.
            modulo = codigo.split(":", 1)[0]
            hermanos = sorted(c for c in catalogo if c.startswith(f"{modulo}:"))
            if hermanos:
                print(f"      ¿querias uno de estos? {', '.join(hermanos)}")
            else:
                print(f"      el modulo «{modulo}» no existe en el catalogo")
        return 1

    print("OK: todos los codigos exigidos existen en core.permissions")

    # Informativo: permisos del catálogo que ningún endpoint exige. No es un error
    # —muchos son para funciones que aún no existen— pero conviene verlo.
    sin_uso = sorted(catalogo - set(codigos))
    if sin_uso:
        print(f"\n{len(sin_uso)} permiso(s) del catalogo que ningun endpoint exige todavia:")
        for c in sin_uso:
            print(f"  {c}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
