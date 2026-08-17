"""LAS REGLAS DE LAS FIGURAS, PROBADAS SIN BASE NI RED.

Lo que se comprueba es la RUTA —tres segmentos, porque contar es lo que impide salir del
prefijo— y las dos trampas de escala que hacen inservible un plano:

  · un modelo en milimetros que se sube como si fueran metros: una persona de 1.700 m;
  · un `CC-BY` sin credito, que en un SaaS multi-tenant no es un descuido sino incumplir.

La ruta se prueba contando porque asi se rompio la anterior: `perception_media_path_ok`
exige cuatro segmentos y el prefijo de los recortes añadia una carpeta, que hacian cinco.
El bucket rechazaba cada subida en silencio y dos analisis enteros terminaron con 180
detecciones y cero imagenes.
"""

from uuid import UUID

import pytest

from olo.domain.spatial_assets import (
    ALTO_TIPICO_M,
    AMBITO_PLATAFORMA,
    CATEGORIAS,
    TIPOS_DE_FIGURA,
    TOPE_BYTES,
    escala_sugerida,
    ruta_de_figura,
    sanitizar_nombre_de_archivo,
    validar_figura,
    validar_medidas,
)

TENANT = UUID("d1ae4202-6f85-45d9-a8ed-ca9d122c0257")
MODELO = UUID("2692ad69-e7fd-4fcd-ac1c-d7ddeb2bf416")


# ── La ruta ───────────────────────────────────────────────────────────────────


def test_la_ruta_tiene_tres_segmentos() -> None:
    """LA prueba. Es literalmente lo que `core.spatial_asset_path_ok` cuenta."""
    ruta = ruta_de_figura(TENANT, MODELO, "operario.glb", "model/gltf-binary")
    assert len(ruta.split("/")) == 3


def test_la_biblioteca_comun_no_lleva_uuid_de_relleno() -> None:
    """Un UUID falso para «la plataforma» se confundiria con el de algun operador."""
    ruta = ruta_de_figura(None, MODELO, "operario.glb", "model/gltf-binary")
    assert ruta.split("/")[0] == AMBITO_PLATAFORMA


def test_el_primer_segmento_es_el_tenant() -> None:
    """Aqui esta el aislamiento: el bucket comprueba que sea EL tenant de quien pregunta."""
    ruta = ruta_de_figura(TENANT, MODELO, "x.glb", "model/gltf-binary")
    assert ruta.split("/")[0] == str(TENANT)
    assert ruta.split("/")[1] == str(MODELO)


def test_un_nombre_con_barras_no_añade_segmentos() -> None:
    """El defecto exacto que rompio los recortes, pero por la puerta del nombre.

    Si el nombre del cliente pudiera meter una barra, la ruta tendria cuatro segmentos y el
    bucket la rechazaria — en silencio, porque la subida de una figura tampoco puede tumbar
    nada—.
    """
    ruta = ruta_de_figura(TENANT, MODELO, "carpeta/subcarpeta/mi modelo.glb", "model/gltf-binary")
    assert len(ruta.split("/")) == 3


def test_un_nombre_con_puntos_no_puede_salir_del_prefijo() -> None:
    ruta = ruta_de_figura(TENANT, MODELO, "../../otro.glb", "model/gltf-binary")
    assert ".." not in ruta
    assert len(ruta.split("/")) == 3


def test_la_extension_la_pone_el_tipo_no_el_nombre() -> None:
    """Un `.glb` llamado `x.exe` sigue siendo un `.glb`; el nombre no tiene por que mentir."""
    assert ruta_de_figura(TENANT, MODELO, "modelo.exe", "model/gltf-binary").endswith(".glb")
    assert ruta_de_figura(TENANT, MODELO, "modelo.exe", "model/gltf+json").endswith(".gltf")


def test_un_nombre_vacio_no_deja_la_ruta_terminada_en_barra() -> None:
    #  Una ruta que acaba en `/` es un tercer segmento vacio, y el bucket la rechaza.
    ruta = ruta_de_figura(TENANT, MODELO, "...", "model/gltf-binary")
    assert not ruta.endswith("/")
    assert ruta.split("/")[2] != ""


def test_el_nombre_no_crece_sin_limite() -> None:
    largo = "a" * 500 + ".glb"
    assert len(sanitizar_nombre_de_archivo(largo, "model/gltf-binary")) <= 70


# ── El formato y el peso ──────────────────────────────────────────────────────


@pytest.mark.parametrize("tipo", sorted(TIPOS_DE_FIGURA))
def test_gltf_se_admite(tipo: str) -> None:
    assert validar_figura(tipo, 2_000_000) is None


@pytest.mark.parametrize(
    "tipo",
    ["model/obj", "application/octet-stream", "image/png", "", "application/x-fbx"],
)
def test_lo_que_no_es_gltf_se_rechaza(tipo: str) -> None:
    """OBJ no lleva materiales, FBX es propietario, y `octet-stream` no dice nada."""
    motivo = validar_figura(tipo, 2_000_000)
    assert motivo is not None
    #  El motivo tiene que DECIR que hace falta, no solo que no vale.
    assert "glTF" in motivo


def test_un_archivo_vacio_se_rechaza() -> None:
    assert validar_figura("model/gltf-binary", 0) is not None


def test_por_encima_del_tope_se_rechaza_diciendo_cuanto() -> None:
    motivo = validar_figura("model/gltf-binary", TOPE_BYTES + 1)
    assert motivo is not None
    assert "64 MB" in motivo


def test_justo_en_el_tope_se_admite() -> None:
    #  El limite es inclusivo: rechazar exactamente el tope declarado seria mentir sobre él.
    assert validar_figura("model/gltf-binary", TOPE_BYTES) is None


# ── Las medidas ───────────────────────────────────────────────────────────────


def test_unas_medidas_normales_valen() -> None:
    assert validar_medidas(0.6, 1.72, 0.4) is None


def test_sin_medidas_no_hay_queja() -> None:
    """No medir es un estado valido: el navegador puede no haber podido abrir el modelo."""
    assert validar_medidas(None, None, None) is None


def test_una_persona_de_1700_metros_se_rechaza() -> None:
    """El error de unidad, que es el que de verdad pasa: milimetros donde van metros."""
    motivo = validar_medidas(600, 1700, 400)
    assert motivo is not None
    assert "milimetros" in motivo or "centimetros" in motivo


def test_una_medida_de_cero_se_rechaza() -> None:
    assert validar_medidas(0, 1.7, 0.4) is not None


# ── La escala sugerida ────────────────────────────────────────────────────────


def test_sugiere_dividir_por_mil_en_milimetros() -> None:
    #  Un modelo de 1.700 «unidades» que deberia medir 1,7 m.
    assert escala_sugerida(1700, ALTO_TIPICO_M["persona"]) == pytest.approx(0.001)


def test_sugiere_dividir_por_cien_en_centimetros() -> None:
    assert escala_sugerida(170, ALTO_TIPICO_M["persona"]) == pytest.approx(0.01)


def test_no_sugiere_nada_cuando_ya_esta_bien() -> None:
    """1,8 frente a 1,7 es modelado, no unidad. Sugerir «x 0,94» invita a estropearlo."""
    assert escala_sugerida(1.8, 1.7) is None


def test_sin_datos_no_sugiere() -> None:
    assert escala_sugerida(None, 1.7) is None
    assert escala_sugerida(1.7, None) is None
    assert escala_sugerida(0, 1.7) is None


def test_las_categorias_tipicas_estan_todas_en_la_lista() -> None:
    """Si divergieran, la pantalla ofreceria una categoria que la base rechaza.

    `ALTO_TIPICO_M` no cubre `otro` a proposito: no hay alto tipico de «otro», y darle uno
    seria inventar una referencia.
    """
    assert set(ALTO_TIPICO_M) <= CATEGORIAS
    assert CATEGORIAS - set(ALTO_TIPICO_M) == {"otro"}
