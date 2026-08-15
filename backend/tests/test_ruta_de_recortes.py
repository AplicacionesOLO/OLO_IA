"""LA RUTA DE LOS RECORTES CABE EN LA REGLA DEL BUCKET.

── QUE PASO ──────────────────────────────────────────────────────────────────

`core.perception_media_path_ok()` (0076) exige CUATRO segmentos exactos en el nombre del
objeto: con mas, un `a/b/c/d/../../otro` navegaria fuera de su prefijo.

La prueba visual de 0091 anadia una carpeta `recortes/`, lo que daba cinco. Storage
rechazaba cada subida con «new row violates row-level security policy» y el worker lo
tragaba recorte a recorte —la prueba visual es un extra y no puede tumbar un analisis—,
asi que un video de ocho minutos terminaba con 227 detecciones y CERO imagenes sin que
nada fallara ruidosamente. Se descubrio sondeando el bucket a mano.

── POR QUE ESTA PRUEBA Y NO UNA CONTRA LA BASE ───────────────────────────────

Porque la regla es una CUENTA, y una cuenta se comprueba contando. Una prueba de
integracion diria «403» sin decir por que, y ademas necesitaria un bucket. Esta dice
exactamente cual es el invariante y se rompe en el momento en que alguien vuelve a
meter una carpeta por el medio.
"""

from uuid import UUID

from olo.domain.perception import prefijo_de_recortes, ruta_canonica

TENANT = UUID("d1ae4202-6f85-45d9-a8ed-ca9d122c0257")
ALMACEN = UUID("cae0859d-7dd8-4cfb-ae9d-422f00b5dc1a")
TRABAJO = UUID("18f4625f-3ada-477a-a788-712c205ec5b6")


def test_el_prefijo_deja_sitio_para_el_nombre() -> None:
    """Tres segmentos: el cuarto lo pone el worker al anadir el archivo."""
    assert prefijo_de_recortes(TENANT, ALMACEN, TRABAJO).count("/") == 2


def test_la_ruta_completa_tiene_cuatro_segmentos() -> None:
    """LA prueba. Es literalmente lo que la funcion de la base cuenta."""
    prefijo = prefijo_de_recortes(TENANT, ALMACEN, TRABAJO)
    completa = f"{prefijo}/recorte_10240_3_qr_ubicacion.jpg"
    assert len(completa.split("/")) == 4


def test_no_hay_carpeta_por_el_medio() -> None:
    """El defecto concreto que costo un analisis entero, con nombre propio."""
    assert "/recortes" not in prefijo_de_recortes(TENANT, ALMACEN, TRABAJO)


def test_empieza_por_el_tenant_y_su_almacen() -> None:
    """El aislamiento: el bucket comprueba que el primer segmento es EL tenant."""
    partes = prefijo_de_recortes(TENANT, ALMACEN, TRABAJO).split("/")
    assert partes[0] == str(TENANT)
    assert partes[1] == str(ALMACEN)
    #  El tercero es el TRABAJO y no el medio: reanalizar el mismo video deja sus
    #  recortes sin pisar los del analisis anterior.
    assert partes[2] == str(TRABAJO)


def test_misma_forma_que_la_del_video() -> None:
    """Las dos rutas del bucket se cuentan igual.

    Es lo que fallo: `ruta_canonica` respetaba la regla y el prefijo de los recortes
    —escrito aparte, en el servicio— no. Ahora viven juntas y esto lo comprueba.
    """
    video = ruta_canonica(TENANT, ALMACEN, TRABAJO, "video/mp4", "dataset7.mp4")
    recorte = f"{prefijo_de_recortes(TENANT, ALMACEN, TRABAJO)}/recorte_0_0_pallet.jpg"
    assert len(video.split("/")) == len(recorte.split("/")) == 4
