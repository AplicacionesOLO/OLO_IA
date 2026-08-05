"""Ejecutor de DDL privilegiado para migraciones y rollbacks.

`olo_app` no puede crear objetos —por diseño, migracion 0002— asi que las
migraciones necesitan conectarse como `postgres`. Este script construye esa
conexion a partir de:

  · host, puerto y base   → DATABASE_URL de .env.local (la del backend)
  · contraseña de postgres → docs/.envlocal, clave `passwordBD_OLO_IA`

NUNCA imprime la contraseña ni la URL completa: solo host, puerto, usuario y
base, que es lo necesario para saber contra que se esta ejecutando.

Uso:
    python tools/admin_sql.py <archivo.sql> [--no-transaction] [--quiet]
    python tools/admin_sql.py --inline "SELECT 1"
    python tools/admin_sql.py supabase/migrations/0019_x.sql --record
    python tools/admin_sql.py supabase/rollbacks/0019_x.sql --unrecord 0019
"""

from __future__ import annotations

import argparse
import asyncio
import re
import sys
from pathlib import Path

import asyncpg

REPO = Path(__file__).resolve().parents[2]
ENV_LOCAL = REPO / ".env.local"
ENV_SECRET = REPO / "docs" / ".envlocal"


def _read_key(path: Path, key: str) -> str | None:
    if not path.exists():
        return None
    for raw in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        if k.strip() == key:
            return v.strip().strip('"').strip("'")
    return None


def _connection_kwargs() -> dict[str, object]:
    url = _read_key(ENV_LOCAL, "DATABASE_URL")
    if not url:
        sys.exit("FALTA DATABASE_URL en .env.local")

    m = re.match(
        r"^postgresql(?:\+\w+)?://(?P<user>[^:/?#]+):[^@]*@(?P<host>[^:/?#]+)"
        r"(?::(?P<port>\d+))?/(?P<db>[^?#]+)",
        url,
    )
    if not m:
        sys.exit("DATABASE_URL no tiene la forma esperada")

    password = _read_key(ENV_SECRET, "passwordBD_OLO_IA")
    if not password:
        sys.exit(
            "FALTA la contraseña de postgres. Se espera `passwordBD_OLO_IA` en "
            "docs/.envlocal. Las migraciones no pueden aplicarse como olo_app."
        )

    host = m.group("host")
    # El pooler de Supabase exige el usuario en la forma `postgres.<project_ref>`;
    # la conexion directa a db.<ref>.supabase.co usa `postgres` a secas.
    existing_user = m.group("user")
    if "pooler.supabase.com" in host and "." in existing_user:
        user = f"postgres.{existing_user.split('.', 1)[1]}"
    else:
        user = "postgres"

    return {
        "host": host,
        "port": int(m.group("port") or 5432),
        "database": m.group("db"),
        "user": user,
        "password": password,
        # El pooler en modo transaccion no admite sentencias preparadas cacheadas.
        "statement_cache_size": 0,
    }


def _version_and_name(path: str | None) -> tuple[str, str]:
    """`0019_platform_schema_privileges.sql` → ('0019', 'platform_schema_privileges').

    Es la convencion que ya usan las 18 filas existentes: `version` es el numero
    de cuatro digitos y `name` el resto del nombre sin extension.
    """
    if not path:
        sys.exit("--record necesita un archivo, no --inline")
    stem = Path(path).stem
    version, _, name = stem.partition("_")
    if not (len(version) == 4 and version.isdigit()) or not name:
        sys.exit(f"nombre de migracion inesperado: {stem!r}")
    return version, name


def _texto(valor: object) -> str:
    """Un valor de Postgres como celda de tabla, sin confundir NULL con vacío."""
    if valor is None:
        return "∅"
    return str(valor)


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("path", nargs="?")
    ap.add_argument("--inline")
    ap.add_argument("--no-transaction", action="store_true")
    ap.add_argument("--quiet", action="store_true")
    ap.add_argument(
        "--rows",
        action="store_true",
        help="imprime las filas devueltas (una consulta, no un guion de varias "
        "sentencias). Sin esto un SELECT se ejecuta y su resultado se descarta, "
        "que es lo correcto para migraciones y engañoso para inspeccionar",
    )
    ap.add_argument(
        "--record",
        action="store_true",
        help="registra la version en supabase_migrations.schema_migrations, "
        "en la MISMA transaccion que el DDL",
    )
    ap.add_argument(
        "--unrecord",
        metavar="VERSION",
        help="borra esa version del historial, en la misma transaccion",
    )
    args = ap.parse_args()

    if args.inline:
        sql, label = args.inline, "(inline)"
    elif args.path:
        # Lectura sincrona a proposito: es una herramienta de linea de comandos que
        # lee un archivo una vez al arrancar, no un servidor. Traer una dependencia
        # de E/S asincrona para esto seria peor que el bloqueo de unos microsegundos.
        sql = Path(args.path).read_text(encoding="utf-8")  # noqa: ASYNC240
        label = Path(args.path).name
    else:
        return ap.error("hace falta un archivo o --inline") or 2

    kw = _connection_kwargs()
    if not args.quiet:
        print(f"→ {kw['user']}@{kw['host']}:{kw['port']}/{kw['database']}")
        print(f"→ {label}")

    conn = await asyncpg.connect(**kw)  # type: ignore[arg-type]
    # Los RAISE NOTICE de los bloques DO son la salida de las verificaciones
    # internas de cada migracion: hay que verlos, no descartarlos.
    conn.add_log_listener(lambda _c, msg: print(f"   [{msg.severity}] {msg.message}"))
    try:
        if args.rows:
            # `fetch` acepta UNA sentencia: el protocolo extendido de Postgres no
            # admite varias, y fallar aqui con un error claro es mejor que ejecutar
            # solo la primera y presentar su resultado como si fuera el del guion.
            filas = await conn.fetch(sql)
            if not filas:
                print("   (0 filas)")
            else:
                columnas = list(filas[0].keys())
                ancho = [
                    max(len(c), *(len(_texto(f[c])) for f in filas)) for c in columnas
                ]
                print("   " + " | ".join(c.ljust(w) for c, w in zip(columnas, ancho, strict=True)))
                print("   " + "-+-".join("-" * w for w in ancho))
                for f in filas:
                    print(
                        "   "
                        + " | ".join(
                            _texto(f[c]).ljust(w) for c, w in zip(columnas, ancho, strict=True)
                        )
                    )
                print(f"   ({len(filas)} filas)")
        elif args.no_transaction:
            result = await conn.execute(sql)
            print(f"   {result}")
        else:
            # El DDL y el registro del historial van en la MISMA transaccion: si
            # una migracion falla a medias, no debe quedar marcada como aplicada,
            # y si se aplica, el historial no puede quedarse atras.
            async with conn.transaction():
                await conn.execute(sql)
                if args.record:
                    version, name = _version_and_name(args.path)
                    await conn.execute(
                        "INSERT INTO supabase_migrations.schema_migrations "
                        "(version, name, statements) VALUES ($1, $2, $3) "
                        "ON CONFLICT (version) DO NOTHING",
                        version,
                        name,
                        [sql],
                    )
                    print(f"   historial: + {version} ({name})")
                if args.unrecord:
                    tag = await conn.execute(
                        "DELETE FROM supabase_migrations.schema_migrations "
                        "WHERE version = $1",
                        args.unrecord,
                    )
                    print(f"   historial: - {args.unrecord} ({tag})")
        if not args.quiet:
            print("✓ OK")
        return 0
    except Exception as exc:  # se reporta y se devuelve codigo de salida
        print(f"✗ FALLO: {type(exc).__name__}: {exc}")
        detail = getattr(exc, "detail", None)
        hint = getattr(exc, "hint", None)
        if detail:
            print(f"   detalle: {detail}")
        if hint:
            print(f"   pista  : {hint}")
        return 1
    finally:
        await conn.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
